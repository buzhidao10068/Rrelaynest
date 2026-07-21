// SQLite 适配：把 Node 22+ 内置的 node:sqlite（同步 API）包装成与 D1 一致的 async
// Database 接口。供 Node/Docker 部署使用。选用 node:sqlite 而非 better-sqlite3，
// 避免原生编译依赖（Visual Studio / node-gyp），零编译即可运行。
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │ 【扩容提示 · SCALING NOTE】                                                 │
// │ 本适配为「单用户 / 小数据量」面板设计（数十~数百站点）。若未来有大客户、     │
// │ 巨量数据或高并发写入需求，node:sqlite 会成为瓶颈（单文件锁、同步 API、       │
// │ 无连接池、实验性 API）。届时的升级路径，按成本从低到高：                     │
// │   1. 换 better-sqlite3（需目标机有编译环境；API 近似，改动最小）            │
// │   2. 换 libSQL/Turso（分布式 SQLite，有连接与副本）                         │
// │   3. 换 Postgres（真正的多连接/高并发关系库）                               │
// │ 由于业务层只依赖 shared/db.ts 的 Database 抽象接口，替换只需重写本适配文件，  │
// │ 路由/爬虫/定时逻辑无需改动。                                                │
// └─────────────────────────────────────────────────────────────────────────┘
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Database as AppDatabase, PreparedStatement } from '../shared/types';

// bind 值在 D1 里可传 boolean/undefined，node:sqlite 只接受 number/string/bigint/null/Uint8Array。
function normalize(values: unknown[]): unknown[] {
  return values.map((v) => {
    if (v === undefined || v === null) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v;
  });
}

// 内部同步执行，供 batch 事务复用（避免在同步事务里 await async 方法的不可靠行为）。
function runSync(sqlite: DatabaseSync, sql: string, bound: unknown[]): { last_row_id: number } {
  const info = sqlite.prepare(sql).run(...(normalize(bound) as never[]));
  return { last_row_id: Number(info.lastInsertRowid) };
}

export function createSqliteDb(filePath: string): AppDatabase {
  // 确保目录存在（如 data/），再打开库。
  const abs = resolve(filePath);
  mkdirSync(dirname(abs), { recursive: true });

  const sqlite = new DatabaseSync(abs);
  sqlite.exec('PRAGMA journal_mode = WAL;');
  sqlite.exec('PRAGMA foreign_keys = ON;');

  // 空库首次启动时执行 schema.sql（幂等：schema 内全部 IF NOT EXISTS / INSERT OR IGNORE）。
  try {
    const schema = readFileSync(resolve('schema.sql'), 'utf-8');
    sqlite.exec(schema);
  } catch (err) {
    console.warn('执行 schema.sql 失败（若库已初始化可忽略）：', err instanceof Error ? err.message : err);
  }

  function makeStmt(sql: string, bound: unknown[] = []): PreparedStatement {
    return {
      bind(...values: unknown[]): PreparedStatement {
        return makeStmt(sql, values);
      },
      async first<T = Record<string, unknown>>(): Promise<T | null> {
        const row = sqlite.prepare(sql).get(...(normalize(bound) as never[])) as T | undefined;
        return row ?? null;
      },
      async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
        const rows = sqlite.prepare(sql).all(...(normalize(bound) as never[])) as T[];
        return { results: rows };
      },
      async run(): Promise<{ meta: { last_row_id: number } }> {
        return { meta: runSync(sqlite, sql, bound) };
      },
      // 内部字段：供 batch 同步执行（不在 D1 接口里，仅本适配器使用）
      _sql: sql,
      _bound: bound,
    } as PreparedStatement & { _sql: string; _bound: unknown[] };
  }

  return {
    prepare(sql: string): PreparedStatement {
      return makeStmt(sql);
    },
    async batch(statements: PreparedStatement[]): Promise<unknown[]> {
      // node:sqlite 无高层 transaction API，用 BEGIN/COMMIT 手动包裹，同步执行每条。
      sqlite.exec('BEGIN');
      try {
        for (const s of statements) {
          const { _sql, _bound } = s as PreparedStatement & { _sql: string; _bound: unknown[] };
          runSync(sqlite, _sql, _bound);
        }
        sqlite.exec('COMMIT');
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
      return [];
    },
  };
}
