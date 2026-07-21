/// <reference types="@cloudflare/workers-types" />

// 跨平台运行时绑定 / 环境。
// Workers：由 wrangler 注入（DB=D1，ASSETS=Fetcher，secret 来自 wrangler secret）。
// Node/Docker：由 src/server 组装（DB=sqlite 适配，无 ASSETS，secret 来自环境变量）。
//
// DB/ASSETS 用运行时无关的类型：DB 是 shared/db.ts 的抽象接口，静态资源由各入口自行处理，
// 故这里不强制 ASSETS 字段（仅 Workers 入口使用）。
import type { Database, PreparedStatement, RunResult, AllResult } from './db';

// 从 db.ts 集中 re-export，使业务层可统一从 './types' 引入类型。
export type { Database, PreparedStatement, RunResult, AllResult };

// 平台无关的密钥容器：Workers 从 env 绑定填充，Node 从 process.env 填充。
export interface AppSecrets {
  ADMIN_PASSWORD: string; // 登录密码
  SESSION_SECRET: string; // 会话 cookie 签名密钥
  ENCRYPTION_KEY: string; // base64 的 32 字节 AES key
}

export interface Env {
  DB: Database;
  ADMIN_PASSWORD: string; // 登录密码
  SESSION_SECRET: string; // 会话 cookie 签名密钥
  ENCRYPTION_KEY: string; // base64 的 32 字节 AES key
}

// 数据库行类型
export interface SiteRow {
  id: number;
  name: string;
  base_url: string;
  token_encrypted: string | null;
  rate: number | null;
  currency: string;
  balance: number | null;
  checkin_enabled: number;
  checkin_done: number;
  last_checkin_at: number | null;
  checkin_result: string | null;
  email: string | null;
  note: string | null;
  sort_order: number;
  last_scraped_at: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

export interface GroupRow {
  id: number;
  site_id: number;
  group_name: string;
  group_ratio: number | null;
  group_desc: string | null;
  updated_at: number;
}

export interface ModelRow {
  id: number;
  site_id: number;
  model_name: string;
  quota_type: number | null;
  model_ratio: number | null;
  completion_ratio: number | null;
  model_price: number | null;
  enable_groups: string | null;
  updated_at: number;
}
