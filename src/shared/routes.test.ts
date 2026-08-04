// 越权（authZ）集成测试：端到端过 app.fetch，覆盖 multiuser-plan 8.1 数据隔离。
// 用 vitest（解析完整值 import 图）+ 内存 SQLite（node:sqlite）起真实 Hono app。
// 两个用户 A/B 各建站点/代理，验证互相看不到、改不了、删不了、爬不了（404 而非 403）。
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

// 最小内存 Database 适配器：形状对齐 shared/db.ts，batch 用 BEGIN/COMMIT/ROLLBACK。
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
  ENCRYPTION_KEY: btoa(String.fromCharCode(...new Uint8Array(32))), // 32 字节全 0 的 base64
};

const DEPS = { runMigrations, hashPassword, migrations: MIGRATIONS };

// 起一个已迁移 + seed 好 admin 的 app；再直接建两个普通用户 A/B（绕过 admin 端点，
// 那是步骤6的事）。返回 app 与工具。
async function setupApp(platform?: 'node' | 'workers') {
  const { db, raw } = memDb();
  const app = createApp({
    db,
    secrets: SECRETS,
    runStartup: (d, s) => runStartupMigration(d, s, DEPS),
    ...(platform ? { platform } : {}),
  });
  await runStartupMigration(db, SECRETS, DEPS);

  // 直接插两个 user（密码都是 'pw'），拿各自 id。
  const now = Date.now();
  const hash = await hashPassword('pw');
  for (const name of ['userA', 'userB']) {
    raw
      .prepare(
        `INSERT INTO users (username, password_hash, role, disabled, session_version, created_at, updated_at)
         VALUES (?, ?, 'user', 0, 1, ?, ?)`,
      )
      .run(name, hash, now, now);
  }
  return { app, raw };
}

// 登录取 cookie。
async function login(app: ReturnType<typeof createApp>, username: string): Promise<string> {
  const res = await app.request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'pw' }),
  });
  expect(res.status).toBe(200);
  const setCookie = res.headers.get('Set-Cookie') ?? '';
  const token = setCookie.split(';')[0]; // rn_session=...
  expect(token).toContain('rn_session=');
  return token;
}

function authed(cookie: string, body?: unknown): RequestInit {
  const init: RequestInit = { headers: { Cookie: cookie } };
  if (body !== undefined) {
    init.method = 'POST';
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  return init;
}

test('8.1-1 用户 B GET /api/sites 看不到 A 的站点', async () => {
  const { app } = await setupApp();
  const cookieA = await login(app, 'userA');
  const cookieB = await login(app, 'userB');

  // A 建站点
  const create = await app.request(
    '/api/sites',
    authed(cookieA, { name: 'A-site', base_url: 'https://a.example.com' }),
  );
  expect(create.status).toBe(200);

  // A 看得到，B 看不到
  const listA = await (await app.request('/api/sites', authed(cookieA))).json();
  const listB = await (await app.request('/api/sites', authed(cookieB))).json();
  expect(listA.sites.length).toBe(1);
  expect(listB.sites.length).toBe(0);
});

test('8.1-2/3 用户 B PUT/DELETE A 的站点 → 404，且 A 站点仍在', async () => {
  const { app } = await setupApp();
  const cookieA = await login(app, 'userA');
  const cookieB = await login(app, 'userB');

  const created = await (
    await app.request('/api/sites', authed(cookieA, { name: 'A-site', base_url: 'https://a.example.com' }))
  ).json();
  const sid = created.id;

  // B 改 A 的站点 → 404
  const put = await app.request(`/api/sites/${sid}`, {
    ...authed(cookieB, { name: 'hacked' }),
    method: 'PUT',
  });
  expect(put.status).toBe(404);

  // B 删 A 的站点 → 404
  const del = await app.request(`/api/sites/${sid}`, { ...authed(cookieB), method: 'DELETE' });
  expect(del.status).toBe(404);

  // A 的站点仍在且名字没被改
  const listA = await (await app.request('/api/sites', authed(cookieA))).json();
  expect(listA.sites.length).toBe(1);
  expect(listA.sites[0].name).toBe('A-site');
});

test('8.1-4 用户 B scrape/checkin A 的站点 → 404', async () => {
  const { app } = await setupApp();
  const cookieA = await login(app, 'userA');
  const cookieB = await login(app, 'userB');
  const created = await (
    await app.request('/api/sites', authed(cookieA, { name: 'A-site', base_url: 'https://a.example.com' }))
  ).json();
  const sid = created.id;

  const scrape = await app.request(`/api/sites/${sid}/scrape`, { ...authed(cookieB), method: 'POST' });
  expect(scrape.status).toBe(404);
  const checkin = await app.request(`/api/sites/${sid}/checkin`, { ...authed(cookieB), method: 'POST' });
  expect(checkin.status).toBe(404);
});

test('8.1-5 proxies 同样隔离：B 看不到 A 的代理，PUT/DELETE → 404', async () => {
  const { app } = await setupApp();
  const cookieA = await login(app, 'userA');
  const cookieB = await login(app, 'userB');

  const created = await (
    await app.request(
      '/api/proxies',
      authed(cookieA, { name: 'A-proxy', host: '127.0.0.1', port: 7890 }),
    )
  ).json();
  const pid = created.id;

  const listB = await (await app.request('/api/proxies', authed(cookieB))).json();
  expect(listB.proxies.length).toBe(0);

  const put = await app.request(`/api/proxies/${pid}`, {
    ...authed(cookieB, { name: 'hacked' }),
    method: 'PUT',
  });
  expect(put.status).toBe(404);

  const del = await app.request(`/api/proxies/${pid}`, { ...authed(cookieB), method: 'DELETE' });
  expect(del.status).toBe(404);

  const listA = await (await app.request('/api/proxies', authed(cookieA))).json();
  expect(listA.proxies.length).toBe(1);
});

test('8.1-6 用户 B GET /api/export 不含 A 的站点', async () => {
  const { app } = await setupApp();
  const cookieA = await login(app, 'userA');
  const cookieB = await login(app, 'userB');
  await app.request('/api/sites', authed(cookieA, { name: 'A-site', base_url: 'https://a.example.com' }));

  const exportB = await (await app.request('/api/export?format=json', authed(cookieB))).json();
  expect(exportB.sites.length).toBe(0);
});

test('8.1-7 settings 隔离：B 改 scrape_interval_min 不影响 A', async () => {
  const { app } = await setupApp();
  const cookieA = await login(app, 'userA');
  const cookieB = await login(app, 'userB');

  // B 设置自己的间隔
  const put = await app.request('/api/settings', {
    ...authed(cookieB, { scrape_interval_min: '99' }),
    method: 'PUT',
  });
  expect(put.status).toBe(200);

  // B 读到 99；A 读到的不是 99（A 没设过，读不到该键或为默认）
  const settingsB = await (await app.request('/api/settings', authed(cookieB))).json();
  expect(settingsB.settings.scrape_interval_min).toBe('99');

  const settingsA = await (await app.request('/api/settings', authed(cookieA))).json();
  expect(settingsA.settings.scrape_interval_min).not.toBe('99');
});

test('未登录访问数据端点 → 401', async () => {
  const { app } = await setupApp();
  const res = await app.request('/api/sites');
  expect(res.status).toBe(401);
});

test('/api/update/check 需登录（不在免登录白名单）→ 401', async () => {
  const { app } = await setupApp();
  const res = await app.request('/api/update/check');
  expect(res.status).toBe(401);
});

test('0004 group_label + balance 在 POST/PUT/GET 间往返', async () => {
  const { app } = await setupApp();
  const cookie = await login(app, 'userA');

  // 建站带 group_label + balance 种子
  const created = await (
    await app.request(
      '/api/sites',
      authed(cookie, {
        name: 'S1',
        base_url: 'https://s1.example.com',
        group_label: '主力',
        balance: 12.5,
      }),
    )
  ).json();
  const sid = created.id;

  let list = await (await app.request('/api/sites', authed(cookie))).json();
  expect(list.sites[0].group_label).toBe('主力');
  expect(list.sites[0].balance).toBe(12.5);

  // PUT 改分组；不带 balance → 余额保留
  const put = await app.request(`/api/sites/${sid}`, {
    ...authed(cookie, { group_label: '备用' }),
    method: 'PUT',
  });
  expect(put.status).toBe(200);

  list = await (await app.request('/api/sites', authed(cookie))).json();
  expect(list.sites[0].group_label).toBe('备用');
  expect(list.sites[0].balance).toBe(12.5); // 未传 balance，保留原值

  // PUT 传空串清分组 → NULL（不分组）
  const clear = await app.request(`/api/sites/${sid}`, {
    ...authed(cookie, { group_label: '' }),
    method: 'PUT',
  });
  expect(clear.status).toBe(200);

  list = await (await app.request('/api/sites', authed(cookie))).json();
  expect(list.sites[0].group_label).toBe(null);
});

// ---- /api/session 下发部署平台（前端据此显示平台并过滤菜单，不再自行猜测）----

test('GET /api/session 未登录时也返回注入的 platform=workers', async () => {
  const { app } = await setupApp('workers');
  const res = await app.request('/api/session');
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.authenticated).toBe(false);
  expect(body.platform).toBe('workers');
});

test('GET /api/session 未注入 platform 时缺省为 node', async () => {
  const { app } = await setupApp();
  const body = await (await app.request('/api/session')).json();
  expect(body.authenticated).toBe(false);
  expect(body.platform).toBe('node');
});

test('GET /api/session 已登录时同样带回 platform', async () => {
  const { app } = await setupApp('workers');
  const cookie = await login(app, 'userA');
  const body = await (await app.request('/api/session', authed(cookie))).json();
  expect(body.authenticated).toBe(true);
  expect(body.username).toBe('userA');
  expect(body.platform).toBe('workers');
});
