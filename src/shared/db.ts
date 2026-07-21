// 跨平台数据库抽象层。形状对齐 Cloudflare D1（prepare/bind/first/all/run/batch），
// 使得业务层（routes/scraper/cron）能用同一套原生 SQL，两平台复用。
// Workers：D1Database 原生满足本接口（见 src/worker/index.ts 直接传 env.DB）。
// Node/Docker：src/server/db.ts 用 better-sqlite3 实现本接口（同步 API 包成 async）。
//
// 不引入 ORM，保留废弃版原生 SQL 风格（见 TD1）。

// 单条 run 的结果，仅暴露业务用到的字段（对齐 D1Result.meta）。
export interface RunResult {
  meta: { last_row_id: number };
}

// all() 的结果。
export interface AllResult<T> {
  results: T[];
}

export interface PreparedStatement {
  // 绑定位置参数，返回自身以便链式调用（对齐 D1 语义）。
  bind(...values: unknown[]): PreparedStatement;
  // 取第一行，无则 null。
  first<T = Record<string, unknown>>(): Promise<T | null>;
  // 取全部行。
  all<T = Record<string, unknown>>(): Promise<AllResult<T>>;
  // 执行写操作。
  run(): Promise<RunResult>;
}

export interface Database {
  prepare(sql: string): PreparedStatement;
  // 事务内批量执行（对齐 D1.batch）。返回值不被业务层使用，统一为 unknown[]。
  batch(statements: PreparedStatement[]): Promise<unknown[]>;
}
