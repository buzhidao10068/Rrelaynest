/// <reference types="@cloudflare/workers-types" />

// 跨平台运行时绑定 / 环境。
// Workers：由 wrangler 注入（DB=D1，ASSETS=Fetcher，secret 来自 wrangler secret）。
// Node/Docker：由 src/server 组装（DB=sqlite 适配，无 ASSETS，secret 来自环境变量）。
//
// DB/ASSETS 用运行时无关的类型：DB 是 shared/db.ts 的抽象接口，静态资源由各入口自行处理，
// 故这里不强制 ASSETS 字段（仅 Workers 入口使用）。
import type { Database, PreparedStatement, RunResult, AllResult } from './db.js';

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

// 用户表：邀请制多用户。password_hash 为 PBKDF2 单向哈希（见 shared/password.ts）。
// session_version 是即时吊销核心：停用/改密/降级/删号时 +1，使旧 cookie 立即失效。
export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: string; // 'admin' | 'user'
  disabled: number; // 0/1
  session_version: number;
  created_at: number;
  updated_at: number;
}

// 数据库行类型
export interface SiteRow {
  id: number;
  user_id: number; // 归属用户；INSERT 必带（应用层保证非空，见 multiuser-plan 1.2）
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
  proxy_id: number | null; // 绑定的代理 id；NULL=跟随全局代理（全局也未设则直连）
  created_at: number;
  updated_at: number;
}

// 解密后的代理配置：供 dispatcher 工厂构造出站分派器。password 为明文（调用方解密后传入）。
export interface ProxyConfig {
  type: string; // http / https / socks5
  host: string;
  port: number;
  username?: string | null;
  password?: string | null;
}

// 平台无关的 fetch 签名（与全局 fetch 兼容；init 用 unknown 以容纳 undici 扩展字段）。
export type FetchLike = (url: string, init?: unknown) => Promise<Response>;

// fetch 工厂：入参是解析后的代理配置；返回一个已绑定该代理的 fetch。
// 仅在确有可用代理时被调用（直连场景 resolveFetch 直接返回 undefined，不调本工厂）。
// Node 入口注入（用 undici 的 fetch + dispatcher，二者必须同一个包，见踩坑记录）；
// Workers 不注入 → scraper 回落全局 fetch（恒直连）。保持 shared/* 平台无关（不 import undici）。
export type MakeFetch = (cfg: ProxyConfig) => FetchLike;

// 代理行：出站代理池。仅 Node/Docker 部署生效（Workers 的 fetch 无法走自建代理）。
export interface ProxyRow {
  id: number;
  user_id: number; // 归属用户；INSERT 必带（应用层保证非空，见 multiuser-plan 1.2）
  name: string;
  type: string; // http / https / socks5
  host: string;
  port: number;
  username: string | null;
  password_encrypted: string | null; // AES-GCM 加密，与 token 同一套 crypto/ENCRYPTION_KEY
  enabled: number;
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
