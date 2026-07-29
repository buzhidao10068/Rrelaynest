// Passkey / WebAuthn 端到端测试：注册（options+verify）→ 列/删凭证 → 无密码登录（options+verify）。
// 内存 SQLite + 真实 app（照抄 routes.totp.test.ts 脚手架）。
//
// 难点：SimpleWebAuthn 的 verifyRegistrationResponse / verifyAuthenticationResponse 需要真实认证器
// 的加密签名，纯单测无法伪造合法响应。故用 vi.mock 把这两个 verify 函数替换为可控桩，
// 专注测「我方逻辑」：挑战票验签/过期/跨用途隔离、凭证存取、counter 更新、归属校验、
// 无密码登录发会话、白名单路由可达。generate*Options 用真实实现（不需认证器，纯产 challenge）。
import { test, expect, vi, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

// ---- mock SimpleWebAuthn 的两个 verify（其余真实）----
// 用可变的桩：默认「验证通过」，个别用例改成「失败」以测拒绝路径。
const verifyRegState = { verified: true, counter: 0 };
const verifyAuthState = { verified: true, newCounter: 1 };

vi.mock('@simplewebauthn/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@simplewebauthn/server')>();
  return {
    ...actual,
    // 注册验证：桩返回一个可控的 registrationInfo.credential（id/publicKey/counter）。
    verifyRegistrationResponse: vi.fn(async (opts: { response: { id: string } }) => {
      if (!verifyRegState.verified) return { verified: false } as const;
      return {
        verified: true,
        registrationInfo: {
          credential: {
            id: opts.response.id,
            publicKey: new Uint8Array([1, 2, 3, 4]),
            counter: verifyRegState.counter,
            transports: ['internal'],
          },
          credentialDeviceType: 'singleDevice',
          credentialBackedUp: false,
        },
      } as unknown as Awaited<ReturnType<typeof actual.verifyRegistrationResponse>>;
    }),
    // 认证验证：桩返回可控的 newCounter。
    verifyAuthenticationResponse: vi.fn(async () => {
      if (!verifyAuthState.verified) return { verified: false } as const;
      return {
        verified: true,
        authenticationInfo: { newCounter: verifyAuthState.newCounter },
      } as unknown as Awaited<ReturnType<typeof actual.verifyAuthenticationResponse>>;
    }),
  };
});

import { createApp } from './routes.js';
import type { Database, PreparedStatement, AppSecrets } from './types.js';
import { runStartupMigration } from './startup.js';
import { runMigrations } from './migrate.js';
import { MIGRATIONS } from './migrations.js';
import { hashPassword } from './password.js';
import { createChallengeTicket } from './auth.js';

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

// 用固定 Host 请求，使 rpID/origin 稳定（options 与 verify 两步 rpID 必须一致）。
const ORIGIN = 'https://panel.example.com';

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

async function login(app: ReturnType<typeof createApp>, username = 'alice', password = 'pw-initial'): Promise<string> {
  const res = await app.request(`${ORIGIN}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const setCookie = res.headers.get('Set-Cookie') ?? '';
  const m = setCookie.match(/rn_session=([^;]+)/);
  return m ? `rn_session=${m[1]}` : '';
}

function req(path: string, init: RequestInit = {}, cookie?: string): Request {
  const headers = new Headers(init.headers);
  if (cookie) headers.set('Cookie', cookie);
  if (init.body) headers.set('Content-Type', 'application/json');
  return new Request(`${ORIGIN}${path}`, { ...init, headers });
}

function post(body: unknown): RequestInit {
  return { method: 'POST', body: JSON.stringify(body) };
}

// 走一遍注册：options（真实，产 ticket）→ verify（verify 函数被 mock 成通过）。
// 返回注册的 credentialId（供后续登录/删除用）。
async function registerPasskey(
  app: ReturnType<typeof createApp>,
  cookie: string,
  credentialId: string,
  name?: string,
): Promise<Response> {
  const optRes = await app.request(req('/api/account/passkey/register/options', post({}), cookie));
  const opt = (await optRes.json()) as { ticket: string };
  return app.request(
    req(
      '/api/account/passkey/register/verify',
      post({ ticket: opt.ticket, response: { id: credentialId, response: { transports: ['internal'] } }, name }),
      cookie,
    ),
  );
}

beforeEach(() => {
  verifyRegState.verified = true;
  verifyRegState.counter = 0;
  verifyAuthState.verified = true;
  verifyAuthState.newCounter = 1;
});

// ==== 注册 ====

test('注册 options 返回 challenge 与 ticket', async () => {
  const { app } = await setupApp();
  const cookie = await login(app);
  const res = await app.request(req('/api/account/passkey/register/options', post({}), cookie));
  expect(res.status).toBe(200);
  const body = (await res.json()) as { options: { challenge: string; rp: { id: string } }; ticket: string };
  expect(typeof body.options.challenge).toBe('string');
  expect(body.options.rp.id).toBe('panel.example.com'); // rpID 从 Host 推导
  expect(typeof body.ticket).toBe('string');
});

test('注册 verify（验证通过）→ 存凭证，/api/account/passkeys 可列出', async () => {
  const { app } = await setupApp();
  const cookie = await login(app);
  const res = await registerPasskey(app, cookie, 'cred-AAA', 'MacBook');
  expect(res.status).toBe(200);
  const list = (await (await app.request(req('/api/account/passkeys', {}, cookie))).json()) as {
    passkeys: { id: number; name: string | null }[];
  };
  expect(list.passkeys.length).toBe(1);
  expect(list.passkeys[0].name).toBe('MacBook');
});

test('注册 verify：认证器验证失败 → 400，不存凭证', async () => {
  const { app } = await setupApp();
  const cookie = await login(app);
  verifyRegState.verified = false;
  const res = await registerPasskey(app, cookie, 'cred-fail');
  expect(res.status).toBe(400);
  const list = (await (await app.request(req('/api/account/passkeys', {}, cookie))).json()) as { passkeys: unknown[] };
  expect(list.passkeys.length).toBe(0);
});

test('注册 verify：伪造 ticket → 400', async () => {
  const { app } = await setupApp();
  const cookie = await login(app);
  const res = await app.request(
    req(
      '/api/account/passkey/register/verify',
      post({ ticket: 'forged.sig', response: { id: 'x', response: {} } }),
      cookie,
    ),
  );
  expect(res.status).toBe(400);
});

test('注册 verify：拿「认证票」冒充「注册票」→ 400（跨用途隔离）', async () => {
  const { app } = await setupApp();
  const cookie = await login(app);
  // 手造一张 auth-kind 票，challenge 任意；注册 verify 要求 reg-kind，应拒。
  const authTicket = await createChallengeTicket(SECRETS.SESSION_SECRET, 'auth', 'some-challenge');
  const res = await app.request(
    req(
      '/api/account/passkey/register/verify',
      post({ ticket: authTicket, response: { id: 'x', response: {} } }),
      cookie,
    ),
  );
  expect(res.status).toBe(400);
});

test('重复注册同一 credential_id → 409', async () => {
  const { app } = await setupApp();
  const cookie = await login(app);
  expect((await registerPasskey(app, cookie, 'cred-dup')).status).toBe(200);
  expect((await registerPasskey(app, cookie, 'cred-dup')).status).toBe(409);
});

// ==== 删除 / 归属 ====

test('删自己的 Passkey → 200；再删 → 404', async () => {
  const { app } = await setupApp();
  const cookie = await login(app);
  await registerPasskey(app, cookie, 'cred-del');
  const list = (await (await app.request(req('/api/account/passkeys', {}, cookie))).json()) as {
    passkeys: { id: number }[];
  };
  const id = list.passkeys[0].id;
  expect((await app.request(req(`/api/account/passkeys/${id}`, { method: 'DELETE' }, cookie))).status).toBe(200);
  expect((await app.request(req(`/api/account/passkeys/${id}`, { method: 'DELETE' }, cookie))).status).toBe(404);
});

test('删他人的 Passkey → 404（归属校验，不越权）', async () => {
  const { app, raw } = await setupApp();
  const aliceCookie = await login(app);
  await registerPasskey(app, aliceCookie, 'cred-alice');
  const aliceCred = raw.prepare("SELECT id FROM webauthn_credentials WHERE credential_id = 'cred-alice'").get() as {
    id: number;
  };
  // 造第二个用户 bob 并以其身份尝试删 alice 的凭证。
  const hash = await hashPassword('pw-bob');
  const now = Date.now();
  raw
    .prepare(
      `INSERT INTO users (username, password_hash, role, disabled, session_version, created_at, updated_at)
       VALUES (?, ?, 'user', 0, 1, ?, ?)`,
    )
    .run('bob', hash, now, now);
  const bobCookie = await login(app, 'bob', 'pw-bob');
  const res = await app.request(req(`/api/account/passkeys/${aliceCred.id}`, { method: 'DELETE' }, bobCookie));
  expect(res.status).toBe(404); // 不区分「不存在」与「无权」
  // alice 的凭证仍在。
  const still = raw.prepare("SELECT COUNT(*) AS n FROM webauthn_credentials WHERE credential_id = 'cred-alice'").get() as {
    n: number;
  };
  expect(still.n).toBe(1);
});

// ==== 无密码登录 ====

test('无密码登录 options 免登录可达，返回 challenge + ticket', async () => {
  const { app } = await setupApp();
  const res = await app.request(req('/api/login/passkey/options', post({})));
  expect(res.status).toBe(200); // 白名单：无需会话
  const body = (await res.json()) as { options: { challenge: string }; ticket: string };
  expect(typeof body.options.challenge).toBe('string');
  expect(typeof body.ticket).toBe('string');
});

test('无密码登录 verify（验证通过）→ 发会话 cookie，counter 被更新', async () => {
  const { app, raw } = await setupApp();
  const cookie = await login(app);
  await registerPasskey(app, cookie, 'cred-login'); // 初始 counter=0
  // 走无密码登录：options → verify。桩把 newCounter 设为 7。
  verifyAuthState.newCounter = 7;
  const optRes = await app.request(req('/api/login/passkey/options', post({})));
  const opt = (await optRes.json()) as { ticket: string };
  const res = await app.request(
    req('/api/login/passkey/verify', post({ ticket: opt.ticket, response: { id: 'cred-login', response: {} } })),
  );
  expect(res.status).toBe(200);
  expect(res.headers.get('Set-Cookie') ?? '').toContain('rn_session=');
  const row = raw.prepare("SELECT counter, last_used_at FROM webauthn_credentials WHERE credential_id = 'cred-login'").get() as {
    counter: number;
    last_used_at: number | null;
  };
  expect(row.counter).toBe(7);
  expect(row.last_used_at).not.toBeNull();
});

test('无密码登录 verify：未知 credential_id → 401', async () => {
  const { app } = await setupApp();
  const optRes = await app.request(req('/api/login/passkey/options', post({})));
  const opt = (await optRes.json()) as { ticket: string };
  const res = await app.request(
    req('/api/login/passkey/verify', post({ ticket: opt.ticket, response: { id: 'nonexistent', response: {} } })),
  );
  expect(res.status).toBe(401);
});

test('无密码登录 verify：认证器验证失败 → 401，不发会话', async () => {
  const { app } = await setupApp();
  const cookie = await login(app);
  await registerPasskey(app, cookie, 'cred-authfail');
  verifyAuthState.verified = false;
  const optRes = await app.request(req('/api/login/passkey/options', post({})));
  const opt = (await optRes.json()) as { ticket: string };
  const res = await app.request(
    req('/api/login/passkey/verify', post({ ticket: opt.ticket, response: { id: 'cred-authfail', response: {} } })),
  );
  expect(res.status).toBe(401);
  expect(res.headers.get('Set-Cookie')).toBeNull();
});

test('无密码登录 verify：拿「注册票」冒充「认证票」→ 401（跨用途隔离）', async () => {
  const { app } = await setupApp();
  const cookie = await login(app);
  await registerPasskey(app, cookie, 'cred-crosskind');
  // 手造 reg-kind 票；认证 verify 要求 auth-kind，应拒（在查凭证之前就挡掉）。
  const regTicket = await createChallengeTicket(SECRETS.SESSION_SECRET, 'reg', 'some-challenge', 1);
  const res = await app.request(
    req('/api/login/passkey/verify', post({ ticket: regTicket, response: { id: 'cred-crosskind', response: {} } })),
  );
  expect(res.status).toBe(401);
});

test('无密码登录 verify：停用用户的 Passkey → 401', async () => {
  const { app, raw } = await setupApp();
  const cookie = await login(app);
  await registerPasskey(app, cookie, 'cred-disabled');
  raw.prepare("UPDATE users SET disabled = 1 WHERE username = 'alice'").run();
  const optRes = await app.request(req('/api/login/passkey/options', post({})));
  const opt = (await optRes.json()) as { ticket: string };
  const res = await app.request(
    req('/api/login/passkey/verify', post({ ticket: opt.ticket, response: { id: 'cred-disabled', response: {} } })),
  );
  expect(res.status).toBe(401);
});
