# 执行计划 / IMPLEMENT — Rrelaynest

> 配合 `design.md` 执行。有序清单 = 代码生成的批准单元；每块可独立 review。
> 校验命令统一：`npm run typecheck`、`npm run build`。

## 前置

- [ ] 技术栈锁定：CF Workers + D1 + 原生 SQL + Hono + Vue 3 + 自研 auth（照搬废弃版）
- [ ] 双部署目标：Workers + Docker（方案 C，共享业务逻辑 + 双入口 + DB 适配层）
- [ ] 两个新功能：签到自动化（对齐 QuantumNous/new-api `POST /api/user/checkin`）、数据导出（CSV/JSON）
- 参考基线：废弃版 relaynest（源码已通读，可逐文件对照移植）

## 块 1 — 工程骨架与配置

- [ ] `package.json`：deps `hono` + `@hono/node-server` + `better-sqlite3` + `node-cron`；
      devDeps vue/vite/wrangler/typescript/@cloudflare/workers-types/@types/better-sqlite3/@types/node。
      scripts：`dev`/`dev:worker`(7738)/`build`/`deploy`/`db:init`/`db:init:remote`/
      `server`(node server/index) /`typecheck`
- [ ] `wrangler.toml`：name `rrelaynest`，`[dev] port=7738`，`[assets]` SPA 回落，
      cron `*/5 * * * *`，D1 绑定 `DB`
- [ ] `tsconfig.json` / `vite.config.ts`（vue 插件，5173→7738 代理）/ `index.html`
- [ ] `.dev.vars.example` / `.env.example`（三 secret）/ `.gitignore`
- 校验：`npm run typecheck`（骨架应通过）

## 块 2 — schema.sql

- [ ] 4 表照搬 + `sites` 增 `last_checkin_at` / `checkin_result`
- [ ] `settings` 默认键增 `checkin_last_reset_at='0'`
- [ ] UNIQUE 约束、外键 CASCADE、索引照旧
- 校验：`npm run db:init`（本地 D1）无报错

## 块 3 — shared 基础设施

- [ ] `shared/types.ts`：Env、SiteRow（含新列）、GroupRow、ModelRow、DTO
- [ ] `shared/db.ts`：`Database` / `PreparedStatement` 接口
- [ ] `shared/crypto.ts`：AES-GCM 加解密（照搬，crypto.subtle）
- [ ] `shared/auth.ts`：HMAC 会话 cookie（照搬）
- 校验：`npm run typecheck`

## 块 4 — 爬虫与签到

- [ ] `shared/scraper.ts`：`scrapeSite` 照搬 + 新增 `checkinSite`（POST /api/user/checkin，
      解析 success/quota_awarded，识别 Turnstile/403，全程不抛致命错）
- [ ] `shared/scrape-runner.ts`：`scrapeAndStore(db, env, site)`（事务替换 groups/models）
- [ ] `shared/checkin-runner.ts`：`checkinAndStore(db, env, site)`（仅 enabled；成功置 done + result）
- 校验：`npm run typecheck`

## 块 5 — 路由

- [ ] `shared/routes.ts`：登录/登出/session、站点 CRUD、单站/全部爬取、设置读写（照搬）
- [ ] 新增 `POST /api/sites/:id/checkin`
- [ ] 新增 `GET /api/export?format=csv|json`（剔除 token 明文）
- 校验：`npm run typecheck`

## 块 6 — cron + 双入口

- [ ] `shared/cron.ts`：`maybeScrapeAll` + `dailyCheckinReset`（UTC+8 日界）+ 自动签到 → `runCron(db)`
- [ ] `worker/d1-db.ts`：D1 透传适配
- [ ] `worker/index.ts`：`export default {fetch, scheduled}`，fetch 分流 API/ASSETS
- [ ] `server/sqlite-db.ts`：better-sqlite3 适配（get/all/run/transaction，PRAGMA foreign_keys=ON）
- [ ] `server/index.ts`：@hono/node-server + serveStatic(dist) + node-cron
- 校验：`npm run typecheck`；`npm run build`

## 块 7 — 前端

- [ ] `frontend/`：App/Login/Dashboard/SiteEditor/api.ts/main.ts/style.css/shims（照搬）
- [ ] 新增：签到结果列 + 手动签到按钮；导出按钮（CSV/JSON）；SiteEditor 保留 checkin_enabled 开关
- [ ] 新增主题（R8）：`style.css` 亮/暗两套 CSS 变量（`:root` + `.dark`）；
      `composables/useTheme.ts`（light/dark/system + localStorage 持久化 + matchMedia 监听）；
      `index.html` head 内联防闪白脚本；Dashboard 顶栏 + 登录页放主题切换下拉（太阳/月亮/显示器）
- [ ] 新增侧边栏（R9）：`components/AppSidebar.vue`（左侧滑出抽屉 + 遮罩 overlay）；
      顶栏左上角汉堡图标 `<Menu>` 触发；`composables/useSidebar.ts`（open ref + open/close/toggle）；
      内容：品牌头（shield + Rrelaynest）+ 导航项（仪表盘/设置/关于）+ 顶栏操作收纳
      （爬取间隔/全部爬取/导出/主题切换）+ 底部账户信息 + 退出；
      动效 transform translateX + overlay 淡入；点遮罩/Esc/选项后关闭；顶栏随之精简
- [ ] 新增批量管理（R10）：Dashboard 主区「批量」按钮（与「全部爬取」同款次要样式）；
      批量模式下站点表格每行名称前圆形选择点（未选 ⚪ / 已选 ⚫ 带勾）；底部 Apple 毛玻璃浮动栏
      （`backdrop-filter: saturate(180%) blur(20px)` + 半透明 + 细描边 + 大阴影 + 圆角），
      含「N 项已选」计数 + 全选/取消全选 + 删除 + 取消；删除走既有 `DELETE /api/sites/:id`（逐个）
- [ ] 新增爬取间隔可编辑（R11）：侧边栏「爬取间隔」改可输入数字框（分钟）+ 圆圈包裹「！」信息图标，
      悬停 tooltip 提示推荐范围；持久化到 `settings.scrape_interval_min`（对齐 R2/AC3）
- [ ] 新增全局侧边栏 + 设置页（R9 精化 + R12）：侧边栏抽为全局组件（非嵌在某视图内），
      Dashboard 与设置页共用同一实例；顶栏统一为汉堡入口（设置页不再用独立返回箭头）。
      设置页与主页一致用整屏视图切换（vue-router 路由或顶层 v-if 视图），
      侧边栏「仪表盘/设置」随当前路由高亮。设置页 = 左分区导航 + 右内容，四分区：
      通用偏好（默认货币/语言）/ 安全（改密码 + 两步验证 2FA + Passkey，参考 new-api 卡片式）/
      签到（新站默认签到开关 + 跨天重置时区 + Turnstile 说明）/ 数据与关于（导出 + 版本 + 危险区）
- [ ] 新增表格紧凑模式（R13）：Dashboard 主区「紧凑」按钮（全部爬取左侧，同款次要样式），
      中心化  状态，切换行高（py-3 ↔ py-1.5）+ 按钮激活态反色高亮
- 校验：`npm run build`（前端产物进 dist）

## 块 8 — Docker + 文档

- [ ] `Dockerfile`（多阶段：build 前端 + 编译 → node 运行 server/index）+ `.dockerignore`
- [ ] `docker-compose.yml`（volume 挂 sqlite 文件 + env 注入 + 反代 TLS 提示）
- [ ] `README.md`：两条部署路径（Workers：D1+secret+deploy；Docker：build+compose+反代）
- 校验：`npm run build`；（可选）`docker build` 冒烟

## 风险文件 / 回滚点

- `src/server/db-sqlite.ts`：接口适配最易出偏差（同步→异步、meta 映射）——重点自测
- SQLite 引擎：当前用 Node 内置 `node:sqlite`（零编译，实验性）。**扩容点**：单用户小数据量足够；
  若未来数据量巨大 / 并发写多 / 需 WAL 之外的调优，改用 `better-sqlite3`（需 VS 构建工具）或迁到
  Postgres / D1 扩容。DB 抽象层（`src/shared/db.ts` 的 `Database` 接口）已把引擎隔离，换实现不动业务代码。
  同一提示也写在 `src/server/db-sqlite.ts` 头部注释。
- `src/shared/scheduler.ts` 日界：用固定 UTC+8，勿用运行环境本地时区

## `task.py start` 前检查

- [ ] design.md / implement.md 完成，用户 review 通过
- [ ] implement.jsonl / check.jsonl 各含真实条目（已 curate）
- [ ] prd.md 已过收敛 pass，无遗留 open question
