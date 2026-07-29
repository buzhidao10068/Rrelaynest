// runStartupMigration 单测：node:test + 内存 SQLite（node:sqlite），零新依赖。
// 覆盖 multiuser-plan 第六节 seed + 回填 + 每用户 settings 迁移，以及
// 8.6-29（改造前的库迁移后存量归到默认 admin）/ 8.6-30（重复执行幂等）。
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import type { Database, PreparedStatement, AppSecrets } from './types.js';
import { runStartupMigration, type StartupDeps } from './startup.js';
import { runMigrations } from './migrate.js';
import { MIGRATIONS } from './migrations.js';
import { hashPassword, verifyPassword } from './password.js';

// 组合根注入的迁移原语（与生产入口一致，见 src/server/index.ts）。
const DEPS: StartupDeps = { runMigrations, hashPassword, migrations: MIGRATIONS };

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
  ADMIN_PASSWORD: 'initial-admin-pw',
  SESSION_SECRET: 'sess',
  ENCRYPTION_KEY: 'enc',
};

test('全新库：seed 默认 admin，密码取自 ADMIN_PASSWORD 且已哈希', async () => {
  const { db, raw } = memDb();
  const res = await runStartupMigration(db, SECRETS, DEPS);

  assert.equal(res.seededAdmin, true);
  assert.deepEqual(res.migrationsApplied, ['0001_init', '0002_multiuser', '0003_probe', '0004_group_label', '0005_totp']);

  const admin = raw
    .prepare("SELECT username, role, password_hash FROM users WHERE role = 'admin'")
    .get() as { username: string; role: string; password_hash: string };
  assert.equal(admin.username, 'admin');
  assert.equal(admin.role, 'admin');
  // 密码是 PBKDF2 哈希（非明文），且能校验通过。
  assert.ok(admin.password_hash.startsWith('pbkdf2$'));
  assert.equal(await verifyPassword('initial-admin-pw', admin.password_hash), true);
  assert.equal(await verifyPassword('wrong', admin.password_hash), false);
});

test('8.6-30 重复执行幂等：再跑不重复 seed、不改数据、不报错', async () => {
  const { db, raw } = memDb();
  const first = await runStartupMigration(db, SECRETS, DEPS);
  assert.equal(first.seededAdmin, true);

  const second = await runStartupMigration(db, SECRETS, DEPS);
  assert.equal(second.seededAdmin, false); // 已有 admin，不再 seed
  assert.deepEqual(second.migrationsApplied, []); // 迁移已应用，全跳过

  // 仅一个 admin，无重复。
  const n = (raw.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin'").get() as { n: number }).n;
  assert.equal(n, 1);
});

test('8.6-29 改造前的库：存量 sites/proxies 回填到默认 admin，旧全局设置迁到 admin', async () => {
  const { db, raw } = memDb();

  // 模拟「改造前」：先只建 0001 结构 + 塞存量数据（不经 startup，直接铺库）。
  // 这里借 startup 的第一步把两迁移都建好，然后手动制造「NULL user_id + user_id=0 设置」的存量态。
  // 更贴近真实：只跑到 0002 DDL、还没 seed/回填的中间态——用一个「无 ADMIN_PASSWORD 触发不了 seed」
  // 的路径不现实，故改为：先 seed 一次拿到结构，清掉 admin 与回填痕迹，重建存量，再跑一次。
  // 简化且等价：直接构造 0002 迁移后的原始态。
  await runStartupMigration(db, SECRETS, DEPS); // 建全部结构 + seed admin(id=1)
  const adminId = (raw.prepare("SELECT id FROM users WHERE role='admin'").get() as { id: number }).id;

  // 制造「改造前存量」：插入一个 user_id=NULL 的站点/代理，和 user_id=0 的每用户设置。
  const t = 1_700_000_000_000;
  raw
    .prepare(
      `INSERT INTO sites (user_id, name, base_url, currency, checkin_enabled, checkin_done, sort_order, created_at, updated_at)
       VALUES (NULL, 's-legacy', 'https://api.example.com', 'USD', 0, 0, 0, ?, ?)`,
    )
    .run(t, t);
  raw
    .prepare(
      `INSERT INTO proxies (user_id, name, type, host, port, enabled, created_at, updated_at)
       VALUES (NULL, 'p-legacy', 'http', '127.0.0.1', 7890, 1, ?, ?)`,
    )
    .run(t, t);
  // 每用户键滞留在 user_id=0（模拟 0002 刚重建 settings 的暂存态）。
  raw.prepare(`DELETE FROM settings WHERE key = 'scrape_interval_min'`).run();
  raw
    .prepare(`INSERT INTO settings (user_id, key, value) VALUES (0, 'scrape_interval_min', '15')`)
    .run();

  // 再跑一次 startup：应回填 user_id、迁移设置（不再 seed）。
  const res = await runStartupMigration(db, SECRETS, DEPS);
  assert.equal(res.seededAdmin, false);
  assert.equal(res.backfilledSites, 1);
  assert.equal(res.backfilledProxies, 1);

  // 存量站点/代理归到默认 admin。
  const site = raw.prepare(`SELECT user_id FROM sites WHERE name = 's-legacy'`).get() as {
    user_id: number;
  };
  assert.equal(site.user_id, adminId);
  const proxy = raw.prepare(`SELECT user_id FROM proxies WHERE name = 'p-legacy'`).get() as {
    user_id: number;
  };
  assert.equal(proxy.user_id, adminId);

  // 旧全局设置迁到 admin，值保留（15），user_id=0 不再残留该每用户键。
  const admScoped = raw
    .prepare(`SELECT value FROM settings WHERE user_id = ? AND key = 'scrape_interval_min'`)
    .get(adminId) as { value: string } | undefined;
  assert.equal(admScoped?.value, '15');
  const parked = raw
    .prepare(`SELECT COUNT(*) AS n FROM settings WHERE user_id = 0 AND key = 'scrape_interval_min'`)
    .get() as { n: number };
  assert.equal(parked.n, 0);
});
