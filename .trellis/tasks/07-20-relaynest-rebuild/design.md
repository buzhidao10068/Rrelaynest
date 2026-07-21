# 技术设计 / DESIGN — Rrelaynest 中转站管理面板

> 配合 `prd.md` 阅读。本文件定架构与契约；执行清单见 `implement.md`。

## 架构总览

单代码库，一套业务逻辑，两个部署入口。核心原则：**平台差异是部署期分叉，不是运行时分支**。
每次构建只打包并运行一个入口，进程内没有「当前是哪个平台」的每请求判断。

```
src/
  shared/            ← 跨平台业务逻辑（零平台 API 依赖）
    routes.ts        ← Hono app（登录 / 站点 CRUD / 爬取 / 签到 / 导出 / 设置）
    scraper.ts       ← new-api 爬虫 + 签到（fetch，跨平台）
    scrape-runner.ts ← 爬取并落库（依赖注入的 DB 接口）
    checkin-runner.ts← 签到并落库（依赖注入的 DB 接口）
    crypto.ts        ← AES-GCM token 加解密（crypto.subtle，Workers/Node20+ 通用）
    auth.ts          ← HMAC 会话 cookie（crypto.subtle）
    db.ts            ← DB 接口定义（Database 抽象，见下）
    types.ts         ← Env / 行类型 / DTO
    cron.ts          ← maybeScrapeAll + dailyCheckinReset（接受 DB 接口）
  worker/
    index.ts         ← Cloudflare 入口：export default { fetch, scheduled }
    d1-db.ts         ← Database 接口的 D1 实现（env.DB）
  server/
    index.ts         ← Node/Docker 入口：@hono/node-server + serveStatic + node-cron
    sqlite-db.ts     ← Database 接口的 better-sqlite3 实现
  frontend/          ← Vue 3（App / Login / Dashboard / SiteEditor / api.ts / main.ts / style.css）
schema.sql           ← 建表 SQL（D1 与 sqlite 共用同一份 DDL）
Dockerfile / .dockerignore
wrangler.toml / vite.config.ts / package.json / tsconfig.json / index.html
```

## DB 抽象层（TD2 核心）

不引入 ORM，保留废弃版原生 SQL 风格。定义一个覆盖两平台能力交集的最小接口，
形状对齐 D1（废弃版已用），SQLite 实现做适配：

```ts
// shared/db.ts
export interface PreparedStatement {
  bind(...values: unknown[]): PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { last_row_id: number } }>;
}
export interface Database {
  prepare(sql: string): PreparedStatement;
  batch(stmts: PreparedStatement[]): Promise<void>;
}
```

- **D1 实现**（`worker/d1-db.ts`）：D1 原生就是这个形状，直接透传 `env.DB`（近乎零成本包装）。
- **SQLite 实现**（`server/sqlite-db.ts`）：用 better-sqlite3 适配 —— `first→get`、`all→all`（包成
  `{results}`）、`run→run`（映射 `lastInsertRowid→meta.last_row_id`）、`batch→transaction`。
  better-sqlite3 同步 API 用 `async` 包一层保持接口一致。
- 业务层（routes/scrape-runner/checkin-runner/cron）只依赖 `Database` 接口，不知道底层是谁。

理由：废弃版所有 SQL 已按 D1 的 `prepare/bind/first/all/run/batch` 写好，采用同形接口可**最大化复用
废弃版 SQL**，SQLite 侧只写一个薄适配器。若改用 ORM 反而要重写全部查询，违背「照搬已验证实现」。

## 数据流与契约

### 爬取（R2，照搬废弃版）
1. `scrapeSite(baseUrl, token)`：`GET {base}/api/pricing`（核心，失败即致命）解析 group_ratio +
   usable_group + data[]；`GET {base}/api/user/self` 取 quota/500000（失败不致命，保留旧余额）。
2. `scrapeAndStore(db, env, site)`：解密 token → 抓取 → 事务内 `DELETE` 旧 groups/models 再批量
   `INSERT` → 更新 balance/last_scraped_at，清 last_error；失败写 last_error，不影响他站。

### 签到（R5，新增，对齐 QuantumNous/new-api）
1. `checkinSite(baseUrl, token)`：`POST {base}/api/user/checkin`，`Authorization: Bearer`。
   解析响应：
   - `success:true` → `{ ok:true, quotaAwarded, message }`（额度 = quota_awarded/500000）
   - `success:false` → `{ ok:false, message }`（含「签到功能未启用」「今日已签到」等原样透传）
   - HTTP 4xx/Turnstile 迹象（403 / 响应含 turnstile 关键字）→ `{ ok:false, needsManual:true,
     message:"该站开启了人机验证，需手动到网页签到" }`
   - 网络/解析异常 → `{ ok:false, message: err }`
   任何分支都**不抛致命错误**。
2. `checkinAndStore(db, site)`：仅当 `checkin_enabled=1`。成功置 `checkin_done=1`、写
   `checkin_result`（如「+$0.10」）、`last_checkin_at=now`；失败仅写 `checkin_result`（原因），
   `checkin_done` 不变。
3. 手动：`POST /api/sites/:id/checkin` 调 `checkinAndStore` 返回结果。

### 定时（R2+R5，`shared/cron.ts`）
- `maybeScrapeAll(db)`：读 `scrape_interval_min` 与 `last_cron_run_at`，未到间隔跳过；到点先占位写
  `last_cron_run_at=now`（防叠加）再逐站 `scrapeAndStore`。
- `dailyCheckinReset(db)`：读 `checkin_last_reset_at`，若不在同一「本地日」则将所有站 `checkin_done=0`
  并更新 `checkin_last_reset_at`。日界判定用固定时区（默认 Asia/Shanghai，UTC+8）避免 UTC 误差。
- 签到自动化：重置后，对 `checkin_enabled=1 且 checkin_done=0` 的站逐个 `checkinAndStore`。
- Workers：`scheduled()`（cron `*/5 * * * *`）内 `ctx.waitUntil(runCron(db))`。
  Node：`node-cron` 每 5 分钟调同一 `runCron(db)`。两者共用 `shared/cron.ts`，逻辑零重复。

### 导出（R6，新增）
- `GET /api/export?format=csv|json`（需登录）。查 sites（含折算）+ 关联 groups/models 摘要。
- CSV：站点名/地址/币种/汇率/余额/折RMB/邮箱/签到状态/备注/上次爬取。`Content-Disposition: attachment`。
- JSON：结构化站点数组，供备份/迁移。**两者都不含 token 明文**（TD4）。

## Schema 变更（相对废弃版）

新增列 / 键，其余 4 表照搬：
- `sites` 增：`last_checkin_at INTEGER`、`checkin_result TEXT`
- `settings` 增默认键：`checkin_last_reset_at`（默认 '0'）
- 保留 `checkin_enabled`（可选开启）、`checkin_done`（今日已签，cron 跨天重置）
- 约束照旧：`site_groups` UNIQUE(site_id,group_name)、`site_models` UNIQUE(site_id,model_name)、
  外键 `ON DELETE CASCADE`（SQLite 需在连接时 `PRAGMA foreign_keys=ON`）

> 参照 spec `big-question/system-constraints.md`：落库前 `DELETE` 再 `INSERT` 的替换策略配合 UNIQUE
> 约束，避免重复行；所有「应只有一行」的查询靠主键/唯一键保证确定性。

## 安全（R3，照搬 + 导出加固）

- 登录：`ADMIN_PASSWORD` 常量时间比较；会话 = base64url(payload).HMAC-SHA256(SESSION_SECRET)，
  7 天 TTL；cookie HttpOnly + Secure + SameSite=Lax。
- token：AES-GCM（`ENCRYPTION_KEY` = base64 32 字节），`iv:ciphertext` 存库，明文不落库、不出 API。
- 导出与 `GET /api/sites` 均剔除 `token_encrypted`，只暴露 `has_token`。
- **Docker 部署的安全提示**：Node 入口默认监听端口无 TLS。`Secure` cookie 需 HTTPS，
  故文档要求 Docker 部署置于反向代理（Caddy/Nginx）之后并启用 TLS；否则本地 http 下 Secure cookie
  不回传。环境变量经 `.env`/compose 注入三个 secret，不写入镜像。

## 平台适配对照

| 关注点 | Workers (`worker/`) | Node/Docker (`server/`) |
|--------|--------------------|--------------------------|
| 入口 | `export default {fetch, scheduled}` | `serve({fetch})` + `node-cron` |
| DB | `env.DB`（D1）→ `d1-db.ts` | better-sqlite3 → `sqlite-db.ts`，文件挂 volume |
| 静态资源 | `env.ASSETS.fetch`（`[assets]`） | Hono `serveStatic` 伺服 `dist/` |
| 定时 | cron trigger `*/5 * * * *` | `node-cron` `*/5 * * * *` |
| secret | `wrangler secret put` | `.env` / compose environment |
| crypto | `crypto.subtle`（原生） | `crypto.subtle`（Node 20+ 原生） |

## 兼容 / 迁移 / 回滚

- 无存量数据迁移（重做，全新库）。schema.sql 一份 DDL 两平台共用。
- 回滚：两入口独立，改坏一个不影响另一个；业务逻辑在 shared/，可单测。
- 风险点：better-sqlite3 是原生模块，Docker 构建需匹配平台的编译；用官方 node 镜像 + `npm ci` 解决。
  若原生模块在目标架构编译困难，回退选项为 `node:sqlite`（Node 22+ 内置）或 libsql，接口层已隔离。

## 关键权衡

- **不引入 ORM**：牺牲一点类型糖，换取最大化复用废弃版已验证 SQL + 更小依赖面（契合受限网络）。
- **双入口 vs 单一平台**：多约 30% 一次性开发量（适配层 + Dockerfile），换取部署自由；运行时零开销。
- **签到只对齐一个上游**：牺牲对其他分叉的即时支持，换取实现确定性（端点已源码核实），避免臆测端点。
