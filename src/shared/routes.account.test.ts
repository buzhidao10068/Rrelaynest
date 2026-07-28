// 账户自服务：修改自己登录密码的集成测试。
// 复用 routes.test.ts 的内存 SQLite + 真实 Hono app 脚手架风格。
// 覆盖：字段校验 / 当前密码错 / 短密码 / 新旧相同 → 400；成功改密后
//       旧 cookie 失效（session_version +1 即时吊销）、返回的新 cookie 仍可用、
//       新密码可登录且旧密码不可。
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

  const now = Date.now();
  const hash = await hashPassword('pw-initial');
  raw
    .prepare(
      `INSERT INTO users (username, password_hash, role, disabled, session_version, created_at, updated_at)
       VALUES (?, ?, 'user', 0, 1, ?, ?)`,
    )
    .run('alice', hash, now, now);
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
  const setCookie = res.headers.get('Set-Cookie') ?? '';
  return setCookie.split(';')[0];
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

const PWCHG = '/api/account/password';

test('缺字段 → 400', async () => {
  const { app } = await setupApp();
  const cookie = await login(app, 'alice', 'pw-initial');
  const res = await app.request(PWCHG, authed(cookie, { current: 'pw-initial' }));
  expect(res.status).toBe(400);
});

test('新密码短于 8 位 → 400', async () => {
  const { app } = await setupApp();
  const cookie = await login(app, 'alice', 'pw-initial');
  const res = await app.request(PWCHG, authed(cookie, { current: 'pw-initial', next: 'short' }));
  expect(res.status).toBe(400);
});

test('当前密码错 → 400', async () => {
  const { app } = await setupApp();
  const cookie = await login(app, 'alice', 'pw-initial');
  const res = await app.request(PWCHG, authed(cookie, { current: 'wrong-pw', next: 'brand-new-pw' }));
  expect(res.status).toBe(400);
});

test('新旧密码相同 → 400', async () => {
  const { app } = await setupApp();
  const cookie = await login(app, 'alice', 'pw-initial');
  const res = await app.request(PWCHG, authed(cookie, { current: 'pw-initial', next: 'pw-initial' }));
  expect(res.status).toBe(400);
});

test('成功改密：返回新 cookie 且当前设备保持登录', async () => {
  const { app } = await setupApp();
  const cookie = await login(app, 'alice', 'pw-initial');
  const res = await app.request(PWCHG, authed(cookie, { current: 'pw-initial', next: 'brand-new-pw' }));
  expect(res.status).toBe(200);
  const newCookie = (res.headers.get('Set-Cookie') ?? '').split(';')[0];
  expect(newCookie).toContain('rn_session=');
  // 新 cookie 可用：拿它访问 /api/me
  const me = await app.request('/api/me', authed(newCookie));
  expect(me.status).toBe(200);
});

test('改密后旧 cookie 失效（session_version +1 即时吊销）', async () => {
  const { app } = await setupApp();
  const cookie = await login(app, 'alice', 'pw-initial');
  await app.request(PWCHG, authed(cookie, { current: 'pw-initial', next: 'brand-new-pw' }));
  // 旧 cookie 再访问 → 401
  const me = await app.request('/api/me', authed(cookie));
  expect(me.status).toBe(401);
});

test('改密后新密码可登录、旧密码不可', async () => {
  const { app } = await setupApp();
  const cookie = await login(app, 'alice', 'pw-initial');
  await app.request(PWCHG, authed(cookie, { current: 'pw-initial', next: 'brand-new-pw' }));
  // 新密码登录成功
  const ok = await app.request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'alice', password: 'brand-new-pw' }),
  });
  expect(ok.status).toBe(200);
  // 旧密码登录失败
  const bad = await app.request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'alice', password: 'pw-initial' }),
  });
  expect(bad.status).toBe(401);
});

const LOGOUT_ALL = '/api/account/logout-all';

test('登出所有设备：清当前 cookie + 旧 cookie 失效（session_version +1）', async () => {
  const { app } = await setupApp();
  const cookie = await login(app, 'alice', 'pw-initial');
  const res = await app.request(LOGOUT_ALL, authed(cookie, {}));
  expect(res.status).toBe(200);
  // 响应清了 cookie（Max-Age=0 / 空值）
  const setCookie = res.headers.get('Set-Cookie') ?? '';
  expect(setCookie).toContain('rn_session=;');
  // 原 cookie 再访问 → 401（session_version 已 +1）
  const me = await app.request('/api/me', authed(cookie));
  expect(me.status).toBe(401);
});

test('登出所有设备不改密码：原密码仍可登录', async () => {
  const { app } = await setupApp();
  const cookie = await login(app, 'alice', 'pw-initial');
  await app.request(LOGOUT_ALL, authed(cookie, {}));
  // 密码没变，原密码仍能重新登录
  const ok = await app.request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'alice', password: 'pw-initial' }),
  });
  expect(ok.status).toBe(200);
});
