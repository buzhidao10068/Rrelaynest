# 续接说明 / HANDOFF

> 新终端接手本任务时，先读这个文件，再读 `prd.md` / `design.md` / `implement.md`。
> 最近更新：2026-07-21 会话。任务处于 **Phase 2 执行中**（`task.py start` 已执行，status=in_progress）。

## 一句话现状

用 trellis 流程**重做**中转站管理面板（参考基线：废弃版 relaynest）。规划三个 Open Questions 已全部解决：
技术栈照搬废弃版（CF Workers + D1 + 原生 SQL + Hono + Vue 3 + 自研 auth）、双部署目标（Workers + Docker）、
新增签到自动化 + 数据导出。**后端 + 双入口（块 1~6）已完成、typecheck 全绿、已提交并推送到私有库。**
当前卡点：块 7 前端（改用 shadcn-vue 风格）之前，想先用 pencil CLI 出 UI 设计图，但被本地网关阻塞（见下）。

## 关键路径速查

- 参考基线（旧实现，功能完整）：废弃版 relaynest（同机另一目录，未纳入本仓库）
- 远程私有库：`https://github.com/buzhidao10068/Rrelaynest`（默认分支 main，已推送块 1~6）
- 本任务目录：`.trellis/tasks/07-20-relaynest-rebuild/`
- trellis 工作流说明：`.trellis/workflow.md`；技术栈 spec：`.trellis/spec/`
- 开发者身份：`buzhidao10068`（已初始化）
- **git 推送需走代理**：`git config --global http.proxy socks5h://127.0.0.1:7738`（注意是 socks5h，DNS 也走代理；
  用 socks5:// 会因本机 DNS 解析失败而 push 报错）

## 已完成的工作（Phase 1 + Phase 2 块 1~6）

**Phase 1（规划，全部完成并经用户 review）：**
1. 通读废弃版全部源码（后端 7 文件 + 前端 5 文件 + schema + 配置）。
2. 经代理 7738 从 QuantumNous/new-api 源码核实签到接口：`GET/POST /api/user/checkin`，
   `Authorization: Bearer`，成功返回 `data.quota_awarded`（÷500000 得美元），POST 挂 TurnstileCheck 中间件。
3. 写好 `prd.md`（收敛版）、`design.md`、`implement.md`，curate `implement.jsonl`/`check.jsonl` 并 validate 通过。
4. `task.py start` 已执行，status=in_progress。

**Phase 2（执行，块 1~6 完成，7 个提交已推送）：**
- 块1 工程骨架（package.json/wrangler.toml/tsconfig/tsconfig.server.json/vite.config.ts/index.html/.gitignore/.dev.vars.example）
- 块2 `schema.sql`（4 表 + sites 增 last_checkin_at/checkin_result + settings 增 checkin_last_reset_at）
- 块3 `src/shared/` 基础设施：types.ts / db.ts（Database 抽象）/ crypto.ts / auth.ts
- 块4 `src/shared/scraper.ts`（爬虫 + checkinSite）/ scrape-runner.ts（scrapeAndStore + checkinAndStore）
- 块5 `src/shared/routes.ts`（createApp 工厂：CRUD/爬取/设置 + 新增手动签到 + 导出 CSV/JSON）
- 块6 `src/shared/scheduler.ts` + `src/worker/`（db-d1.ts wrapD1 + index.ts）+ `src/server/`（db-sqlite.ts + index.ts）
- **重要技术决策**：better-sqlite3 需原生编译（本机无 VS 工具），已按设计预置回退改用 **Node 内置 `node:sqlite`**
  （需 Node 22+，本机 v24 满足）。扩容提示写在 `src/server/db-sqlite.ts` 头部与 `implement.md` 风险段。
- `npm run typecheck`（worker + server 两套 tsconfig）全绿。

## 下一步（新终端从这里继续）

**待办：块 7 前端 + 块 8 Docker/文档，之后 Phase 3（check → update-spec → commit → finish-work）。**

- **前端方向已定**：留在 Vue 3，用 **shadcn-vue**（https://www.shadcn-vue.com，shadcn/ui 的 Vue 移植，
  Reka UI + Tailwind）实现，观感对齐 shadcn。三个界面：登录页 / Dashboard 站点表格 / SiteEditor 弹窗，
  功能照搬废弃版 + 新增签到列/手动签到按钮 + 导出按钮。
- **新增需求 R8 主题切换**（2026-07-21 用户提出）：亮色/暗色/跟随系统三档，localStorage 持久化，
  纯前端 CSS 变量方案（`:root`+`.dark`），详见 prd.md R8/TD5/AC10、design.md「主题切换」小节、
  implement.md 块 7。切换器放 Dashboard 顶栏 + 登录页。
- **新增需求 R9 侧边栏 + 汉堡菜单**（2026-07-21 用户提出）：Dashboard 左上角汉堡图标，点击从左侧
  滑出 sidebar（overlay + 遮罩 + Esc/点遮罩关）。侧边栏定位为**导航 + 操作中枢**：品牌头 +
  导航项（仪表盘/设置/关于）+ 收纳顶栏操作（爬取间隔/全部爬取/导出/主题/退出）+ 底部账户信息。
  顶栏随之精简为「汉堡 + 标题 + 少量高频操作」。详见 prd.md R9/AC11、design.md「侧边栏」小节、
  implement.md 块 7。移动端 sidebar 满宽，桌面端固定宽 ~280px。
- **新增需求 R10 批量管理**（2026-07-21 用户提出）：Dashboard 主区「批量」按钮（与全部爬取同款
  次要样式，放统计卡下方那行最左）。进入批量模式后每行站名前出现圆形选择点（未选 ⚪ 白底描边 /
  已选 ⚫ 黑底带勾）；底部浮现 **Apple 毛玻璃浮动栏**（`backdrop-filter: saturate(180%) blur(20px)`
  + 半透明 + 细描边 + 大阴影 + 圆角），含 N 项已选 / 全选(取消全选) / 删除 / 取消。
  详见 prd.md R10/AC12、implement.md 块 7。
- **新增需求 R11 爬取间隔可编辑 + 推荐提示**（2026-07-21 用户提出）：侧边栏「爬取间隔」由只读 pill
  改为可输入数字框（分钟），框后跟「圆圈包裹的 ！」信息图标，悬停显示推荐时间范围 tooltip。
  持久化到 `settings.scrape_interval_min`（对齐 R2/AC3）。详见 prd.md R11/AC13、implement.md 块 7。
- **新增需求 R12 设置页**（2026-07-21 用户提出）：侧边栏「设置」进入独立**整屏**设置视图
  （与 Dashboard 同级，`data-view`/未来 vue-router），左分区导航 + 右内容，四分区：
  通用偏好（默认货币/语言）、安全（改密码对齐 + 两步验证 2FA + Passkey，参考 new-api 卡片式）、
  签到（新站默认签到开关 + 跨天重置时区）、数据与关于（导出/版本/危险区）。用户最终选
  **整屏形式**（曾同时生成整屏+弹窗对比，弹窗式已删）。详见 prd.md R12/AC14、implement.md 块 7。
- **新增需求 R13 表格紧凑模式**（2026-07-21 用户提出）：Dashboard 主区「紧凑」按钮（「全部爬取」
  左侧，同款 outline），中心化 `compactMode`，切换表格行高（`py-3`↔`py-1.5`）+ 按钮激活态反色。
  详见 prd.md R13/AC15、implement.md 块 7。
- 表格增强（原型已做，块 7 照搬）：站点名称/余额/签到状态/上次爬取四列表头可点击三态排序
  （原始→升序→降序→原始），换列从升序起；余额按折 RMB 数值、签到按优先级、爬取按距今分钟排。

**⚠ 出图方式已从 pencil 转为手写 HTML 预览（2026-07-21 用户决策）：**
- pencil 出满 5 张（`01-login` / `02-dashboard` / `03-site-editor` / `04-dashboard-dark-theme` /
  `05-sidebar`，均在桌面 `rrelaynest-ui\`）。但 pencil 每张 3-6 分钟、走 cc-switch 本地网关时好时坏，
  且产出是 `.png` 死图，离可跑代码隔一层。用户遂决定**改用手写单文件 HTML 交互预览**。
- **当前主交付物：`C:\Users\Fjfangjie\Desktop\rrelaynest-ui\preview.html`**——自包含单文件
  （Tailwind CDN + shadcn zinc CSS 变量 token + `darkMode:'class'`），真实部署流：登录→Dashboard，
  抽屉/弹窗/主题切换/表格排序/批量全部可交互。这份 HTML 就是块 7 Vue 代码的直接骨架。
- **preview.html 已实现并经用户逐条确认的交互**：① 主题三档（亮/暗/跟随系统，localStorage + FOUC 防闪白）；
  ② 汉堡开合左侧抽屉（含品牌头/导航/操作/账户）；③ 顶栏精简（仅汉堡+标题）；④ 编辑弹窗（启用自动签到开关
  在左、默认关）；⑤ 站点表格四列可点排序（站点名称/余额/签到状态/上次爬取，三态循环 + 图标）；
  ⑥ 「全部爬取」移到主区「新增站点」左侧（outline 次要样式）；⑦ **R10 批量**：批量按钮 + 行前圆形选择点
  （⚪→⚫带勾）+ Apple 毛玻璃浮动栏（N项已选/全选/删除/取消，`backdrop-filter:saturate(180%) blur(20px)`）；
  ⑧ **R11 爬取间隔**：抽屉内改为可输入数字框 + 圆圈「！」信息图标，悬停 tooltip 提示推荐范围（建议 15-60 分钟）。
  ⑨ **R12 设置页（整屏）**：侧边栏「设置」进入，左分区导航（通用偏好/安全/签到/数据与关于）+ 右内容，
  安全区含 2FA + Passkey（new-api 风格卡片）；弹窗式已删，只留整屏。
  ⑩ **全局侧边栏**：抽屉抽成全局元素（`fixed`，脱离 Dashboard 视图），主页与设置页共用同一侧边栏；
  两页入口对称——都走「汉堡→侧边栏→导航项」（设置页顶栏也是汉堡，非返回箭头），导航项按当前视图高亮。
  ⑪ **R13 紧凑模式**：主区「紧凑」按钮切换表格行高 + 按钮反色（中心化 `compactMode`，从设置页移出）。
  ⑫ **新建/编辑分离**：`openModal('create')` 空表单（标题「新增站点」/按钮「创建」），
  行内铅笔 `editSite(name)→openModal('edit',site)` 填入数据（标题「编辑站点」/按钮「保存」）；批量按钮激活后固定反色、去 hover。
- pencil 仍可用（`@pencil.dev/cli`，登录 buzhidao10068@qq.com；网关 `127.0.0.1:15721` = cc-switch，
  `C:\yingyong\CC Switch\cc-switch.exe`，若 500 则重启它）。但当前流程以 preview.html 为准，pencil 不再用。

## 恢复 active task 指针（如新终端识别不到）

```bash
cd H:/学习/Github/Rrelaynest
python ./.trellis/scripts/task.py current --source   # 确认是否已指向本任务
# 本任务 status 已是 in_progress，无需再 start；靠读本文件恢复上下文即可继续 Phase 2
```
