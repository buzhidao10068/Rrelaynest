// 平台无关的迁移器：走 shared/db.ts 的 Database 接口，Node(node:sqlite) 与 Workers(D1) 共用。
// 只负责跑 DDL（建表 / 改列 / 重建 settings）；seed admin、回填 user_id、迁移每用户
// settings 由入口 runStartupMigration() 在本模块之后承担（见 multiuser-plan 第六节）。
//
// 设计取舍：
// - Database 接口只有 prepare/batch，两平台的 prepare().run() 均「一次一条语句」，
//   故把每个迁移的 SQL 按 ';' 拆成单条，连同 version 记录一起放进一个 batch() 事务。
//   batch() 在两平台都是 BEGIN/COMMIT/ROLLBACK 原子执行 —— 迁移半途失败会整体回滚。
// - 版本表 schema_migrations 自建（幂等），是唯一的「跑过没」真相源；两平台收敛于此，
//   不依赖 wrangler 的 d1_migrations。
// - 语句拆分是朴素的按分号切：当前所有迁移的字符串字面量里都没有分号（已核对），
//   够用且零依赖。若将来迁移里出现含分号的字符串/触发器，需换更聪明的分句器。

import type { Database, PreparedStatement } from './types.js';
// 只引类型（会被 Node 的类型剥离直接抹掉，不触发对 ./migrations 的运行时解析）。
// 迁移注册表由调用方显式传入（入口 runStartupMigration / 测试都传 MIGRATIONS）——
// 这样 migrate.ts 的运行时依赖图里没有扩展名缺失的相对 value import，
// node --test 的原生 TS 运行可直接跑；同时与服务端构建的「无扩展名」风格不冲突。
import type { Migration } from './migrations.js';

// 把一段多语句 SQL 拆成可单条执行的语句数组。
// 顺序要紧：先删 `-- 注释`（注释里可能含分号，如 "按 ';' 拆分"），再按 ';' 切，
// 否则注释里的分号会误切语句。迁移 SQL 的字符串字面量里不含 '--'，故按行内 '--' 到行尾
// 剔除是安全的（同时处理整行注释与行内尾注释）。
export function splitStatements(sql: string): string[] {
  return stripComments(sql)
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// 删每行从 `--` 到行尾的注释（整行注释与行内尾注释都覆盖）。
function stripComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => {
      const i = line.indexOf('--');
      return i === -1 ? line : line.slice(0, i);
    })
    .join('\n');
}

// 幂等建版本表。单独一条，先于任何迁移执行。
const SCHEMA_MIGRATIONS_DDL = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version    TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
)`;

// 读已应用的 version 集合。表不存在时（极早期）返回空集。
async function appliedVersions(db: Database): Promise<Set<string>> {
  const { results } = await db
    .prepare('SELECT version FROM schema_migrations')
    .all<{ version: string }>();
  return new Set(results.map((r) => r.version));
}

export interface MigrateResult {
  applied: string[]; // 本次真正执行的迁移 version（已应用过的不在内）
}

// 跑所有未应用的迁移。幂等：已应用的跳过。返回本次新应用的 version 列表。
// migrations 由调用方传入（生产入口传 shared/migrations.ts 的 MIGRATIONS）。
export async function runMigrations(
  db: Database,
  migrations: Migration[],
  now: number = Date.now(),
): Promise<MigrateResult> {
  // 1) 建版本表（幂等）。
  await db.prepare(SCHEMA_MIGRATIONS_DDL).run();

  // 2) 已应用集合。
  const done = await appliedVersions(db);

  const applied: string[] = [];
  // 3) 逐个未应用的迁移：拆语句 + 版本记录，放进一个事务执行。
  for (const m of migrations) {
    if (done.has(m.version)) continue;

    const stmts: PreparedStatement[] = splitStatements(m.sql).map((s) => db.prepare(s));
    stmts.push(
      db
        .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .bind(m.version, now),
    );

    await db.batch(stmts);
    applied.push(m.version);
  }

  return { applied };
}
