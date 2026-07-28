// admin 用户管理 + 即时吊销集成测试：覆盖 multiuser-plan 8.2 角色边界 / 8.3 会话吊销。
// 端到端过 app.fetch，内存 SQLite 起真实 Hono app。startup 已 seed 一个 admin（username=admin，
// 密码来自 SECRETS.ADMIN_PASSWORD）；测试用 admin 建/改/删普通用户并验证 session_version 吊销。
import { test, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type { Database, PreparedStatement, AppSecrets } from './types.js';
import { createApp } from './routes.js';
import { runStartupMigration } from './startup.js';
import { runMigrations } from './migrate.js';
import { MIGRATIONS } from './migrations.js';
import { hashPassword } from './password.js';
import { createSession } from './auth.js';

function normalize(values: unknown[]): unknown[] {
  return values.map((v) => {
    if (v === undefined || v === null) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v;
  });
}

// 最小内存 Database 适配器（与 routes.test.ts 同款）。
function memDb(): { db: Database; raw: DatabaseSync } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');

  function makeStmt(sql: string, bound: unknown[] = []): PreparedStatement {
    return {
      bind(...values: unknown[]) {
        return makeStmt(sql, values);
      },
      async first<T = Record<string, unknown>>() {
        return (sqlite.prepare(sql).get(...(normalize(bound) as never[])) as T) ?? null;
      },
      async all<T = Record<string, unknown>>() {
        return { results: sqlite.prepare(sql).all(...(normalize(bound) as never[])) as T[] };
      },
      async run() {
        const info = sqlite.prepare(sql).run(...(normalize(bound) as never[]));
        return { meta: { last_row_id: Number(info.lastInsertRowid) } };
      },
      _sql: sql,
      _bound: bound,
    } as PreparedStatement & { _sql: string; _bound: unknown[] };
  }

  const db: Database = {
    prepare(sql: string) {
      return makeStmt(sql);
    },
    async batch(statements: PreparedStatement[]) {
      sqlite.exec('BEGIN');
      try {
        for (const s of statements) {
          const { _sql, _bound } = s as PreparedStatement & { _sql: string; _bound: unknown[] };
          sqlite.prepare(_sql).run(...(normalize(_bound) as never[]));
        }
        sqlite.exec('COMMIT');
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
      return [];
    },
  };
  return { db, raw: sqlite };
}

const SECRETS: AppSecrets = {
  ADMIN_PASSWORD: 'admin-init-pw',
  SESSION_SECRET: 'test-session-secret',
  ENCRYPTION_KEY: btoa(String.fromCharCode(...new Uint8Array(32))),
};

const DEPS = { runMigrations, hashPassword, migrations: MIGRATIONS };

// 起一个已迁移 + seed 好 admin 的 app。seed 的 admin username='admin'，密码=SECRETS.ADMIN_PASSWORD。
async function setupApp() {
  const { db, raw } = memDb();
  const app = createApp({ db, secrets: SECRETS, runStartup: (d, s) => runStartupMigration(d, s, DEPS) });
  await runStartupMigration(db, SECRETS, DEPS);
  return { app, raw };
}

async function login(
  app: ReturnType<typeof createApp>,
  username: string,
  password: string,
): Promise<string> {
  const res = await app.request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  expect(res.status).toBe(200);
  const setCookie = res.headers.get('Set-Cookie') ?? '';
  const token = setCookie.split(';')[0];
  expect(token).toContain('rn_session=');
  return token;
}

function authed(cookie: string, body?: unknown, method?: string): RequestInit {
  const init: RequestInit = { headers: { Cookie: cookie } };
  if (body !== undefined) {
    init.method = method ?? 'POST';
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  } else if (method) {
    init.method = method;
  }
  return init;
}

// 建一个普通用户，返回其 id。
async function createUser(
  app: ReturnType<typeof createApp>,
  adminCookie: string,
  username: string,
  password: string,
  role = 'user',
): Promise<number> {
  const res = await app.request(
    '/api/admin/users',
    authed(adminCookie, { username, password, role }),
  );
  expect(res.status).toBe(200);
  const j = await res.json();
  return j.id;
}

// ==== 8.2 角色边界 ====

test('8.2-8 user 角色调 /api/admin/users → 403', async () => {
  const { app } = await setupApp();
  const admin = await login(app, 'admin', SECRETS.ADMIN_PASSWORD);
  await createUser(app, admin, 'bob', 'pw');
  const bob = await login(app, 'bob', 'pw');

  const list = await app.request('/api/admin/users', authed(bob));
  expect(list.status).toBe(403);
  const post = await app.request('/api/admin/users', authed(bob, { username: 'x', password: 'p' }));
  expect(post.status).toBe(403);
});

test('8.2-9 admin 调 /api/admin/users 成功列出', async () => {
  const { app } = await setupApp();
  const admin = await login(app, 'admin', SECRETS.ADMIN_PASSWORD);
  await createUser(app, admin, 'bob', 'pw');

  const res = await app.request('/api/admin/users', authed(admin));
  expect(res.status).toBe(200);
  const j = await res.json();
  const names = j.users.map((u: { username: string }) => u.username);
  expect(names).toContain('admin');
  expect(names).toContain('bob');
  // 不泄露 password_hash
  expect(j.users[0].password_hash).toBeUndefined();
});

test('8.2-10 admin 建重复 username → 409', async () => {
  const { app } = await setupApp();
  const admin = await login(app, 'admin', SECRETS.ADMIN_PASSWORD);
  await createUser(app, admin, 'bob', 'pw');
  const dup = await app.request('/api/admin/users', authed(admin, { username: 'bob', password: 'pw2' }));
  expect(dup.status).toBe(409);
});

test('8.2-11 admin DELETE 自己 → 拒绝', async () => {
  const { app, raw } = await setupApp();
  const admin = await login(app, 'admin', SECRETS.ADMIN_PASSWORD);
  const adminId = (raw.prepare("SELECT id FROM users WHERE username='admin'").get() as { id: number }).id;
  const res = await app.request(`/api/admin/users/${adminId}`, authed(admin, undefined, 'DELETE'));
  expect(res.status).toBe(400);
  // admin 仍在
  const still = raw.prepare('SELECT id FROM users WHERE id = ?').get(adminId);
  expect(still).toBeTruthy();
});

test('8.2-12 admin 停用/降级自己 → 拒绝', async () => {
  const { app, raw } = await setupApp();
  const admin = await login(app, 'admin', SECRETS.ADMIN_PASSWORD);
  const adminId = (raw.prepare("SELECT id FROM users WHERE username='admin'").get() as { id: number }).id;

  const disable = await app.request(`/api/admin/users/${adminId}`, {
    ...authed(admin, { disabled: true }),
    method: 'PUT',
  });
  expect(disable.status).toBe(400);

  const demote = await app.request(`/api/admin/users/${adminId}`, {
    ...authed(admin, { role: 'user' }),
    method: 'PUT',
  });
  expect(demote.status).toBe(400);
});

test('8.2-13 删除用户级联清空其 sites/proxies/settings/groups/models', async () => {
  const { app, raw } = await setupApp();
  const admin = await login(app, 'admin', SECRETS.ADMIN_PASSWORD);
  const bobId = await createUser(app, admin, 'bob', 'pw');
  const bob = await login(app, 'bob', 'pw');

  // bob 建站点、代理、设置
  await app.request('/api/sites', authed(bob, { name: 'B-site', base_url: 'https://b.example.com' }));
  await app.request('/api/proxies', authed(bob, { name: 'B-proxy', host: '127.0.0.1', port: 7890 }));
  await app.request('/api/settings', { ...authed(bob, { scrape_interval_min: '42' }), method: 'PUT' });
  // 手动塞一条 group/model 归属 bob 的站点（scrape 未跑，直接注入验证级联）
  const sid = (raw.prepare('SELECT id FROM sites WHERE user_id = ?').get(bobId) as { id: number }).id;
  raw.prepare('INSERT INTO site_groups (site_id, group_name, updated_at) VALUES (?, ?, ?)').run(sid, 'g1', Date.now());
  raw.prepare('INSERT INTO site_models (site_id, model_name, updated_at) VALUES (?, ?, ?)').run(sid, 'm1', Date.now());

  // 删 bob
  const del = await app.request(`/api/admin/users/${bobId}`, authed(admin, undefined, 'DELETE'));
  expect(del.status).toBe(200);

  // 全部无孤儿
  expect(raw.prepare('SELECT COUNT(*) c FROM users WHERE id = ?').get(bobId)).toMatchObject({ c: 0 });
  expect(raw.prepare('SELECT COUNT(*) c FROM sites WHERE user_id = ?').get(bobId)).toMatchObject({ c: 0 });
  expect(raw.prepare('SELECT COUNT(*) c FROM proxies WHERE user_id = ?').get(bobId)).toMatchObject({ c: 0 });
  expect(raw.prepare('SELECT COUNT(*) c FROM settings WHERE user_id = ?').get(bobId)).toMatchObject({ c: 0 });
  expect(raw.prepare('SELECT COUNT(*) c FROM site_groups WHERE site_id = ?').get(sid)).toMatchObject({ c: 0 });
  expect(raw.prepare('SELECT COUNT(*) c FROM site_models WHERE site_id = ?').get(sid)).toMatchObject({ c: 0 });
});

// ==== 8.3 会话与登录（即时吊销）====

test('8.3-14 停用用户后其新登录被拒', async () => {
  const { app, raw } = await setupApp();
  const admin = await login(app, 'admin', SECRETS.ADMIN_PASSWORD);
  const bobId = await createUser(app, admin, 'bob', 'pw');

  // 停用 bob
  const disable = await app.request(`/api/admin/users/${bobId}`, {
    ...authed(admin, { disabled: true }),
    method: 'PUT',
  });
  expect(disable.status).toBe(200);

  // 新登录被拒
  const res = await app.request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'bob', password: 'pw' }),
  });
  expect(res.status).toBe(401);
});

test('8.3-15 即时吊销-停用：旧 cookie 立即 401', async () => {
  const { app } = await setupApp();
  const admin = await login(app, 'admin', SECRETS.ADMIN_PASSWORD);
  const bobId = await createUser(app, admin, 'bob', 'pw');
  const bob = await login(app, 'bob', 'pw');

  // 旧 cookie 本来可用
  expect((await app.request('/api/sites', authed(bob))).status).toBe(200);

  // admin 停用 bob
  await app.request(`/api/admin/users/${bobId}`, { ...authed(admin, { disabled: true }), method: 'PUT' });

  // 旧 cookie 立即失效
  expect((await app.request('/api/sites', authed(bob))).status).toBe(401);
});

test('8.3-16 即时吊销-改密：旧 cookie 立即 401，新密码可重登', async () => {
  const { app } = await setupApp();
  const admin = await login(app, 'admin', SECRETS.ADMIN_PASSWORD);
  const bobId = await createUser(app, admin, 'bob', 'pw');
  const bob = await login(app, 'bob', 'pw');
  expect((await app.request('/api/sites', authed(bob))).status).toBe(200);

  // admin 重置 bob 密码
  await app.request(`/api/admin/users/${bobId}`, { ...authed(admin, { password: 'newpw' }), method: 'PUT' });

  // 旧 cookie 立即失效
  expect((await app.request('/api/sites', authed(bob))).status).toBe(401);
  // 旧密码登录失败
  const oldLogin = await app.request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'bob', password: 'pw' }),
  });
  expect(oldLogin.status).toBe(401);
  // 新密码可重登
  const bob2 = await login(app, 'bob', 'newpw');
  expect((await app.request('/api/sites', authed(bob2))).status).toBe(200);
});

test('8.3-17 即时吊销-降级：admin 降为 user 后旧 cookie 立即被拒，重登仅 user 权限', async () => {
  const { app } = await setupApp();
  const admin = await login(app, 'admin', SECRETS.ADMIN_PASSWORD);
  // 建一个 admin 角色用户 carol
  const carolId = await createUser(app, admin, 'carol', 'pw', 'admin');
  const carol = await login(app, 'carol', 'pw');
  // carol 本来能用 admin 端点
  expect((await app.request('/api/admin/users', authed(carol))).status).toBe(200);

  // 超管把 carol 降为 user
  await app.request(`/api/admin/users/${carolId}`, { ...authed(admin, { role: 'user' }), method: 'PUT' });

  // carol 旧 cookie 立即被拒（ver 不匹配）
  expect((await app.request('/api/admin/users', authed(carol))).status).toBe(401);
  expect((await app.request('/api/sites', authed(carol))).status).toBe(401);

  // 重登后仅 user 权限：数据端点可用，admin 端点 403
  const carol2 = await login(app, 'carol', 'pw');
  expect((await app.request('/api/sites', authed(carol2))).status).toBe(200);
  expect((await app.request('/api/admin/users', authed(carol2))).status).toBe(403);
});

test('8.3-18 越权兜底：ver 匹配但 payload role 被伪造为 admin，授权仍以库里 role 为准 → 403', async () => {
  const { app, raw } = await setupApp();
  const admin = await login(app, 'admin', SECRETS.ADMIN_PASSWORD);
  const bobId = await createUser(app, admin, 'bob', 'pw');

  // 直接用真密钥签一个 role=admin 但 ver 与库一致的 cookie（bob 实际是 user）。
  // 签名有效 + ver 匹配（过步骤 1~3），唯一防线是步骤 4「授权用库里 role」。
  const bobVer = (raw.prepare('SELECT session_version FROM users WHERE id = ?').get(bobId) as {
    session_version: number;
  }).session_version;
  const forged = await createSession(SECRETS.SESSION_SECRET, bobId, 'admin', bobVer);
  const cookie = `rn_session=${forged}`;

  // 数据端点仍可用（bob 是合法登录用户），但 admin 端点必须以库里 role=user 判定 → 403。
  expect((await app.request('/api/sites', authed(cookie))).status).toBe(200);
  expect((await app.request('/api/admin/users', authed(cookie))).status).toBe(403);
});

test('8.3-19 错误用户名与错误密码返回相同文案', async () => {
  const { app } = await setupApp();
  const admin = await login(app, 'admin', SECRETS.ADMIN_PASSWORD);
  await createUser(app, admin, 'bob', 'pw');

  const badUser = await app.request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'nobody', password: 'pw' }),
  });
  const badPass = await app.request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'bob', password: 'wrong' }),
  });
  expect(badUser.status).toBe(401);
  expect(badPass.status).toBe(401);
  expect(await badUser.json()).toEqual(await badPass.json());
});
