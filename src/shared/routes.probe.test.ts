// 测活（连通性 + 渠道测试）+ 测活词池 CRUD 集成测试：覆盖 [[activity-probe-backend-todo]]。
// 端到端过 app.fetch，内存 SQLite 起真实 Hono app。出站请求用注入的 makeFetch 桩拦截
// （给站点绑一个 enabled 代理 → resolveFetch 返回桩 fetch），从而无网络地断言探测逻辑。
import { test, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type { Database, PreparedStatement, AppSecrets, ProxyConfig } from './types.js';
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

// 记录桩收到的请求，供断言 URL / body。返回值由测试用例用 setResponder 注入。
interface StubCall {
  url: string;
  init: { method?: string; body?: string } | undefined;
}

// 起 app：注入 makeFetch 桩。桩忽略代理配置，按 responder 返回响应并记录调用。
function setupApp(responder: (url: string, init: unknown) => Response) {
  const { db, raw } = memDb();
  const calls: StubCall[] = [];
  const makeFetch = (_cfg: ProxyConfig) => {
    return async (url: string, init?: unknown): Promise<Response> => {
      calls.push({ url, init: init as { method?: string; body?: string } | undefined });
      return responder(url, init);
    };
  };
  const app = createApp({
    db,
    secrets: SECRETS,
    makeFetch,
    runStartup: (d, s) => runStartupMigration(d, s, DEPS),
  });
  return { app, raw, calls, db };
}

// seed admin + 建一个普通用户 userA（密码 pw），返回 uid。
async function seed(raw: DatabaseSync, db: Database): Promise<number> {
  await runStartupMigration(db, SECRETS, DEPS);
  const now = Date.now();
  const hash = await hashPassword('pw');
  const info = raw
    .prepare(
      `INSERT INTO users (username, password_hash, role, disabled, session_version, created_at, updated_at)
       VALUES (?, ?, 'user', 0, 1, ?, ?)`,
    )
    .run('userA', hash, now, now);
  return Number(info.lastInsertRowid);
}

async function login(app: ReturnType<typeof createApp>, username: string): Promise<string> {
  const res = await app.request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'pw' }),
  });
  expect(res.status).toBe(200);
  return (res.headers.get('Set-Cookie') ?? '').split(';')[0];
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

// 给 userA 建一个站点 + 一个 enabled 代理并绑上（让 resolveFetch 返回桩 fetch）。
async function makeSite(
  raw: DatabaseSync,
  uid: number,
  opts?: { probeText?: string | null },
): Promise<number> {
  const now = Date.now();
  const proxy = raw
    .prepare(
      `INSERT INTO proxies (user_id, name, type, host, port, username, password_encrypted, enabled, created_at, updated_at)
       VALUES (?, 'p', 'http', '127.0.0.1', 7890, NULL, NULL, 1, ?, ?)`,
    )
    .run(uid, now, now);
  const pid = Number(proxy.lastInsertRowid);
  // token 需可解密：用 admin bootstrap 后的 ENCRYPTION_KEY 走真实 encrypt 较繁琐；
  // 这里直接存明文占位 + 让渠道测试的 token 解密走 catch。改用真实加密见下方专门用例。
  const info = raw
    .prepare(
      `INSERT INTO sites (user_id, name, base_url, token_encrypted, currency, checkin_enabled, checkin_done, sort_order, proxy_id, probe_text, created_at, updated_at)
       VALUES (?, 's', 'https://s.example.com', NULL, 'USD', 0, 0, 0, ?, ?, ?, ?)`,
    )
    .run(uid, pid, opts?.probeText ?? null, now, now);
  return Number(info.lastInsertRowid);
}

test('ping 正常：桩返回 200 → ok=true，命中 /api/pricing', async () => {
  const { app, raw, calls, db } = setupApp(() => new Response('{}', { status: 200 }));
  const uid = await seed(raw, db);
  const cookie = await login(app, 'userA');
  const sid = await makeSite(raw, uid);

  const res = await app.request(`/api/sites/${sid}/ping`, { ...authed(cookie), method: 'POST' });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.status).toBe(200);
  expect(calls[0].url).toContain('/api/pricing');
});

test('ping 不可达：桩返回 502 → ok=false', async () => {
  const { app, raw, db } = setupApp(() => new Response('bad', { status: 502 }));
  const uid = await seed(raw, db);
  const cookie = await login(app, 'userA');
  const sid = await makeSite(raw, uid);

  const res = await app.request(`/api/sites/${sid}/ping`, { ...authed(cookie), method: 'POST' });
  const body = await res.json();
  expect(body.ok).toBe(false);
  expect(body.status).toBe(502);
});

test('ping 越权：他人站点 → 404', async () => {
  const { app, raw, db } = setupApp(() => new Response('{}', { status: 200 }));
  const uid = await seed(raw, db);
  const cookie = await login(app, 'userA');
  const sid = await makeSite(raw, uid);

  // 另建 userB
  const now = Date.now();
  const hash = await hashPassword('pw');
  raw
    .prepare(
      `INSERT INTO users (username, password_hash, role, disabled, session_version, created_at, updated_at)
       VALUES ('userB', ?, 'user', 0, 1, ?, ?)`,
    )
    .run(hash, now, now);
  const cookieB = await login(app, 'userB');

  const res = await app.request(`/api/sites/${sid}/ping`, { ...authed(cookieB), method: 'POST' });
  expect(res.status).toBe(404);
});

test('channel-test 跳过：无 token → 400', async () => {
  const { app, raw, db } = setupApp(() => new Response('{}', { status: 200 }));
  const uid = await seed(raw, db);
  const cookie = await login(app, 'userA');
  const sid = await makeSite(raw, uid); // token_encrypted = NULL

  const res = await app.request(`/api/sites/${sid}/channel-test`, {
    ...authed(cookie, { model: 'gpt-4' }),
    method: 'POST',
  });
  expect(res.status).toBe(400);
});

test('测活词池 CRUD：增改删 + 查重 409', async () => {
  const { app, raw, db } = setupApp(() => new Response('{}', { status: 200 }));
  const uid = await seed(raw, db);
  const cookie = await login(app, 'userA');
  void uid;

  // 增
  const add = await app.request('/api/probe-words', authed(cookie, { text: 'hi' }));
  expect(add.status).toBe(200);
  const { id } = await add.json();

  // 查重 → 409
  const dup = await app.request('/api/probe-words', authed(cookie, { text: 'hi' }));
  expect(dup.status).toBe(409);

  // 列表
  const list = await (await app.request('/api/probe-words', authed(cookie))).json();
  expect(list.words.length).toBe(1);
  expect(list.words[0].text).toBe('hi');

  // 改名
  const put = await app.request(`/api/probe-words/${id}`, {
    ...authed(cookie, { text: 'hello' }),
    method: 'PUT',
  });
  expect(put.status).toBe(200);
  const list2 = await (await app.request('/api/probe-words', authed(cookie))).json();
  expect(list2.words[0].text).toBe('hello');

  // 删
  const del = await app.request(`/api/probe-words/${id}`, { ...authed(cookie), method: 'DELETE' });
  expect(del.status).toBe(200);
  const list3 = await (await app.request('/api/probe-words', authed(cookie))).json();
  expect(list3.words.length).toBe(0);
});

test('测活词改名级联：绑定该词的站点 probe_text 同步改名', async () => {
  const { app, raw, db } = setupApp(() => new Response('{}', { status: 200 }));
  const uid = await seed(raw, db);
  const cookie = await login(app, 'userA');

  const add = await app.request('/api/probe-words', authed(cookie, { text: 'hi' }));
  const { id } = await add.json();
  const sid = await makeSite(raw, uid, { probeText: 'hi' });

  await app.request(`/api/probe-words/${id}`, {
    ...authed(cookie, { text: 'hola' }),
    method: 'PUT',
  });

  const row = raw.prepare('SELECT probe_text FROM sites WHERE id = ?').get(sid) as {
    probe_text: string;
  };
  expect(row.probe_text).toBe('hola');
});

test('测活词删除级联：绑定该词的站点 probe_text 置空', async () => {
  const { app, raw, db } = setupApp(() => new Response('{}', { status: 200 }));
  const uid = await seed(raw, db);
  const cookie = await login(app, 'userA');

  const add = await app.request('/api/probe-words', authed(cookie, { text: 'hi' }));
  const { id } = await add.json();
  const sid = await makeSite(raw, uid, { probeText: 'hi' });

  await app.request(`/api/probe-words/${id}`, { ...authed(cookie), method: 'DELETE' });

  const row = raw.prepare('SELECT probe_text FROM sites WHERE id = ?').get(sid) as {
    probe_text: string | null;
  };
  expect(row.probe_text).toBe(null);
});

test('测活词隔离：B 看不到 A 的词，PUT/DELETE 他人词 → 404', async () => {
  const { app, raw, db } = setupApp(() => new Response('{}', { status: 200 }));
  await seed(raw, db);
  const cookieA = await login(app, 'userA');

  const now = Date.now();
  const hash = await hashPassword('pw');
  raw
    .prepare(
      `INSERT INTO users (username, password_hash, role, disabled, session_version, created_at, updated_at)
       VALUES ('userB', ?, 'user', 0, 1, ?, ?)`,
    )
    .run(hash, now, now);
  const cookieB = await login(app, 'userB');

  const add = await app.request('/api/probe-words', authed(cookieA, { text: 'secret' }));
  const { id } = await add.json();

  const listB = await (await app.request('/api/probe-words', authed(cookieB))).json();
  expect(listB.words.length).toBe(0);

  const put = await app.request(`/api/probe-words/${id}`, {
    ...authed(cookieB, { text: 'x' }),
    method: 'PUT',
  });
  expect(put.status).toBe(404);
  const del = await app.request(`/api/probe-words/${id}`, { ...authed(cookieB), method: 'DELETE' });
  expect(del.status).toBe(404);
});
