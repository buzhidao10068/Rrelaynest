// admin 跨用户只读 + 条款 ack 双校验集成测试：覆盖 multiuser-plan 8.4 用例 22–25。
// 端到端过 app.fetch，内存 SQLite。ack 标记走 PUT /api/settings 写 admin 自己的 user_id。
import { test, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type { Database, PreparedStatement, AppSecrets } from './types.js';
import { createApp } from './routes.js';
import { runStartupMigration } from './startup.js';
import { runMigrations } from './migrate.js';
import { MIGRATIONS } from './migrations.js';
import { hashPassword } from './password.js';

function normalize(values: unknown[]): unknown[] {
  return values.map((v) => {
    if (v === undefined || v === null) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v;
  });
}

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
  const token = (res.headers.get('Set-Cookie') ?? '').split(';')[0];
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

async function createUser(
  app: ReturnType<typeof createApp>,
  adminCookie: string,
  username: string,
  password: string,
): Promise<number> {
  const res = await app.request('/api/admin/users', authed(adminCookie, { username, password, role: 'user' }));
  expect(res.status).toBe(200);
  return (await res.json()).id;
}

// 设置/撤销该 admin 的 ack 标记（走业务 settings 端点，写 admin 自己的 user_id）。
async function setAck(app: ReturnType<typeof createApp>, adminCookie: string, value: string): Promise<void> {
  const res = await app.request('/api/settings', {
    ...authed(adminCookie, { admin_global_view_ack: value }),
    method: 'PUT',
  });
  expect(res.status).toBe(200);
}

// ==== 8.4 admin 跨用户只读 + 条款解锁 ====

test('8.4-22 admin 未 ack 调 /api/admin/users/:uid/sites → 403', async () => {
  const { app } = await setupApp();
  const admin = await login(app, 'admin', SECRETS.ADMIN_PASSWORD);
  const bobId = await createUser(app, admin, 'bob', 'pw');

  const res = await app.request(`/api/admin/users/${bobId}/sites`, authed(admin));
  expect(res.status).toBe(403);
});

test('8.4-23 admin ack 后调该端点 → 200，返回目标用户站点（剔除 token）', async () => {
  const { app } = await setupApp();
  const admin = await login(app, 'admin', SECRETS.ADMIN_PASSWORD);
  const bobId = await createUser(app, admin, 'bob', 'pw');
  const bob = await login(app, 'bob', 'pw');

  // bob 建带 token 的站点
  await app.request(
    '/api/sites',
    authed(bob, { name: 'B-site', base_url: 'https://b.example.com', token: 'secret-token' }),
  );

  await setAck(app, admin, String(Date.now()));

  const res = await app.request(`/api/admin/users/${bobId}/sites`, authed(admin));
  expect(res.status).toBe(200);
  const j = await res.json();
  expect(j.sites.length).toBe(1);
  expect(j.sites[0].name).toBe('B-site');
  // 剔除 token 明文，仅报 has_token
  expect(j.sites[0].token_encrypted).toBeUndefined();
  expect(j.sites[0].has_token).toBe(true);

  // proxies 端点同样可读
  await app.request('/api/proxies', authed(bob, { name: 'B-proxy', host: '127.0.0.1', port: 7890 }));
  const proxRes = await app.request(`/api/admin/users/${bobId}/proxies`, authed(admin));
  expect(proxRes.status).toBe(200);
  expect((await proxRes.json()).proxies.length).toBe(1);

  // 无对应写/删端点：POST/DELETE 该路径 → 404（Hono 无匹配路由）
  const writeAttempt = await app.request(`/api/admin/users/${bobId}/sites`, {
    ...authed(admin, { name: 'x', base_url: 'https://x' }),
    method: 'POST',
  });
  expect(writeAttempt.status).toBe(404);
});

test('8.4-24 admin 撤销 ack（关开关）→ 再调立即 403', async () => {
  const { app } = await setupApp();
  const admin = await login(app, 'admin', SECRETS.ADMIN_PASSWORD);
  const bobId = await createUser(app, admin, 'bob', 'pw');

  await setAck(app, admin, String(Date.now()));
  expect((await app.request(`/api/admin/users/${bobId}/sites`, authed(admin))).status).toBe(200);

  // 撤销：置空
  await setAck(app, admin, '');
  expect((await app.request(`/api/admin/users/${bobId}/sites`, authed(admin))).status).toBe(403);
});

test('8.4-25 普通 user 无论是否 ack 调 /api/admin/users/:uid/* → 403（先撞 requireAdmin）', async () => {
  const { app } = await setupApp();
  const admin = await login(app, 'admin', SECRETS.ADMIN_PASSWORD);
  const bobId = await createUser(app, admin, 'bob', 'pw');
  await createUser(app, admin, 'carol', 'pw');
  const carol = await login(app, 'carol', 'pw');

  // carol 是 user，即便自己塞了 ack 标记也无 admin 权限
  await setAck(app, carol, String(Date.now()));
  expect((await app.request(`/api/admin/users/${bobId}/sites`, authed(carol))).status).toBe(403);
  expect((await app.request(`/api/admin/users/${bobId}/proxies`, authed(carol))).status).toBe(403);
});
