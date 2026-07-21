# 重做 Rrelaynest 中转站管理面板

> 状态：Phase 1 规划中（尚未 `task.py start`）。基于废弃版 relaynest 重做。
> 新终端接手请先读本文件，再读同目录 `HANDOFF.md`、`design.md`、`implement.md`。

## Goal

把用户手工维护的纯文本中转站清单，重做成一个集中管理面板：自动爬取各 new-api 中转站的
余额、分组倍率、模型定价，替代手工记录。本次为**重做**——废弃版功能已基本完整，用户不满的是
「当初没走 trellis 流程、没留下可交接记录」，而非技术选型错误。因此技术栈照搬废弃版，
补齐流程与文档，并新增两个功能（签到自动化、数据导出）与一个新部署目标（Docker）。

用户价值：一处登录即可看到所有中转站的余额（含汇率折算人民币的合计）、分组倍率、模型定价，
需要签到的站点自动/一键签到，数据可随时导出备份。

## Background / 已确认事实

用户原始需求要点：
- 之前用文本文件记录已注册中转站，格式 `|站点名|汇率(前RMB后站点货币)|余额|签到?|注册邮箱|备注|`
- 手工维护太麻烦，想要类似 https://github.com/ieax/renewhelper 的集中管理工具
- 要求可部署到 Cloudflare、用爬虫爬中转站分组

废弃版已验证的技术方案（本次重做的参考基线，旧实现 relaynest）：
- **架构**：Cloudflare Workers 单 Worker，前端静态资源 + 后端 API 同域，非 `/api/*` 回落 SPA
- **后端**：Hono，路由 `src/worker/routes.ts`
- **前端**：Vue 3 + Vite + TypeScript，`src/frontend/`（App / Login / Dashboard / SiteEditor / api.ts）
- **数据库**：Cloudflare D1（SQLite），4 张表：
  - `sites`（name/base_url/token_encrypted/rate/currency/balance/checkin_enabled/checkin_done/
    email/note/sort_order/last_scraped_at/last_error/created_at/updated_at）
  - `site_groups`（分组倍率，站点 1:N，UNIQUE(site_id,group_name)）
  - `site_models`（模型定价，站点 1:N，UNIQUE(site_id,model_name)）
  - `settings`（KV 配置：scrape_interval_min 默认 30、last_cron_run_at）
- **爬虫**（`src/worker/scraper.ts`）抓 new-api：
  - `GET /api/pricing` → group_ratio（分组倍率）+ usable_group（分组描述）+ data[]（模型定价）
  - `GET /api/user/self` → data.quota，按 `QuotaPerUnit=500000`（500000 额度 = $1）换算余额
  - 认证头：`Authorization: Bearer <access_token>`
- **定时**：Cron `*/5 * * * *` 固定触发，是否执行由 `settings.scrape_interval_min` 判断，
  靠 `last_cron_run_at` 时间戳节流（改间隔无需重新部署）
- **安全**：
  - 单用户密码登录（`ADMIN_PASSWORD` secret），HMAC-SHA256 签名的 HttpOnly+Secure cookie，7 天有效
  - access token 用 AES-GCM 加密入库（`ENCRYPTION_KEY` = base64 的 32 字节），明文不落库
  - 三个 secret：`ADMIN_PASSWORD` / `SESSION_SECRET` / `ENCRYPTION_KEY`
- **本地开发**：固定走 **7738** 端口（该端口也是用户的本地代理出口）
- **前端功能**：站点表格（含汇率→RMB 折算、合计余额）、增删改、单站/全部爬取、改爬取间隔
- **汇率语义**：`rate` = 1 RMB 换多少站点货币；`余额折RMB = balance / rate`

签到接口（已从 QuantumNous/new-api 源码经代理 7738 核实，`router/api-router.go` +
`controller/checkin.go`）：
- `GET /api/user/checkin` → 查询状态：未启用返回 `success:false, message:"签到功能未启用"`；
  启用返回 `success:true, data:{enabled,min_quota,max_quota,stats}`
- `POST /api/user/checkin` → 执行签到：成功 `success:true, message:"签到成功",
  data:{quota_awarded, checkin_date}`；失败 `success:false + message`
- 两端点都在 `selfRoute`（`middleware.UserAuth()`），与爬虫复用 `Authorization: Bearer <access_token>`
- `quota_awarded` 单位同余额，除以 500000 得美元数
- **坑**：`POST /api/user/checkin` 挂 `middleware.TurnstileCheck()`。目标站若开启 Turnstile 人机验证，
  纯 access token 自动签到会被拦，只能手动到网页签 —— 需识别此情况并给出明确提示，不作致命错误

## Technical Decisions

- **TD1 技术栈**：照搬废弃版（Cloudflare Workers + D1 + 原生 SQL + Hono + Vue 3 + 自研 auth），
  不改用 Trellis spec 预设的 Turso + Drizzle + React + Better Auth。
  理由：废弃版已验证、依赖少、部署简单、契合受限网络环境；用户痛点是流程/文档而非选型。
- **TD2 部署目标**：**同时支持 Cloudflare Workers 与 Docker**（方案 C）。
  平台差异是部署期分叉、非运行时分支：每次部署只打包并运行一个入口，无每请求平台判断开销。
  业务逻辑（路由/爬虫/签到/加密/前端）跨平台共享，仅「平台适配层」分叉：
  - 数据库：Workers 用 D1（`env.DB`），Docker 用本地 SQLite（better-sqlite3）；抽一层薄 DB 接口，
    不引入 ORM，保留原生 SQL 风格
  - 静态资源：Workers 用 `env.ASSETS`，Docker 用 Hono `serveStatic` 伺服 `dist/`
  - 定时：Workers 用 `scheduled()` handler，Docker 用进程内 `node-cron`
  - 入口：`src/worker/index.ts`（Workers）与 `src/server/index.ts`（Node，`@hono/node-server`）
  - `crypto.subtle`（token 加解密、会话签名）在 Workers 与 Node 20+ 均原生支持，无需分叉
- **TD3 签到范围**：仅对齐 QuantumNous/new-api 固定端点 `/api/user/checkin`；其他分叉（done-hub、
  veloera 等）路径不一，以后再加，本次不做「每站可配路径」的兜底。
- **TD4 导出内容**：站点清单（名称/地址/汇率/余额/折RMB/邮箱/备注/签到状态），**不含 access token
  明文**（安全）。CSV 供人阅读、JSON 供备份迁移。
- **TD5 主题实现**：纯前端 CSS 变量方案，与 shadcn-vue 一致——`:root` 定义亮色 token、`.dark`
  覆盖暗色 token，通过给 `<html>` 加/去 `dark` class 切换。三档状态（light/dark/system）存
  `localStorage`；system 档监听 `matchMedia('(prefers-color-scheme: dark)')`。不引入额外依赖、不落后端。

## Requirements

- **R1 站点集中管理**：增删改站点，字段同废弃版 `sites` 表。
- **R2 new-api 爬虫 + 定时**：爬分组倍率、模型定价、余额（QuotaPerUnit=500000），
  单站/全部手动爬取，cron 按 `scrape_interval_min` 节流自动爬取。
- **R3 安全模型**：单用户密码登录 + HMAC 签名会话 cookie + AES-GCM token 加密存储。
- **R4 汇率与合计**：`rate` = 1 RMB 换多少站点货币；余额折 RMB = balance / rate；面板显示合计 RMB。
- **R5 签到自动化（新增）**：每站可选开启（`checkin_enabled`）；对齐 `POST /api/user/checkin`；
  手动单站签到 + cron 跨天自动签到（仅对开启且今日未签的站）；结果记入 `checkin_result` /
  `last_checkin_at`；Turnstile 拦截识别为「需手动签到」，不作致命错误，不影响爬取。
- **R6 数据导出（新增）**：`GET /api/export?format=csv|json`，内容见 TD4，不含 token 明文。
- **R7 双部署目标（新增）**：同一套业务代码可部署到 Cloudflare Workers 或 Docker 容器，见 TD2。
- **R8 主题切换（新增）**：前端支持 **亮色 / 暗色 / 跟随系统** 三档主题；用户选择持久化到
  `localStorage`；「跟随系统」跟随 `prefers-color-scheme` 实时变化。纯前端功能，不涉及后端。
- **R9 侧边栏导航（新增）**：界面左上角提供汉堡图标，点击从左侧滑出侧边栏（drawer）。侧边栏承载
  导航与操作中枢：品牌头 + 导航项（仪表盘 / 设置 / 关于）+ 收纳原顶栏操作（爬取间隔 / 全部爬取 /
  导出 / 主题切换 / 退出）+ 底部账户信息。开合带遮罩(overlay)与动画；顶栏随之精简为
  汉堡 + 标题 + 少量高频操作。纯前端功能，不涉及后端。
- **R10 批量管理（新增）**：Dashboard 主区提供「批量」按钮（与「全部爬取」同款次要样式）。进入批量
  模式后，站点表格每行名称前出现圆形选择点（未选 ⚪ 白底描边 / 已选 ⚫ 黑底带勾），可逐行勾选；
  底部浮现 Apple 毛玻璃风格浮动栏（`backdrop-filter: saturate(180%) blur(20px)` + 半透明 + 细描边
  + 大阴影 + 圆角），含「N 项已选」计数、全选/取消全选、删除（对选中站点批量删除）、取消（退出批量）。
  纯前端交互；实际删除走既有 `DELETE /api/sites/:id`（逐个或批量）。
- **R11 爬取间隔可编辑 + 推荐提示（新增）**：侧边栏「爬取间隔」由只读 pill 改为可输入数字框（分钟），
  输入框后跟一个「圆圈包裹的 ！」信息图标，鼠标悬停显示推荐时间范围的 tooltip。改动持久化到
  `settings.scrape_interval_min`（对齐 R2/AC3，改间隔无需重新部署）。
- **R12 设置页（新增）**：侧边栏「设置」进入独立设置页（整屏视图，与 Dashboard 同为路由级视图，
  非弹窗）。左侧分区导航 + 右侧内容，四个分区：**通用偏好**（默认货币 / 默认语言）、**安全**
  （修改密码 + 两步验证 2FA + Passkey/WebAuthn，参考 new-api 的行式卡片 + 状态标签 + 操作按钮）、
  **签到**（新站默认开启签到开关 / 跨天重置时区 / Turnstile 站点说明）、**数据与关于**（导出
  CSV/JSON / 版本信息 / 危险区清空数据）。2FA 与 Passkey 为占位 UI，本次不落后端实现。
- **R13 全局侧边栏 + 表格紧凑模式（新增）**：侧边栏为**全局元素**（非嵌于单一视图），主页与设置页
  共用同一侧边栏，两个方向切换入口一致（汉堡 → 侧边栏 → 导航项：仪表盘 / 设置）；导航项随当前
  视图高亮。Dashboard 主区提供「紧凑」按钮（「全部爬取」左侧，与之同款次要样式），点击切换表格
  行高（`py-3` ↔ `py-1.5`），激活态反色高亮；纯前端展示偏好。

## Acceptance Criteria

- [ ] **AC1**（R1）：登录后可增/删/改站点；`base_url` 尾部斜杠被规整；token 明文不出现在
      `GET /api/sites` 响应中（仅返回 `has_token` 布尔）。
- [ ] **AC2**（R2）：对一个真实/模拟 new-api 站点，单站爬取后 `balance`、`site_groups`、
      `site_models` 被正确写入；余额 = quota/500000；爬取失败时 `last_error` 记录原因且不影响其他站。
- [ ] **AC3**（R2）：`scrape_interval_min` 改为 N 后，cron 在不足 N 分钟时跳过、达到后执行；
      改间隔无需重新部署。
- [ ] **AC4**（R3）：未登录访问 `/api/sites` 返回 401；错误密码登录失败；正确密码后 cookie 为
      HttpOnly+Secure，7 天有效；DB 中 `token_encrypted` 非明文，可解密回原值。
- [ ] **AC5**（R4）：某站 balance=10 USD、rate=7 时，面板显示折 RMB ≈ 1.43；合计 RMB 为各站折算之和。
- [ ] **AC6**（R5）：对开启签到的站点点手动签到，成功时 `checkin_done=1`、`checkin_result` 记录获得额度；
      站点未启用签到功能时 `checkin_result` 记「签到功能未启用」；Turnstile 站点记「需手动签到」；
      以上任一情况都不抛致命错误。cron 跨天将所有站 `checkin_done` 重置为 0。
- [ ] **AC7**（R6）：`GET /api/export?format=csv` 返回可下载 CSV，`format=json` 返回 JSON；
      两者均不含 token 明文。
- [ ] **AC8**（R7）：`npm run deploy` 可部署到 Cloudflare Workers；`docker build` + `docker run`
      可在容器内启动同一应用并持久化 SQLite 数据；两种部署功能一致。
- [ ] **AC9**：`npm run typecheck` 通过；两个入口（worker/server）与共享业务层类型一致。
- [ ] **AC10**（R8）：主题切换器提供 亮色/暗色/跟随系统 三档；选择后立即生效并持久化，刷新后保持；
      「跟随系统」时改动操作系统深浅色偏好，界面实时跟随；首屏无「先亮后暗」闪白（挂载前应用主题）。
- [ ] **AC11**（R9）：点击左上角汉堡图标，侧边栏从左侧滑出（带遮罩/过渡），再次点击或点遮罩关闭；
      侧边栏含品牌头 + 导航项 + 收纳的顶栏操作（爬取间隔/全部爬取/导出/主题）+ 账户信息与退出；
      侧边栏开关操作收纳后顶栏精简为汉堡 + 标题 + 少量高频操作，功能与收纳前一致。
- [ ] **AC12**（R10）：Dashboard 提供「批量」按钮，进入后每行站名前出现圆形选择点（未选=白底描边、
      已选=黑底带勾），底部浮现毛玻璃扩展栏（Apple frosted glass：`backdrop-filter: blur+saturate`、
      半透明底、细描边、大阴影、圆角），含「已选 N 项 / 全选(可切换取消全选) / 删除 / 取消」；
      删除可移除选中站点，取消退出批量模式。
- [ ] **AC13**（R11）：侧边栏「爬取间隔」为数字输入框可直接输入分钟数，输入框后有一个圆形包裹的
      「!」图标，鼠标悬停显示推荐时间范围提示（tooltip）；改动后写入 `scrape_interval_min`。
- [ ] **AC14**（R12）：侧边栏「设置」点击进入独立整屏设置页；设置页左侧分区导航含通用偏好 / 安全 /
      签到 / 数据与关于四项，点击切换右侧内容并高亮当前项；安全分区含修改密码（对齐宽度）、两步验证
      (2FA/TOTP) 与 Passkey (WebAuthn) 卡片；签到分区「新增站点默认开启签到」开关可点击切换。
- [ ] **AC15**（R13）：主页与设置页共用同一个全局侧边栏（`fixed`），两页顶栏均为汉堡入口；主页→设置
      与设置→主页均走「汉堡 → 侧边栏 → 导航项」同一路径，导航项随当前视图高亮。Dashboard 主区
      「紧凑」按钮点击后切换表格行高并保持激活态（反色、不随悬停变色）。

## Out of Scope

- 仅支持 new-api 面板；其他中转站程序不在本次范围。
- 签到仅对齐 QuantumNous/new-api 端点；其他 new-api 分叉的签到路径以后再加（TD3）。
- 多用户 / 团队协作（保持单用户）。
- 自动过 Turnstile 人机验证（技术上 access token 无法绕过，明确不做）。
- 余额/消费历史曲线、多货币自动汇率拉取等增强，本次不做。
