// 漂移检测：db/migrations/*.sql（人读 / wrangler 手动执行的镜像）必须与 migrations.ts
// 里内联的 SQL 逐语句一致。改一处漏改另一处，这里就红 —— 守住「单一真源」承诺。
// 另含 0007 回填的行为测试（纯数据迁移，需要真跑一遍才知道碰了哪些行）。
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Database, PreparedStatement } from './types.js';
import { MIGRATIONS } from './migrations.js';
import { splitStatements, runMigrations } from './migrate.js';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(here, '../../db/migrations');

test('每个迁移的内联 SQL 与 db/migrations/*.sql 镜像逐语句一致', () => {
  for (const m of MIGRATIONS) {
    const file = resolve(MIGRATIONS_DIR, `${m.version}.sql`);
    const disk = readFileSync(file, 'utf-8');

    const inline = splitStatements(m.sql);
    const mirror = splitStatements(disk);

    // 逐条比较去注释、压平空白后的语句，避免格式差异误报。
    const flat = (s: string) => s.replace(/\s+/g, ' ').trim();
    assert.deepEqual(
      mirror.map(flat),
      inline.map(flat),
      `迁移 ${m.version} 的 .sql 镜像与 migrations.ts 内联 SQL 不一致（改一处需同步另一处）`,
    );
  }
});

// ---- 0007_base_url_scheme：回填存量 base_url 的协议头 ----

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

// 只跑到 0007 之前的迁移，再插混合形状的存量数据，模拟「升级前的库」。
// 用「按注册表位置截断」而不是「过滤掉 0007」：后者在将来加了 0008 之后会把 0008 也一起
// 先跑掉（顺序错乱，且下面「只应新应用 0007」的断言照样绿，故障会静默）。
async function seedPre0007(): Promise<{ db: Database; raw: DatabaseSync }> {
  const { db, raw } = memDb();
  const idx = MIGRATIONS.findIndex((m) => m.version === '0007_base_url_scheme');
  assert.ok(idx >= 0, '注册表里找不到 0007_base_url_scheme');
  await runMigrations(db, MIGRATIONS.slice(0, idx));

  const now = Date.now();
  // sites.user_id 有 REFERENCES users(id)，先建个归属用户（本测只关心 base_url 的形状）。
  raw
    .prepare(
      `INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
       VALUES (1, 'u', 'x', 'user', ?, ?)`,
    )
    .run(now, now);
  const stmt = raw.prepare(
    `INSERT INTO sites (user_id, name, base_url, currency, checkin_enabled, checkin_done, sort_order, created_at, updated_at)
     VALUES (1, ?, ?, 'USD', 0, 0, 0, ?, ?)`,
  );
  // 覆盖：裸域名 / 裸域名带端口 / https / http / 大写 HTTPS / 空串
  for (const [name, baseUrl] of [
    ['bare', 'astu.online'],
    ['bare-port', '1.2.3.4:3000'],
    ['https', 'https://a.b'],
    ['http', 'http://c.d'],
    ['upper', 'HTTPS://E.F'],
    ['empty', ''],
  ]) {
    stmt.run(name, baseUrl, now, now);
  }
  return { db, raw };
}

function baseUrls(raw: DatabaseSync): Record<string, string> {
  const rows = raw.prepare('SELECT name, base_url FROM sites').all() as {
    name: string;
    base_url: string;
  }[];
  return Object.fromEntries(rows.map((r) => [r.name, r.base_url]));
}

test('0007 只给缺协议头的行补 https://，已带协议头（含大写）与空串一律不碰', async () => {
  const { db, raw } = await seedPre0007();
  // 升级前：裸域名就是裸的（这正是界面新建站点在库里的真实形状）
  assert.equal(baseUrls(raw).bare, 'astu.online');

  const { applied } = await runMigrations(db, MIGRATIONS);
  assert.deepEqual(applied, ['0007_base_url_scheme'], '只应新应用 0007');

  assert.deepEqual(baseUrls(raw), {
    bare: 'https://astu.online', // 回填生效
    'bare-port': 'https://1.2.3.4:3000', // 端口不受影响
    https: 'https://a.b', // 原样
    http: 'http://c.d', // 原样（不被升级成 https）
    upper: 'HTTPS://E.F', // 原样（SQLite LIKE 对 ASCII 大小写不敏感，未被二次加前缀）
    empty: '', // 原样（不变成没有主机名的 'https://'）
  });
});

test('0007 幂等：重复跑 runMigrations 不再二次加前缀', async () => {
  const { db, raw } = await seedPre0007();
  await runMigrations(db, MIGRATIONS);
  const afterFirst = baseUrls(raw);

  const second = await runMigrations(db, MIGRATIONS);
  assert.deepEqual(second.applied, [], '第二次不应再应用任何迁移');
  assert.deepEqual(baseUrls(raw), afterFirst, '重复执行结果必须一致');
});

test('0007 在全新库上空转（无站点数据也不报错）', async () => {
  const { db, raw } = memDb();
  const { applied } = await runMigrations(db, MIGRATIONS);
  assert.ok(applied.includes('0007_base_url_scheme'));
  assert.deepEqual(baseUrls(raw), {});
});
