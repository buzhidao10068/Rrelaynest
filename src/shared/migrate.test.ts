// migrate.ts / migrations.ts 单测：node:test + 内存 SQLite（node:sqlite），零新依赖。
// 覆盖 multiuser-plan 8.6-29（改造前的库迁移后存量保留）/ 8.6-30（重复迁移幂等），
// 外加 splitStatements 与新装迁移正确性、schema_migrations 记录。
//
// 用内存库 + 最小 Database 适配器（不跑 schema.sql），使迁移在隔离环境里验证。
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import type { Database, PreparedStatement } from './types.js';
import { runMigrations, splitStatements } from './migrate.js';
import { MIGRATIONS } from './migrations.js';

function normalize(values: unknown[]): unknown[] {
  return values.map((v) => {
    if (v === undefined || v === null) return null;
    if (typeof v === 'boolean') return (v ? 1 : 0);
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

// 列出某表的列名（PRAGMA table_info）。
function columns(raw: DatabaseSync, table: string): string[] {
  return (raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((r) => r.name);
}

function tableExists(raw: DatabaseSync, name: string): boolean {
  const row = raw
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`)
    .get(name);
  return !!row;
}

test('splitStatements 拆多语句、丢空白与注释行', () => {
  const sql = `
    -- 注释行会被丢弃
    CREATE TABLE a (id INTEGER);

    CREATE TABLE b (id INTEGER);
  `;
  const stmts = splitStatements(sql);
  assert.equal(stmts.length, 2);
  assert.ok(stmts[0].startsWith('CREATE TABLE a'));
  assert.ok(stmts[1].startsWith('CREATE TABLE b'));
  assert.ok(!stmts.join('\n').includes('--'));
});

test('新装库：跑全部迁移后 users/user_id/settings 复合主键就位', async () => {
  const { db, raw } = memDb();
  const res = await runMigrations(db, MIGRATIONS);

  assert.deepEqual(res.applied, ['0001_init', '0002_multiuser', '0003_probe', '0004_group_label', '0005_totp', '0006_webauthn', '0007_base_url_scheme']);

  // users 表存在且有 session_version。
  assert.ok(tableExists(raw, 'users'));
  assert.ok(columns(raw, 'users').includes('session_version'));

  // sites/proxies 有 user_id 列。
  assert.ok(columns(raw, 'sites').includes('user_id'));
  assert.ok(columns(raw, 'proxies').includes('user_id'));

  // settings 复合主键 (user_id, key)：两列都在，且 user_id 是主键的一部分。
  const settingsCols = raw.prepare(`PRAGMA table_info(settings)`).all() as {
    name: string;
    pk: number;
  }[];
  const pkCols = settingsCols.filter((c) => c.pk > 0).map((c) => c.name).sort();
  assert.deepEqual(pkCols, ['key', 'user_id']);

  // schema_migrations 记录了两条。
  const versions = (
    raw.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as {
      version: string;
    }[]
  ).map((r) => r.version);
  assert.deepEqual(versions, ['0001_init', '0002_multiuser', '0003_probe', '0004_group_label', '0005_totp', '0006_webauthn', '0007_base_url_scheme']);
});

test('8.6-30 重复迁移幂等：再跑一次不重复应用、不报错', async () => {
  const { db } = memDb();
  const first = await runMigrations(db, MIGRATIONS);
  assert.deepEqual(first.applied, ['0001_init', '0002_multiuser', '0003_probe', '0004_group_label', '0005_totp', '0006_webauthn', '0007_base_url_scheme']);

  const second = await runMigrations(db, MIGRATIONS);
  assert.deepEqual(second.applied, []); // 已应用，全部跳过

  const third = await runMigrations(db, MIGRATIONS);
  assert.deepEqual(third.applied, []);
});

test('8.6-29 改造前的库：存量 sites/proxies/settings 迁移后保留、settings 落到 user_id=0', async () => {
  const { db, raw } = memDb();

  // 先只应用 0001（模拟「改造前」的单用户旧库）。
  await runMigrations(db, [MIGRATIONS[0]]);
  assert.ok(!tableExists(raw, 'users')); // 还没跑 0002

  // 塞入存量数据：一个代理、一个站点、以及旧的全局 settings（0001 已插入 4 个默认键）。
  const t = 1_700_000_000_000;
  raw
    .prepare(
      `INSERT INTO proxies (name, type, host, port, enabled, created_at, updated_at)
       VALUES ('p1', 'http', '127.0.0.1', 7890, 1, ?, ?)`,
    )
    .run(t, t);
  raw
    .prepare(
      `INSERT INTO sites (name, base_url, currency, checkin_enabled, checkin_done, sort_order, created_at, updated_at)
       VALUES ('s1', 'https://api.example.com', 'USD', 0, 0, 0, ?, ?)`,
    )
    .run(t, t);
  // 改一个全局设置，确认迁移后值保留。
  raw.prepare(`UPDATE settings SET value = '15' WHERE key = 'scrape_interval_min'`).run();

  // 现在应用剩余迁移（0001 已应用会跳过，剩 0002 起的全部）。
  const res = await runMigrations(db, MIGRATIONS);
  assert.deepEqual(res.applied, ['0002_multiuser', '0003_probe', '0004_group_label', '0005_totp', '0006_webauthn', '0007_base_url_scheme']);

  // 存量站点/代理仍在，且新 user_id 列为 NULL（待 step4 入口回填给默认 admin）。
  const site = raw.prepare(`SELECT id, name, base_url, user_id FROM sites`).get() as {
    id: number;
    name: string;
    base_url: string;
    user_id: number | null;
  };
  assert.equal(site.name, 's1');
  assert.equal(site.user_id, null);
  // 0007 起迁移会改写 sites.base_url，故这条「存量数据保留」的用例必须把它一起钉住：
  // 本行已带 https:// → 必须原样，不能被二次加前缀。
  assert.equal(site.base_url, 'https://api.example.com');

  const proxy = raw.prepare(`SELECT name, user_id FROM proxies`).get() as {
    name: string;
    user_id: number | null;
  };
  assert.equal(proxy.name, 'p1');
  assert.equal(proxy.user_id, null);

  // 旧全局 settings 全部落到 user_id=0，且值保留（改过的 15 仍在）。
  const interval = raw
    .prepare(`SELECT value FROM settings WHERE user_id = 0 AND key = 'scrape_interval_min'`)
    .get() as { value: string } | undefined;
  assert.equal(interval?.value, '15');

  const parkedCount = (
    raw.prepare(`SELECT COUNT(*) AS n FROM settings WHERE user_id = 0`).get() as { n: number }
  ).n;
  assert.equal(parkedCount, 4); // 4 个默认全局键

  // users 表已建好，等待 step4 seed。
  assert.ok(tableExists(raw, 'users'));
});
