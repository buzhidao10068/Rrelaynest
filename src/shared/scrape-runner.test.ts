// scrape-runner 的超时/重试/配置读取集成测试：验证 [[scraper-backend-concurrency-todo]] 补齐的后端逻辑。
// 用内存 SQLite + 注入的假 fetch（经 makeFetch）驱动 scrapeAndStore，断言重试次数与 last_error。
import { test, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type { Database, PreparedStatement, AppSecrets, SiteRow, MakeFetch, FetchLike } from './types.js';
import { runStartupMigration } from './startup.js';
import { runMigrations } from './migrate.js';
import { MIGRATIONS } from './migrations.js';
import { hashPassword } from './password.js';
import { encryptToken } from './crypto.js';
import { scrapeAndStore, readScrapeConfig } from './scrape-runner.js';

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
  ADMIN_PASSWORD: 'pw',
  SESSION_SECRET: 'sess',
  ENCRYPTION_KEY: btoa(String.fromCharCode(...new Uint8Array(32))),
};
const DEPS = { runMigrations, hashPassword, migrations: MIGRATIONS };

// 起一个已 seed admin 的库，并给 admin 建一个绑定了（启用）代理的站点。
// 绑代理是为了让 resolveFetch 返回注入的假 fetch（否则回落全局 fetch，无法拦截）。
async function setup() {
  const { db, raw } = memDb();
  await runStartupMigration(db, SECRETS, DEPS);
  const adminId = (raw.prepare("SELECT id FROM users WHERE role='admin'").get() as { id: number }).id;
  const now = Date.now();
  raw
    .prepare(
      `INSERT INTO proxies (user_id, name, type, host, port, enabled, created_at, updated_at)
       VALUES (?, 'p', 'http', '127.0.0.1', 7890, 1, ?, ?)`,
    )
    .run(adminId, now, now);
  const proxyId = Number(
    (raw.prepare('SELECT id FROM proxies WHERE user_id = ?').get(adminId) as { id: number }).id,
  );
  const tokenEnc = await encryptToken(SECRETS.ENCRYPTION_KEY, 'tok-123');
  raw
    .prepare(
      `INSERT INTO sites (user_id, name, base_url, token_encrypted, currency, checkin_enabled, checkin_done, sort_order, proxy_id, created_at, updated_at)
       VALUES (?, 's1', 'https://api.example.com', ?, 'USD', 0, 0, 0, ?, ?, ?)`,
    )
    .run(adminId, tokenEnc, proxyId, now, now);
  const site = raw.prepare('SELECT * FROM sites WHERE user_id = ?').get(adminId) as SiteRow;
  return { db, raw, adminId, site };
}

// 假 fetch 工厂：忽略代理配置，返回一个记录调用次数、可编排响应的 fetch。
function fakeFetchFactory(handler: (url: string, callIndex: number) => Promise<Response>): {
  makeFetch: MakeFetch;
  calls: () => number;
} {
  let n = 0;
  const impl: FetchLike = (url) => {
    const i = n++;
    return handler(String(url), i);
  };
  return { makeFetch: () => impl, calls: () => n };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// pricing 成功响应（scrapeSite 的核心接口）。
const PRICING_OK = { success: true, group_ratio: { default: 1 }, usable_group: { default: 'Default' }, data: [] };

test('readScrapeConfig：缺省回落默认（15s 超时 / 1 次重试 / 5 并发）', async () => {
  const { db, adminId } = await setup();
  const { config, concurrency } = await readScrapeConfig(db, adminId);
  expect(config.timeoutMs).toBe(15_000);
  expect(config.retries).toBe(1);
  expect(concurrency).toBe(5);
});

test('readScrapeConfig：读面板设置并夹到安全范围', async () => {
  const { db, adminId } = await setup();
  // 写入越界值：超时 9999s（>600 封顶）、重试 -3（<0 归 0）、并发 0（<1 归 1）。
  for (const [k, v] of [
    ['scrape_timeout_sec', '9999'],
    ['scrape_retry', '-3'],
    ['scrape_concurrency', '0'],
  ] as const) {
    await db
      .prepare('INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id,key) DO UPDATE SET value=?')
      .bind(adminId, k, v, v)
      .run();
  }
  const { config, concurrency } = await readScrapeConfig(db, adminId);
  expect(config.timeoutMs).toBe(600_000); // 600s 封顶
  expect(config.retries).toBe(0);
  expect(concurrency).toBe(1);
});

test('重试：pricing 前两次失败、第三次成功 → retries=2 时最终成功', async () => {
  const { db, site } = await setup();
  const { makeFetch, calls } = fakeFetchFactory(async (url, i) => {
    // 只有 pricing 参与重试；每次 scrapeSite 都先打 pricing。
    if (url.includes('/api/pricing')) {
      if (i < 2) throw new Error('ECONNRESET');
      return jsonResponse(PRICING_OK);
    }
    return jsonResponse({ data: { quota: 500000 } }); // /api/user/self
  });

  const outcome = await scrapeAndStore(db, SECRETS, site, makeFetch, { retries: 2, timeoutMs: 0 });
  expect(outcome.ok).toBe(true);
  // pricing 调 3 次（2 失败 + 1 成功），成功后再调 1 次 self → 共 4 次。
  expect(calls()).toBe(4);
});

test('重试耗尽：retries=1 时 pricing 一直失败 → 失败并写 last_error', async () => {
  const { db, raw, site } = await setup();
  const { makeFetch, calls } = fakeFetchFactory(async (url) => {
    if (url.includes('/api/pricing')) throw new Error('ECONNRESET');
    return jsonResponse({ data: { quota: 0 } });
  });

  const outcome = await scrapeAndStore(db, SECRETS, site, makeFetch, { retries: 1, timeoutMs: 0 });
  expect(outcome.ok).toBe(false);
  // retries=1 → pricing 尝试 2 次（1 初始 + 1 重试），全失败。
  expect(calls()).toBe(2);
  const row = raw.prepare('SELECT last_error FROM sites WHERE id = ?').get(site.id) as { last_error: string };
  expect(row.last_error).toContain('ECONNRESET');
});

test('超时：慢响应超过 timeoutMs → AbortError 转可读超时消息', async () => {
  const { db, raw, site } = await setup();
  const { makeFetch } = fakeFetchFactory((url, _i) => {
    // 模拟慢请求：直到 signal abort 才 reject（scraper 用 AbortController）。
    return new Promise<Response>((_resolve, reject) => {
      // 永不 resolve；依赖 fetchWithTimeout 的 abort。但假 fetch 未接 signal，
      // 故手动在 40ms 后按超时约定 reject 一个 AbortError（模拟 undici 行为）。
      setTimeout(() => {
        const e = new Error('aborted');
        e.name = 'AbortError';
        reject(e);
      }, 40);
    });
  });

  const outcome = await scrapeAndStore(db, SECRETS, site, makeFetch, { retries: 0, timeoutMs: 20 });
  expect(outcome.ok).toBe(false);
  const row = raw.prepare('SELECT last_error FROM sites WHERE id = ?').get(site.id) as { last_error: string };
  expect(row.last_error).toContain('超时');
});
