// 两步验证（TOTP）端到端测试：setup → enable → 两步登录 → disable，含备份码路径。
// 内存 SQLite + 真实 app（照抄 routes.account.test.ts 脚手架）。生成合法码用 shared/totp 的 generateTotp。
import { test, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from './routes.js';
import type { Database, PreparedStatement, AppSecrets } from './types.js';
import { runStartupMigration } from './startup.js';
import { runMigrations } from './migrate.js';
import { MIGRATIONS } from './migrations.js';
import { hashPassword } from './password.js';
import { generateTotp } from './totp.js';

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

async function setupApp(): Promise<{ app: ReturnType<typeof createApp>; raw: DatabaseSync; db: Database }> {
  const { db, raw } = memDb();
  await runStartupMigration(db, SECRETS, DEPS);
  const app = createApp({ db, secrets: SECRETS });
  const hash = await hashPassword('pw-initial');
  const now = Date.now();
  raw
    .prepare(
      `INSERT INTO users (username, password_hash, role, disabled, session_version, created_at, updated_at)
       VALUES (?, ?, 'user', 0, 1, ?, ?)`,
    )
    .run('alice', hash, now, now);
  return { app, raw, db };
}

// 登录：不开 2FA 时返回 cookie；开了 2FA 时返回 { mfaRequired, ticket }（无 cookie）。
async function login(
  app: ReturnType<typeof createApp>,
  username = 'alice',
  password = 'pw-initial',
): Promise<{ status: number; cookie: string; body: Record<string, unknown> }> {
  const res = await app.request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const setCookie = res.headers.get('Set-Cookie') ?? '';
  const m = setCookie.match(/rn_session=([^;]+)/);
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, cookie: m ? `rn_session=${m[1]}` : '', body };
}

async function authed(
  app: ReturnType<typeof createApp>,
  cookie: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Cookie', cookie);
  return app.request(path, { ...init, headers });
}

function post(body: unknown): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

// 完整走一遍 setup+enable，返回 { cookie, secret, backupCodes }。
async function enroll(app: ReturnType<typeof createApp>): Promise<{ cookie: string; secret: string; backupCodes: string[] }> {
  const cookie = (await login(app)).cookie;
  const setupRes = await authed(app, cookie, '/api/account/totp/setup', post({}));
  const setup = (await setupRes.json()) as { secret: string; otpauthUri: string };
  const code = await generateTotp(setup.secret);
  const enableRes = await authed(app, cookie, '/api/account/totp/enable', post({ code }));
  const enable = (await enableRes.json()) as { ok: boolean; backupCodes: string[] };
  // enable 视为安全变更（session_version +1）并重签发 cookie，原 cookie 已作废——取新 cookie。
  const setCookie = enableRes.headers.get('Set-Cookie') ?? '';
  const m = setCookie.match(/rn_session=([^;]+)/);
  const freshCookie = m ? `rn_session=${m[1]}` : cookie;
  return { cookie: freshCookie, secret: setup.secret, backupCodes: enable.backupCodes };
}

// ==== setup / enable ====

test('setup 返回密钥与 otpauth URI，此时尚未启用（登录仍单步）', async () => {
  const { app } = await setupApp();
  const cookie = (await login(app)).cookie;
  const res = await authed(app, cookie, '/api/account/totp/setup', post({}));
  expect(res.status).toBe(200);
  const body = (await res.json()) as { secret: string; otpauthUri: string };
  expect(body.secret).toMatch(/^[A-Z2-7]+$/);
  expect(body.otpauthUri.startsWith('otpauth://totp/')).toBe(true);
  // 尚未 enable：再次登录仍单步（拿到 cookie，无 mfaRequired）。
  const relogin = await login(app);
  expect(relogin.body.mfaRequired).toBeUndefined();
  expect(relogin.cookie).not.toBe('');
});

test('enable 用错码 → 400，未启用', async () => {
  const { app } = await setupApp();
  const cookie = (await login(app)).cookie;
  await authed(app, cookie, '/api/account/totp/setup', post({}));
  const res = await authed(app, cookie, '/api/account/totp/enable', post({ code: '000000' }));
  expect(res.status).toBe(400);
  const relogin = await login(app);
  expect(relogin.body.mfaRequired).toBeUndefined();
});

test('enable 用正确码 → 启用并返回 10 个备份码，/api/me 反映 totp_enabled', async () => {
  const { app } = await setupApp();
  const { cookie, backupCodes } = await enroll(app);
  expect(Array.isArray(backupCodes)).toBe(true);
  expect(backupCodes.length).toBe(10);
  const me = await (await authed(app, cookie, '/api/me')).json() as { totp_enabled: boolean };
  expect(me.totp_enabled).toBe(true);
});

test('未 setup 直接 enable → 400', async () => {
  const { app } = await setupApp();
  const cookie = (await login(app)).cookie;
  const res = await authed(app, cookie, '/api/account/totp/enable', post({ code: '123456' }));
  expect(res.status).toBe(400);
});

// ==== 两步登录 ====

test('启用 2FA 后：登录第一步只返回 ticket（不发 cookie）', async () => {
  const { app } = await setupApp();
  await enroll(app);
  const r = await login(app);
  expect(r.body.mfaRequired).toBe(true);
  expect(typeof r.body.ticket).toBe('string');
  expect(r.cookie).toBe(''); // 关键：第一步不发会话
});

test('两步登录：ticket + 正确 TOTP 码 → 发会话', async () => {
  const { app } = await setupApp();
  const { secret } = await enroll(app);
  const first = await login(app);
  const ticket = first.body.ticket as string;
  const code = await generateTotp(secret);
  const res = await app.request('/api/login/totp', post({ ticket, code }));
  expect(res.status).toBe(200);
  const setCookie = res.headers.get('Set-Cookie') ?? '';
  expect(setCookie).toContain('rn_session=');
});

test('两步登录：错误码 → 401，不发会话', async () => {
  const { app } = await setupApp();
  await enroll(app);
  const first = await login(app);
  const ticket = first.body.ticket as string;
  const res = await app.request('/api/login/totp', post({ ticket, code: '000000' }));
  expect(res.status).toBe(401);
  expect(res.headers.get('Set-Cookie')).toBeNull();
});

test('两步登录：伪造 ticket → 401', async () => {
  const { app } = await setupApp();
  const { secret } = await enroll(app);
  const code = await generateTotp(secret);
  const res = await app.request('/api/login/totp', post({ ticket: 'forged.signature', code }));
  expect(res.status).toBe(401);
});

// ==== 备份码 ====

test('两步登录可用备份码；备份码用后即焚（第二次失败）', async () => {
  const { app } = await setupApp();
  const { backupCodes } = await enroll(app);
  const bc = backupCodes[0];
  // 第一次用备份码登录成功
  const first = await login(app);
  const res1 = await app.request('/api/login/totp', post({ ticket: first.body.ticket, code: bc }));
  expect(res1.status).toBe(200);
  // 同一备份码第二次不可用
  const second = await login(app);
  const res2 = await app.request('/api/login/totp', post({ ticket: second.body.ticket, code: bc }));
  expect(res2.status).toBe(401);
});

// ==== disable ====

test('disable 需当前密码；成功后登录回到单步', async () => {
  const { app } = await setupApp();
  const { cookie } = await enroll(app);
  // 错密码 → 400
  const bad = await authed(app, cookie, '/api/account/totp/disable', post({ password: 'wrong' }));
  expect(bad.status).toBe(400);
  // 对密码 → 200
  const ok = await authed(app, cookie, '/api/account/totp/disable', post({ password: 'pw-initial' }));
  expect(ok.status).toBe(200);
  // 登录恢复单步（enable/disable 都 +1 吊销了旧会话，这里重新登录验证单步）。
  const relogin = await login(app);
  expect(relogin.body.mfaRequired).toBeUndefined();
  expect(relogin.cookie).not.toBe('');
});
