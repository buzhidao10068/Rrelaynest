// 越权（authZ）集成测试：端到端过 app.fetch，覆盖 multiuser-plan 8.1 数据隔离。
// 用 vitest（解析完整值 import 图）+ 内存 SQLite（node:sqlite）起真实 Hono app。
// 两个用户 A/B 各建站点/代理，验证互相看不到、改不了、删不了、爬不了（404 而非 403）。
import { test, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type { Database, PreparedStatement, AppSecrets, MakeFetch } from './types.js';
import { createApp } from './routes.js';
import { runStartupMigration } from './startup.js';
import { runMigrations } from './migrate.js';
import { MIGRATIONS } from './migrations.js';
import { hashPassword } from './password.js';
import { decryptToken } from './crypto.js';

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
// secretsOverride：给「坏 ENCRYPTION_KEY」这类配置场景用（迁移/seed 仍用合法密钥的那一份，
// 它们用不到加密，与被测的加密路径无关）。
// makeFetch：注入假 fetch 拦截出站请求（跨层守卫用，见文件末 base_url 契约那一组）。
async function setupApp(
  platform?: 'node' | 'workers',
  secretsOverride?: AppSecrets,
  makeFetch?: MakeFetch,
) {
  const { db, raw } = memDb();
  const app = createApp({
    db,
    secrets: secretsOverride ?? SECRETS,
    runStartup: (d, s) => runStartupMigration(d, s, DEPS),
    ...(platform ? { platform } : {}),
    ...(makeFetch ? { makeFetch } : {}),
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

// ---- ENCRYPTION_KEY 格式契约：坏密钥不再表现为裸 500 ----
// 历史 bug：文档教用户用 `openssl rand -hex 32`（64 字符 hex → 解码 48 字节 ≠ 32），
// 于是「只要填了 Access Token 保存就 HTTP 500」。下面锁定三件事：
//   1) 合法密钥的成功路径（填 token 能存、列表显示 has_token、密文可解回原值）
//   2) 坏密钥走到保存路径时返回可读的 { error }，而不是无响应体的裸 500
//   3) configWarnings 随 /api/session 两个分支下发，前端登录页就能提示

// 旧文档产出的坏密钥形态。
const HEX_SECRETS: AppSecrets = { ...SECRETS, ENCRYPTION_KEY: 'a'.repeat(64) };

test('合法密钥：新增站点带 token 能保存，列表显示 has_token 且不回显明文', async () => {
  const { app } = await setupApp();
  const cookie = await login(app, 'userA');
  const create = await app.request(
    '/api/sites',
    authed(cookie, { name: 'S', base_url: 'https://s.example.com', token: 'sk-secret-abc' }),
  );
  expect(create.status).toBe(200);

  const list = await (await app.request('/api/sites', authed(cookie))).json();
  expect(list.sites[0].has_token).toBe(true);
  expect(JSON.stringify(list.sites[0])).not.toContain('sk-secret-abc');
});

test('合法密钥：编辑站点改 token 能保存，落库密文可解回原值', async () => {
  const { app, raw } = await setupApp();
  const cookie = await login(app, 'userA');
  const created = await (
    await app.request('/api/sites', authed(cookie, { name: 'S', base_url: 'https://s.example.com' }))
  ).json();

  const put = await app.request(`/api/sites/${created.id}`, {
    ...authed(cookie, { token: 'sk-updated-xyz' }),
    method: 'PUT',
  });
  expect(put.status).toBe(200);

  const row = raw
    .prepare('SELECT token_encrypted FROM sites WHERE id = ?')
    .get(created.id) as { token_encrypted: string };
  expect(row.token_encrypted).not.toContain('sk-updated-xyz'); // 存的是密文
  expect(await decryptToken(SECRETS.ENCRYPTION_KEY, row.token_encrypted)).toBe('sk-updated-xyz');
});

test('坏密钥（64 字符 hex）：新增站点带 token 返回可读 error 而非裸 500', async () => {
  const { app } = await setupApp(undefined, HEX_SECRETS);
  const cookie = await login(app, 'userA');
  const res = await app.request(
    '/api/sites',
    authed(cookie, { name: 'S', base_url: 'https://s.example.com', token: 'sk-x' }),
  );
  expect(res.status).toBe(500);
  const body = await res.json();
  // 关键改进不在状态码，而在有响应体：前端 readError 取 data.error 即可显示可行动的原因。
  expect(typeof body.error).toBe('string');
  expect(body.error).toContain('ENCRYPTION_KEY');
  expect(body.error).toContain('openssl rand -base64 32');
  expect(body.error).toContain('48 字节');
  expect(body.error).not.toContain(HEX_SECRETS.ENCRYPTION_KEY); // 不回显密钥内容
});

test('坏密钥：不填 token 的站点仍能正常保存（不波及无关路径）', async () => {
  const { app } = await setupApp(undefined, HEX_SECRETS);
  const cookie = await login(app, 'userA');
  const res = await app.request(
    '/api/sites',
    authed(cookie, { name: 'S', base_url: 'https://s.example.com' }),
  );
  expect(res.status).toBe(200);
});

test('坏密钥：编辑站点改 token / 新建代理带密码 也返回可读 error', async () => {
  const { app } = await setupApp(undefined, HEX_SECRETS);
  const cookie = await login(app, 'userA');
  const created = await (
    await app.request('/api/sites', authed(cookie, { name: 'S', base_url: 'https://s.example.com' }))
  ).json();

  const put = await app.request(`/api/sites/${created.id}`, {
    ...authed(cookie, { token: 'sk-x' }),
    method: 'PUT',
  });
  expect(put.status).toBe(500);
  expect((await put.json()).error).toContain('openssl rand -base64 32');

  const proxy = await app.request(
    '/api/proxies',
    authed(cookie, { name: 'p', host: '1.2.3.4', port: 1080, password: 'pw' }),
  );
  expect(proxy.status).toBe(500);
  expect((await proxy.json()).error).toContain('openssl rand -base64 32');
});

test('GET /api/session：密钥合法时 configWarnings 为空（两个分支）', async () => {
  const { app } = await setupApp();
  const anon = await (await app.request('/api/session')).json();
  expect(anon.configWarnings).toEqual([]);

  const cookie = await login(app, 'userA');
  const authedBody = await (await app.request('/api/session', authed(cookie))).json();
  expect(authedBody.configWarnings).toEqual([]);
});

test('GET /api/session：坏密钥时两个分支都带 ENCRYPTION_KEY_INVALID', async () => {
  const { app } = await setupApp(undefined, HEX_SECRETS);
  // 未登录分支也必须带 —— 否则登录页看不到提示，「部署后尽早看到」就落空了。
  const anon = await (await app.request('/api/session')).json();
  expect(anon.authenticated).toBe(false);
  expect(anon.configWarnings).toEqual(['ENCRYPTION_KEY_INVALID']);

  const cookie = await login(app, 'userA');
  const authedBody = await (await app.request('/api/session', authed(cookie))).json();
  expect(authedBody.authenticated).toBe(true);
  expect(authedBody.configWarnings).toEqual(['ENCRYPTION_KEY_INVALID']);
  // 标记只有枚举名，不含密钥内容。
  expect(JSON.stringify(authedBody)).not.toContain(HEX_SECRETS.ENCRYPTION_KEY);
});

// ==== base_url 契约：库里只许存绝对 URL（本轮修复的跨层缺口）====
// 为什么单开一组：既有全部 fixture 的 base_url 都自带协议头（'https://a.example.com' 等），
// 只覆盖「后端收到合法 URL」这一半，从不覆盖**前端真实发出的形状**（剥掉协议头的裸域名），
// 这正是这个 bug 能一路溜到线上的原因。下面的用例按前端真实形状打。

test('base_url 契约：POST /api/sites 传裸域名 → 400，不再静默入库', async () => {
  const { app } = await setupApp();
  const cookie = await login(app, 'userA');
  // 'astu.online' 就是修复前前端 normHost() 剥完协议头发出的形状。
  const res = await app.request('/api/sites', authed(cookie, { name: 'S', base_url: 'astu.online' }));
  expect(res.status).toBe(400);
  expect((await res.json()).error).toContain('http');

  // 一条都不该入库。
  const list = await (await app.request('/api/sites', authed(cookie))).json();
  expect(list.sites.length).toBe(0);
});

test('base_url 契约：POST /api/sites 传 javascript: / ftp:// / 带 query → 400', async () => {
  const { app } = await setupApp();
  const cookie = await login(app, 'userA');
  for (const bad of ['javascript:alert(1)', 'ftp://x.example.com', 'https://s.example.com?x=1', '']) {
    const res = await app.request('/api/sites', authed(cookie, { name: 'S', base_url: bad }));
    expect(res.status, `base_url=${JSON.stringify(bad)} 应被拒`).toBe(400);
  }
});

test('base_url 契约：合法 URL 入库为归一化值（去末尾斜杠、协议与主机小写）', async () => {
  const { app } = await setupApp();
  const cookie = await login(app, 'userA');
  const create = await app.request(
    '/api/sites',
    authed(cookie, { name: 'S', base_url: 'HTTPS://S.Example.com/' }),
  );
  expect(create.status).toBe(200);
  const list = await (await app.request('/api/sites', authed(cookie))).json();
  expect(list.sites[0].base_url).toBe('https://s.example.com');
});

// addedScheme 分流存在的意义就是这条：存量裸域名行（0007 之前建的，或迁移没覆盖到的）
// 在「只改备注」时不能被 400 堵死，且该顺手修成绝对 URL。
test('base_url 契约：PUT 不传 base_url 能编辑存量裸域名行，并把它修成绝对 URL', async () => {
  const { app, raw } = await setupApp();
  const cookie = await login(app, 'userA');
  const created = await (
    await app.request('/api/sites', authed(cookie, { name: 'S', base_url: 'https://s.example.com' }))
  ).json();
  // 绕开入口校验，直接把库里改成裸域名 —— 模拟旧前端存下的历史脏数据。
  raw.prepare('UPDATE sites SET base_url = ? WHERE id = ?').run('legacy.example.com', created.id);

  const res = await app.request(`/api/sites/${created.id}`, {
    ...authed(cookie, { note: '只改备注' }),
    method: 'PUT',
  });
  expect(res.status, '历史脏数据不能把无关编辑堵死').toBe(200);

  const list = await (await app.request('/api/sites', authed(cookie))).json();
  expect(list.sites[0].base_url).toBe('https://legacy.example.com'); // 顺手修好
  expect(list.sites[0].note).toBe('只改备注');
});

test('base_url 契约：PUT 显式传裸域名 → 400；不传 base_url 只改备注 → 放行', async () => {
  const { app } = await setupApp();
  const cookie = await login(app, 'userA');
  const created = await (
    await app.request('/api/sites', authed(cookie, { name: 'S', base_url: 'https://s.example.com' }))
  ).json();

  // 显式传非法值 → 400，且不落库
  const bad = await app.request(`/api/sites/${created.id}`, {
    ...authed(cookie, { base_url: 'astu.online' }),
    method: 'PUT',
  });
  expect(bad.status).toBe(400);

  // 不传 base_url（只改备注）→ 放行，地址保持原样。历史脏数据不能把无关编辑一起堵死。
  const ok = await app.request(`/api/sites/${created.id}`, {
    ...authed(cookie, { note: 'hello' }),
    method: 'PUT',
  });
  expect(ok.status).toBe(200);
  const list = await (await app.request('/api/sites', authed(cookie))).json();
  expect(list.sites[0].base_url).toBe('https://s.example.com');
  expect(list.sites[0].note).toBe('hello');
});

// 真正的跨层守卫：拿**前端修复前真实发出的形状**（剥掉协议头的裸域名）走完整条链，
// 断言「爬虫绝不会收到相对 URL」。
//
// ⚠ 这条用例的写法是被回归验证逼出来的：最初它用 'https://astu.online:8080' 建站，
// 把后端校验临时还原成修复前的样子后**它照样绿** —— 因为带协议头的输入根本不经过那段逻辑，
// 它证明的只是 happy path，不是守卫。故改成从裸域名出发，并接受两种正确结局：
// 入口拒收（当前实现），或入口放行但已归一化、爬虫仍收到绝对 URL。
// 唯一不可接受的第三种结局 = 放行了裸值 + 爬虫收到相对 URL，也就是本次故障本身。
test('base_url 契约（跨层守卫）：裸域名走完整条链，爬虫绝不会收到相对 URL', async () => {
  const seen: string[] = [];
  const makeFetch: MakeFetch = () => async (url: string) => {
    seen.push(String(url));
    return new Response(JSON.stringify({ success: true, group_ratio: {}, usable_group: {}, data: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const { app } = await setupApp(undefined, undefined, makeFetch);
  const cookie = await login(app, 'userA');

  // 绑一个启用的代理，resolveFetch 才会返回注入的假 fetch（否则回落全局 fetch，拦不住）。
  const proxy = await (
    await app.request('/api/proxies', authed(cookie, { name: 'p', host: '127.0.0.1', port: 7890 }))
  ).json();
  // 带 token 才会真正走爬取（无 token 时 scrapeAndStore 直接短路，碰不到 fetch）。
  // 带非标端口：修复前 'https://' + host 那种拼法会把端口一起弄错。
  const create = await app.request(
    '/api/sites',
    authed(cookie, {
      name: 'S',
      base_url: 'astu.online:8080', // ← 修复前前端 normHost() 剥完协议头发出的形状
      token: 'sk-test',
      proxy_id: proxy.id,
    }),
  );

  if (create.status === 200) {
    // 入口放行了 → 那它必须已经把值补成绝对 URL，且爬虫拿到的也必须是绝对的。
    const created = await create.json();
    const scrape = await app.request(`/api/sites/${created.id}/scrape`, {
      ...authed(cookie),
      method: 'POST',
    });
    expect(scrape.status).toBe(200);
    const outcome = await scrape.json();
    expect(outcome.ok, `爬取应成功，实际 error=${outcome.error}`).toBe(true);

    expect(seen.length, '应当真的发出了请求').toBeGreaterThan(0);
    for (const url of seen) {
      // ⚠ 有牙的是下面那条正则，不是 new URL。实测 new URL('astu.online:8080/api/pricing')
      // **不抛**（被当成协议 astu.online: + 路径 8080/api/pricing）—— 这正是本次故障能
      // 一路走到 fetch 的原因之一，所以「new URL 没抛」证明不了 URL 是绝对的。
      // 保留这条只作解析健全性兜底（'a b' 那类彻底畸形的值仍会在这里抛）。
      expect(() => new URL(url), `爬虫收到的不是可解析的 URL：${url}`).not.toThrow();
      expect(/^https?:\/\//.test(url), `爬虫收到的 URL 缺协议头：${url}`).toBe(true);
    }
    expect(seen[0]).toBe('https://astu.online:8080/api/pricing');
  } else {
    // 当前实现：入口就把裸域名拦掉，链路后半段无从发生（库里不会有这种行）。
    expect(create.status).toBe(400);
    const list = await (await app.request('/api/sites', authed(cookie))).json();
    expect(list.sites.length, '被拒的站点不该入库').toBe(0);
    expect(seen.length, '没有站点就不该有任何出站请求').toBe(0);
  }
});

// 补上另一半：合法地址建站后，爬虫确实收到拼好的绝对 URL（含非标端口与子路径）。
// 这条不依赖入口校验，故不能替代上面那条守卫 —— 两条各管一半。
test('base_url 契约：合法地址建站后，爬虫收到的 URL 由 base_url 原样拼出', async () => {
  const seen: string[] = [];
  const makeFetch: MakeFetch = () => async (url: string) => {
    seen.push(String(url));
    return new Response(
      JSON.stringify({ success: true, group_ratio: {}, usable_group: {}, data: [] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };
  const { app } = await setupApp(undefined, undefined, makeFetch);
  const cookie = await login(app, 'userA');
  const proxy = await (
    await app.request('/api/proxies', authed(cookie, { name: 'p', host: '127.0.0.1', port: 7890 }))
  ).json();
  // http（不是 https）+ 非标端口 + 子路径：三样都必须原样保留，不被静默改写。
  const created = await (
    await app.request(
      '/api/sites',
      authed(cookie, {
        name: 'S',
        base_url: 'http://1.2.3.4:3000/v1/',
        token: 'sk-test',
        proxy_id: proxy.id,
      }),
    )
  ).json();

  const scrape = await app.request(`/api/sites/${created.id}/scrape`, {
    ...authed(cookie),
    method: 'POST',
  });
  expect(scrape.status).toBe(200);
  expect((await scrape.json()).ok).toBe(true);
  expect(seen[0]).toBe('http://1.2.3.4:3000/v1/api/pricing');
});
