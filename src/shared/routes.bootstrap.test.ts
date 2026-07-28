// Workers 首装引导端点 /api/admin/bootstrap 集成测试：覆盖 multiuser-plan 8.6 用例 31/32。
// 与 routes.admin.test.ts 不同，这里**不预先**跑 startup，以便验证「令牌闸」在空库上的行为，
// 以及「幂等闸」在已初始化后的空操作。app 注入 runStartup，使 bootstrap 端点可用（模拟 Workers 部署）。
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

// 最小内存 Database 适配器（与其他集成测试同款）。
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
  ADMIN_PASSWORD: 'boot-token-pw',
  SESSION_SECRET: 'test-session-secret',
  ENCRYPTION_KEY: btoa(String.fromCharCode(...new Uint8Array(32))),
};

const DEPS = { runMigrations, hashPassword, migrations: MIGRATIONS };

// 注入 runStartup 的 app（模拟 Workers：无启动钩子，靠 bootstrap 首访引导）。
// 真实 Workers 部署时 DDL 已由 `wrangler d1 migrations apply` 建好（见 multiuser-plan 第六节），
// bootstrap 只负责 seed + 回填；故这里先跑迁移建表（不 seed），再交给 bootstrap 引导。
async function bootstrapApp() {
  const { db, raw } = memDb();
  const app = createApp({ db, secrets: SECRETS, runStartup: (d, s) => runStartupMigration(d, s, DEPS) });
  await runMigrations(db, MIGRATIONS); // 模拟部署时 `wrangler d1 migrations apply`（仅 DDL，无 seed）
  return { app, raw };
}

function bootstrapReq(token?: string): RequestInit {
  const init: RequestInit = { method: 'POST' };
  if (token !== undefined) init.headers = { Authorization: `Bearer ${token}` };
  return init;
}

// 令牌闸在幂等闸之前：错误/缺失令牌应在查 users 表之前就返回 401，绝不触发 seed。

// ==== 8.6 Bootstrap（Workers 首装）====

test('8.6-32 bootstrap 令牌校验：无令牌 → 401，且不初始化', async () => {
  const { app, raw } = await bootstrapApp();
  const res = await app.request('/api/admin/bootstrap', bootstrapReq());
  expect(res.status).toBe(401);
  // 令牌闸在最前，seed 从未执行：DDL 已建 users 表但应为空（无 admin）。
  const adminCount = (raw.prepare("SELECT COUNT(*) c FROM users WHERE role='admin'").get() as { c: number }).c;
  expect(adminCount).toBe(0);
});

test('8.6-32 bootstrap 令牌校验：错误令牌 → 401', async () => {
  const { app } = await bootstrapApp();
  const res = await app.request('/api/admin/bootstrap', bootstrapReq('wrong-token'));
  expect(res.status).toBe(401);
});

test('8.6-31 bootstrap 幂等闸：正确令牌首次 → 初始化；再调 → 已初始化、不重复 seed', async () => {
  const { app, raw } = await bootstrapApp();

  // 首次：正确令牌（= ADMIN_PASSWORD），执行 seed + 回填。
  const first = await app.request('/api/admin/bootstrap', bootstrapReq(SECRETS.ADMIN_PASSWORD));
  expect(first.status).toBe(200);
  const firstBody = await first.json();
  expect(firstBody.ok).toBe(true);
  expect(firstBody.alreadyInitialized).toBe(false);
  // seed 出一个 admin。
  expect(
    (raw.prepare("SELECT COUNT(*) c FROM users WHERE role='admin'").get() as { c: number }).c,
  ).toBe(1);

  // 再调：幂等闸命中，返回「已初始化」，不新增 admin。
  const second = await app.request('/api/admin/bootstrap', bootstrapReq(SECRETS.ADMIN_PASSWORD));
  expect(second.status).toBe(200);
  const secondBody = await second.json();
  expect(secondBody.ok).toBe(true);
  expect(secondBody.alreadyInitialized).toBe(true);
  expect(
    (raw.prepare("SELECT COUNT(*) c FROM users WHERE role='admin'").get() as { c: number }).c,
  ).toBe(1);
});

test('8.6-31 seed 出的 admin 可用 ADMIN_PASSWORD 登录', async () => {
  const { app } = await bootstrapApp();
  await app.request('/api/admin/bootstrap', bootstrapReq(SECRETS.ADMIN_PASSWORD));

  const login = await app.request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: SECRETS.ADMIN_PASSWORD }),
  });
  expect(login.status).toBe(200);
});
