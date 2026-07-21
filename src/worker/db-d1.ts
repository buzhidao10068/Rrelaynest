// D1 适配：本项目的 Database 接口形状即对齐 D1，故基本是透传。
// 仅补齐 batch 的返回类型与 run 的 last_row_id 形状，使其与 SQLite 适配一致。
import type { Database, PreparedStatement } from '../shared/types';

// D1PreparedStatement 与本接口的方法签名兼容，直接包一层以统一类型。
export function wrapD1(d1: D1Database): Database {
  return {
    prepare(sql: string): PreparedStatement {
      return wrapStmt(d1.prepare(sql));
    },
    async batch(statements: PreparedStatement[]): Promise<unknown[]> {
      // 每个 wrapped stmt 保留其底层 D1 语句以交给 d1.batch
      const native = statements.map((s) => (s as WrappedStmt).__native);
      return d1.batch(native);
    },
  };
}

interface WrappedStmt extends PreparedStatement {
  __native: D1PreparedStatement;
}

function wrapStmt(stmt: D1PreparedStatement): WrappedStmt {
  return {
    __native: stmt,
    bind(...values: unknown[]): PreparedStatement {
      return wrapStmt(stmt.bind(...values));
    },
    async first<T = Record<string, unknown>>(): Promise<T | null> {
      return (await stmt.first<T>()) ?? null;
    },
    async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
      const res = await stmt.all<T>();
      return { results: res.results ?? [] };
    },
    async run(): Promise<{ meta: { last_row_id: number } }> {
      const res = await stmt.run();
      return { meta: { last_row_id: Number(res.meta?.last_row_id ?? 0) } };
    },
  };
}
