# 续接说明 / HANDOFF

> 新终端接手本任务时，先读这个文件，再读 `prd.md` / `design.md` / `implement.md`。
> 最近更新：2026-07-25 会话（依赖漏洞清零 9→0 已提交推送；UI 预览删爬虫页「立即全部爬取」+ 测活页加默认/分组切换；下一步待 Playwright 实测）。任务处于 **Phase 2 执行中**（`task.py start` 已执行，status=in_progress）。

## 🔑 恢复本任务的一句话（新终端直接照做）

```
读 H:\学习\Github\Rrelaynest\.trellis\tasks\07-20-relaynest-rebuild\HANDOFF.md 恢复任务进度。
UI 活文件在仓库 docs/ui-preview.html，改前先 Read
（含中文，字符串匹配易失败，可用 Python 按 ASCII 锚点定位；改完用 node 校验 JS 语法）。
桌面 C:\Users\Fjfangjie\Desktop\rrelaynest-ui\preview.html 只是快照，仓库改完需 copy 到桌面备份。
```

- 本文件是唯一入口，已串好 prd/design/implement 引用与全部 UI 交互清单，不用逐个点名。
- 需要看**原始对话记录**时：`C:\Users\Fjfangjie\.claude\projects\H-----Github-Rrelaynest\` 下的 `.jsonl`。

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
- **当前主交付物：仓库 `docs/ui-preview.html`**——自包含单文件
  > ⚠ **活文件在仓库**:实际在改的是仓库 `docs/ui-preview.html`(最新)，桌面 `C:\Users\Fjfangjie\Desktop\rrelaynest-ui\preview.html` 只是备份快照。继续在仓库改后需重新 copy 到桌面，二者才不脱节。
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
- **2026-07-22 追加的交互（本轮会话，均已落地 + 语法校验过）**：
  ⑬ **主页全逻辑打通**：行内爬取/签到/删除、全部爬取、导出 CSV/JSON、爬取间隔持久化(localStorage)、
    Toast(success/error/info 三色，右下角，主题自适应，2.4s 淡出)、Esc 关闭优先级(签到窗→编辑窗→自定义面板→抽屉)。
    preview 端用确定性伪随机模拟(不用 Math.random)，块 7 Vue 里换成真实 API 即可。
  ⑭ **无 Token 警告**：站名后红色实心三角(叠白 `!`)，悬停 tooltip；`hasToken` 为 false 时爬取按钮置灰。
    弹窗 Access Token 改为**选填**(留空可先建档)。
  ⑮ **签到三层递进 + 金额链路**：弹窗签到区=「签到」主开关→勾选后展开「启用自动签到」+「默认签到增加金额(开关+金额输入)」。
    手动签到:有默认金额→直接按预设额签到不弹窗；无默认金额→弹金额小窗手动填。签到金额经 `applyCheckin()` **累加到余额**。
    徽章 `badgeFor(s)` 动态显示「已签 +金额」。字段:`autoCheckin`/`defAmtEnabled`/`defAmt`/`ckAmount`。
    签到按钮置灰矩阵:无 Token 且签到 off 才灰(无 Token 但已配签到仍可点，手动记账)。
  ⑯ **可编辑余额**：弹窗加「当前余额(站点货币)」输入框。中心化 `balNum` 为唯一数据源，`recalcBalance()` 派生
    `bal`/`rmbNum`/`rmb`(= balNum × rate)。爬取/签到/编辑保存都走它。
  ⑰ **自定义视图面板**(取代原「紧凑」按钮，位于「自定义」按钮)：右侧滑出窄面板(无全屏遮罩，左侧表格实时可见)，
    含紧凑模式开关 + 列显隐勾选 + **列拖拽重排**(6 点手柄，HTML5 drag，`columns[]` 为列序唯一源)。点面板外/Esc 关闭。
    原「排序字段/方向」下拉已删(排序统一走点表头三态循环)。
  ⑱ **列宽可调 + 自动调整**：表格 `table-layout:fixed`，每列表头右缘可拖拽调宽(`.col-resizer`，最小 60px，存 `columns[].width`)；
    「自定义」和「全部爬取」间加**「自动调整」**按钮(清内联宽→auto 布局测量→回写，封顶 420px；多次点击已修复只增不减的 bug)。
  ⑲ **站点行拖拽重排**：仅未排序 + 非批量时可拖，且**只有从 6 点手柄(`.row-grip`)按下才触发**(mousedown 临时置 draggable，
    dragend/mouseup 撤销)，避免行内选字/点按钮误触。调整 `sites` 原始顺序。
  ⑳ **响应式**：Dashboard 操作按钮移动端换行、文字隐藏留图标；表格横向可滚；设置页左右分栏窄屏堆叠(导航横向滚)；
    弹窗 `fixed inset-0` + `max-h` 内部滚动(小窗不裁)；汇率/货币双列窄屏转单列。
  ㉑ **底部常驻横向滚动条**(`bottomScroll`，`fixed bottom-0`)：表格横向溢出且底边不在视口内时浮现，可拖，与表格滚动双向同步；
    外层 `bottomScrollWrap` 不拦鼠标、内层才是可滚可点本体(修过点不中的 bug)。
  ㉒ **手机端原生滚动**：`bindTableDragScroll` 已删(桌面鼠标按住空白横拖也一并去掉)；触屏完全交给浏览器原生滚动
    (`touch-action:pan-x pan-y` + `-webkit-overflow-scrolling:touch`)，横竖同滑 + 惯性。
  ㉓ **地址列可点跳转**：PC 直接开链接；移动端(`hover:none+pointer:coarse` 或 <640px)点击拦截，右下角弹确认条
    (是→新标签跳转 / 否→隐藏 / 5s 无操作淡出)，不遮挡屏幕。
  ㉔ **批量浮动栏改 `fixed`**：跟随视口底部(原 `absolute` 会随内容跑掉)。⚠ **遗留**:批量栏(`fixed bottom-6`)与底部滚动条
    (`fixed bottom-0`)滚到最底时仍会重叠——曾试「批量模式隐藏滚动条」方案但被用户取消还原，重叠问题**当前未解决**，待定方案。
  - 初始演示站点已扩到 ~43 个(脚本生成，覆盖多币种 USD/CNY/EUR/GBP、各签到态、有无 Token、余额已知/未知)。
- **2026-07-23 追加的交互(本轮会话，均已落地 + node 语法校验过)**:
  ㉕ **汇率两字段模型**:每站存「充值人民币 `rechargeRmb` + 到账站点货币 `rechargeAmount`」，派生 `ratio`(=rmb/amt)，
    折算 RMB = 余额 × ratio(`ratioOf`/`recalcBalance`/`deriveRecharge` 回填旧单值汇率)。每站单独配置。
  ㉖ **充值动作 + 三类历史流水**:行内充值按钮 `rechargeSite`(弹窗填充值人民币/到账额/**可编辑日期**)；
    充值/签到/爬取三类日志(`rechargeLog`/`checkinLog`/`scrapeLog` + `logPush` 尊重显式 ts)，设置页「记录」分区三 tab 查看。
  ㉗ **分页**:默认 10 条/页(可选 5/10/20/50/100)，左侧每页条数选择器 + 右侧 `<< 1 2 3 >>`(无方向箭头，`…` 可点跳页)；
    设置页「通用偏好」可开关「隐藏分页」(全部平铺)。中心化 `pageSize`/`currentPage`/`paginationHidden`。
  ㉘ **站点分组**:工具条「分组」按钮切换分组模式(表格内按组分区，可折叠标题行，分组时不分页)；
    批量模式下标题行/站点行整行可点选中；分组模式下站点可**跨组拖拽**改分组(拖到别组行或组标题)。
    新增/编辑弹窗加「分组」字段——**自定义下拉**(点输入框/箭头列出已有组，可选/可输入新组名新建/留空不分组)。
  ㉙ **汉堡栏新增两页**:「站点」下加「爬虫」「测活」两个顶级视图(`data-view`)。
    爬虫=爬取设置(定时开关/间隔+单位/并发/超时/重试/保存/立即全爬，对接 `/api/settings` scrape 段);
    测活=站点连通性检测(mock,逐站串行探测状态徽章 待检/检测中/正常+ms/较慢/不可达,无 token 更易判不可达;
    块7 需新增 `/api/sites/:id/ping` 类端点)。原「仪表盘」导航项文案统一改为「站点」。
- pencil 仍可用（`@pencil.dev/cli`，登录 buzhidao10068@qq.com；网关 `127.0.0.1:15721` = cc-switch，
  `C:\yingyong\CC Switch\cc-switch.exe`，若 500 则重启它）。但当前流程以 preview.html 为准，pencil 不再用。

## 2026-07-24 追加：出站代理功能（后端 + 前端预览，本轮会话）

**用户 4+1 决策**：① 接受代理在 Workers 上不生效（UI 按平台隐藏/禁用）；② 真支持 SOCKS5——三种类型
（HTTP/HTTPS/SOCKS5）**都只在 Node/Docker 生效**，门控是「按平台」不是「按类型」（用户曾误解为 SOCKS5 才需 docker，
已纠正两次）；③（询问影响，已答）；④ 代理密码加密（复用 crypto.ts 的 AES-GCM / ENCRYPTION_KEY）；
⑤ 全局代理模型：选一个代理作全局、可关闭、无全局则直连；签到与爬取走同一个代理。

**后端（块 1~6 之上增量，两套 typecheck 全绿）：**
- `schema.sql`：新增 `proxies` 表（id/name/type/host/port/username/password_encrypted/enabled/created_at/updated_at）；
  `sites` 增 `proxy_id INTEGER REFERENCES proxies(id) ON DELETE SET NULL`；`settings` 增 `('global_proxy_id','')`；
  索引 `idx_sites_proxy`。**注意**：代码不依赖 FK cascade，删代理时手动回退绑定站点 + 清全局（见 routes DELETE）。
- `src/shared/types.ts`：`SiteRow.proxy_id`、`ProxyRow`、`ProxyConfig`、`FetchLike`（`(url,init?)=>Promise<Response>`）、
  `MakeFetch`（`(cfg:ProxyConfig)=>FetchLike`）。
- `src/shared/routes.ts`：`ProxyInput`；`AppDeps.makeFetch?`；站点 INSERT/UPDATE 处理 proxy_id
  （`body.proxy_id===undefined ? existing.proxy_id : body.proxy_id`）；代理 CRUD（密码「undefined=不变/''=清空/非空=更新」，
  只回 `has_password`）；三处 scrape/checkin 调用点传 makeFetch；DELETE 代理手动 `UPDATE sites SET proxy_id=NULL` + 清全局。
- `src/server/proxy.ts`（**Node-only，新建**）：`createProxyFetch: MakeFetch`。**关键**：用 undici **自己的** fetch+dispatcher
  （不是全局 fetch），HTTP/HTTPS 走 `ProxyAgent`，SOCKS5 走 `socks` 包 + 自建 `Agent`（`connect` 里 `SocksClient.createConnection`，
  https 再套 `buildConnector` 做 TLS）。见 memory [[proxy-fetch-dispatcher-binding]]。
- `src/shared/scraper.ts`：`ScrapeOptions.fetchImpl?`；`fetchJson` 用 `opts?.fetchImpl ?? fetch`。**不 import undici**（保持平台无关）。
- `src/shared/scrape-runner.ts`：`resolveFetch(db,secrets,site,makeFetch?)`——优先级 **站点绑定 > 全局 > 直连**；
  无 makeFetch（Workers）或无可用代理或解密失败 → 返回 undefined（降级直连）。签到与爬取用同一代理。
- `src/shared/scheduler.ts`：`runScheduledTick(...,makeFetch?)`，爬取与签到两个循环都传。
- `src/server/index.ts`：`createApp({db,secrets,makeFetch:createProxyFetch})` + 定时 tick 传 createProxyFetch；
  `src/worker/index.ts` **不传**（代理惰性、强制直连）。
- **两个 undici 坑（已存 memory）**：(1) wrangler 传递依赖 undici 5.29.0 在 Windows 触发 ENOBUFS，解法=直接依赖 undici@8.x；
  (2) 全局 fetch 不认外部 undici 包的 dispatcher，解法=注入 MakeFetch 工厂让 Node 用 undici 自己的 fetch。
  端到端已验证（本地 HTTP 代理转发 E2E PASS）。相关 memory：[[proxy-fetch-dispatcher-binding]]、[[proxy-node-only-architecture]]。

**前端预览（`docs/ui-preview.html`，已落地 + node 语法校验 + 桌面备份同步 + Workers 态截图验证）：**
㉚ **代理页**（汉堡栏「代理」顶级视图 `data-view="proxy"`）：代理池卡片列表（测试/编辑/配置站点/删除、启用开关、
  类型徽章 http蓝/https绿/socks5紫）；**全局代理下拉**（`globalProxySelect`，「直连(不使用代理)」+ 各代理，
  `globalProxy` 为代理名字符串、''=直连，是唯一数据源）；`setGlobalProxy`/`syncGlobalProxySelect`；
  代理增删改级联（改名/删除/停用同步 `sites[].proxy` 绑定与 `globalProxy`）。站点弹窗可绑定代理（`site.proxy`，''=跟随全局/直连）。
㉛ **数据选择性导出**：设置页「数据」分区（原「数据与关于」，关于内容已挪到汉堡栏 `about` 视图）「选择导出」按钮
  开导出弹窗（`exportModalWrap`，默认/分组两视图、复选框、全选/全不选、分组折叠、`exportCount` 计数、doExport('csv'/'json')）。
㉜ **代理平台提示条**（本轮末尾「加」）：`deployPlatform` 变量（默认 'node'）驱动，`showProxy()` 调 `syncProxyPlatformNotice()`；
  仅 `deployPlatform==='workers'` 时代理页顶部显示琥珀色警告条（「Workers 无法连接自建代理，强制直连，配置仅 Node/Docker 生效」），
  不锁交互（仍可查看/编辑）。**块 7 换成启动探测/配置注入**真实平台标识。

**遗留/待办（代理相关）**：块 7 接真实 API 时——(a) 前端 `deployPlatform` 换成后端注入的真实平台标识；
(b) 代理页对接 `/api/proxies` CRUD 与 `/api/settings` 的 `global_proxy_id`；(c) 「测试」按钮对接真实探活端点；
(d) 密码字段遵循 has_password 语义（不回明文）。

## 2026-07-25 追加：依赖漏洞清零 + 块7 前三条 UI 决策（本轮会话）

**依赖漏洞清零（已提交 `660f35a` 并推送到 main）：** `npm audit` 9→0。
- 升级：`@hono/node-server` 1→2.0.11（修 Windows serve-static 路径穿越 `%5C`，我们正好在 Windows 用 serveStatic，是真实运行时风险）、
  `node-cron` 3→4.6.0（4.x 自带 TS 类型，`import cron`+`cron.schedule` 用法不变）、`wrangler` 3→4.114.0、`@cloudflare/workers-types` 4→5.x（wrangler4 peer 要求）。
- 删除 `@types/node-cron`（node-cron 4 自带类型）。
- 验证：两套 typecheck 全绿；`build:server`(tsc) + `wrangler deploy --dry-run`(bundle 通过、D1/Assets binding 正确) 均 PASS；
  `vite build` 失败但**与升级无关**——`src/frontend/main.ts` 不存在（块7 前端未写）。

**块7 三条 UI 决策（2026-07-25 用户提出，已落地 `docs/ui-preview.html` + node 语法校验通过）：**
㉝ **爬虫页删「立即全部爬取」按钮**：`data-view="scraper"` 底部按钮区只留「保存设置」（原 `scrapeAll()` 按钮已删）。
㉞ **测活页加默认/分组切换**：仿主页——工具条加「分组」按钮（`activityGroupBtn` → `toggleActivityGroupMode()`）；
  新增状态 `activityGroupMode`/`activityCollapsed`（与主页 `collapsedGroups` 独立）；抽出 `activityRowHtml(s)` 单站行 +
  `activityGroupHeaderHtml(g,rows)` 组标题（整行可点折叠，同款观感）；`renderActivityList()` 加分组分支，组序复用主页 `allGroups()`。
  测活页**不做**分页/跨组拖拽（那是主页职责），只归类展示 + 折叠。
㉟ **待补后端逻辑（memory 已记 [[scraper-backend-concurrency-todo]]）**：爬虫页的并发/超时/重试字段后端 `scrapeAndStore`/`runScheduledTick`
  目前是串行 for、无超时、无重试——块7 接 API 时需补后端实现，或前端先只留「定时开关 + 间隔」两个真实生效字段。

**块7 测活「两种检测 + 自定义测活词」（2026-07-25 用户提出，已落地 `docs/ui-preview.html` + node 语法校验 + Playwright 实测通过）：**
㊱ 参考 new-api `/channels`：测活拆两种检测——**测试连接**（响应耗时，`runConnectivityCheck()`→`connResults`）+ **渠道测试**
  （发一句「测活词」看模型能否正常回复，`runModelCheck()`→`modelResults`）。两套结果独立，每行并排显示两个徽章。
  连接徽章：正常 xxms／较慢／不可达／连接中／待检；模型徽章：可用／不可用（均带 `· <测活词>`）／测试中／待检。
㊲ **「测活词」= 发给模型的 prompt（不是模型名、也不是搜关键词）**，new-api 写死 `hi`，此处做成可自定义：
  全局默认 `globalProbeText`（测活页顶部 `#activityProbeText` 输入框，默认 `hi`，`setGlobalProbeText()` 即时生效）+
  单站覆盖 `site.probeText`（编辑弹窗 `#m_probeText`，留空=用全局）。取值优先级见 `effectiveProbe(s)`：单站 > 全局 > 兜底 `hi`。
㊳ 测活词经 `escHtml()` 转义后再进徽章（防 XSS，已 Playwright 验证 `<img onerror>` 被转义）。
㊴ 术语澄清（避免再走弯路）：用户口中「自定义测活词」**特指发送的那句话**，不要理解成"测试模型名"或"响应关键词匹配"。

**块7 测活「测活词池升级」+ 回到顶部（2026-07-25 用户提出，已落地 + node 语法校验 + Playwright 实测通过）：**
㊵ **测活词从单输入框升级为「测活词池」**（仿代理页 `proxies` + 「配置站点」那套同构架构）：
  - 数据：`probeWords=[{text,enabled}]`，`text` 为唯一键；站点 `site.probeText`=某 text **单值绑定（一站对一词，用户明确定）**，
    空串=跟随全局。内置默认三条 `hi/你好/ping`。取词回落 `effectiveProbe(s)`：单站绑定（须启用）> 全局默认（须启用）> 第一条启用 > `hi`。
  - **持久化（本轮新增，覆盖上轮㊳的"内存态"结论）**：词条列表存 `localStorage['rrelaynest-probes']`、全局默认词存
    `['rrelaynest-probe-global']`；`loadProbeWords()` 在 init 调用（同 `loadInterval` 时机），增删改词后 `saveProbeWords()`。
    **站点绑定 `site.probeText` 仍随内存**（与其他站点字段一致，演示端不落库）。
  - UI：测活页顶部「测活词」区块 = 新增按钮 + 全局默认词 `#globalProbeSelect`（仅列启用词）+ 词条卡片列表 `renderProbeList()`
    （每卡：词内容 + 启用/停用/全局徽章 + 启用开关 + 编辑 + 配置站点[带绑定数] + 删除）。
  - 词条增删改：`probeModalWrap`（单字段，仿 `proxyModalWrap` 缩水版）+ `openProbeModal/submitProbeModal`；改名会同步绑定它的站点与全局默认词。
  - 「配置站点」：**平行新增** `probeAssignModalWrap` + `openProbeAssign/renderProbeAssignList/saveProbeAssign`（照抄代理版逻辑改写
    `site.probeText`，`data-passign` 复选框，默认/分组视图 + 暂存切视图）。**未复用代理那套函数**，以免动坏代理绑定。
㊶ **站点编辑弹窗 `#m_probeText` 从自由输入改为下拉选词**（`fillProbeOptions()`：首项「跟随全局(当前全局词)」+ 启用词条；
  用户选 A 方案=值域受控，建词只能在测活页）。
㊷ **测活页 + 代理页加「回到顶部」按钮**（`#backTopBtn`，fixed 右下）：`showView` 记 `currentView`，`syncBackTop()` 在
  `currentView∈{activity,proxy}` 且 `window.scrollY>400` 时淡入；`window.scroll` 监听 + 切页各触发一次。页面是 window 级滚动。

**块7 爬虫拆成两个平台页（2026-07-25 用户提出，已落地 `docs/ui-preview.html` + node 语法校验 + Playwright 实测通过）：**
㊸ **爬虫单页拆成两个独立导航项**（用户明确「两个独立导航项」）：原 `data-view="scraper"` → `scraperCf`（爬虫·Cloudflare）
  + `scraperDocker`（爬虫·Docker）；侧栏两条 nav（`showScraperCf()`/`showScraperDocker()`）。两页元素 id 以 `cf_`/`dk_` 前缀区分。
㊹ **两页差异体现在四个维度**（用户多选：定时机制/代理支持/并发超时重试/平台限制提示）：
  - **定时机制**：CF 页=Cron Triggers，输入 `#cf_cron`（5 段 cron，`syncCfCronPreview()` 实时生成 `wrangler.toml` 片段
    `#cf_cronSnippet` + `copyCfCron()` 复制；文案强调「不能运行时热更新，需改 wrangler.toml 重新部署」）；
    Docker 页=node-cron，`#dk_scrapeInterval`+单位下拉（文案「修改即时生效，无需重启」）。
  - **代理支持**：CF 页=不支持卡片（灰掉 opacity-70，斜杠图标，强制直连）；Docker 页=支持卡片（http/https/socks5 + 「前往代理页」跳转按钮）。
    与 [[proxy-node-only-architecture]] 一致（代理仅 Node/Docker 生效）。
  - **并发/超时/重试**：CF 页仅并发(`max=6`，注 subrequest 上限)+超时(`max=30`，注 CPU 时限)，**无重试**；
    Docker 页并发(`max=50`)+超时+失败重试(`#dk_scrapeRetry`)，文案「无平台硬限制」。
  - **平台限制提示**：CF 页顶部橙色提示条(Cron Triggers/不支持代理/subrequest·CPU 限制)；Docker 页顶部绿色提示条(node-cron/支持代理/无硬限制)。
  - 头部各带平台徽章（CF=橙「Workers」、Docker=蓝「Node/Docker」）。`toggleScrapeAuto(p)`/`saveScrapeSettings(p)` 收 `'cf'|'dk'` 前缀参数。
  - ⚠**mock 与真实后端的落差（用户 2026-07-25 指出，须在块7 校正）**：当前 `src/*/index.ts` 两个入口的 cron 其实**都写死每 5 分钟 tick**，
    真实间隔由 `settings.scrape_interval_min` 节流（`scheduler.ts:43`，`now-lastRun>=interval` 才跑），**CF 与 Docker 机制相同、都热改即时生效、都不需重新部署**。
    mock 里「CF=改 cron 表达式 + 写 wrangler.toml 重新部署」是**超前/理想化设计**，非当前实现。块7 接后端时二选一：
    (a) 把 CF 页也改成「间隔 + setting 热改」贴合现状；(b) 后端真去支持 wrangler Cron Triggers 表达式落地。此决策留给块7。

**块7 关于页「检查更新」（2026-07-25 用户提出，参考 Wei-Shaw/sub2api，已落地 `docs/ui-preview.html` + node 语法校验 + Playwright 实测通过）：**
㊺ **关于页加「发布更新→所有部署者收到通知」机制**：数据源 = GitHub Releases API（`buzhidao10068/Rrelaynest`），每个部署实例查
  `releases/latest` 的 `tag_name`，与本地 `APP_VERSION` 用 `cmpVersion()`(语义版本三段比较) 比对；有新版仅**通知 + 给对应平台升级步骤**。
  - **关键约束（与 sub2api 的差异，须记牢）**：sub2api 的「一键更新」只在其脚本/二进制安装模式可用（下载新二进制替换自己）。
    本项目 Workers/Docker **都无法应用内自更新**（容器改不了自己的镜像、Workers 运行时无权改自己的部署）。所以**不做假的一键按钮**，
    只做「检查 + 通知 + 展示升级命令」：`updateStepsHtml()` 按 `deployPlatform` 出步骤——Workers=`git pull/npm ci/build/wrangler deploy`，
    Docker=`docker compose pull && up -d`。
  - UI：版本行旁小红点徽章 `#aboutUpdateDot`（有新版显示「有新版 vX.Y.Z」）；`#checkUpdateBtn`（转圈 700ms mock）+ 发布记录外链；
    `#updatePanel`（发现新版=版本号 vA→vB + 更新日志列表[body 按行 `escHtml` 转义防 XSS] + 平台升级步骤 + 该版本 release 外链；
    已最新=对勾「已是最新版本」）；`#autoUpdateSwitch` 自动检查开关（`localStorage['rrelaynest-auto-update']` 持久化，默认开，
    开启则进关于页静默 `renderUpdateResult(...,silent=true)` 查一次）。
  - mock 数据：`MOCK_LATEST={tag_name:'v1.2.0',...}`，块7 换成真实 fetch。**后端待补 `/api/update/check` 代理 GitHub Releases**
    （前端直连 GitHub 有 CORS/限流问题，且能隐藏 repo 细节 → 走后端代理更稳）。

**块7 通用偏好「平台检测 + 一键隐藏非当前平台功能」（2026-07-25 用户提出，已落地 `docs/ui-preview.html` + node 语法校验 + Playwright 实测通过）：**
㊻ **设置·通用偏好加「部署平台」卡片**：自动检测按钮 + 一键过滤按钮，按钮文案随检测平台动态变。
  - 自动检测 `detectPlatform()`：演示端转圈 600ms 后沿用当前 `deployPlatform` 并落 `localStorage['rrelaynest-platform']`；
    块7 换成读后端注入的真实平台（启动探测 / `/api/meta` 的 platform 字段），**不靠前端猜**。
  - 过滤按钮 `togglePlatformFilter()`：文案随平台变——Docker 部署显示「隐藏非 Docker 功能」，Cloudflare 显示「隐藏非 Cloudflare 功能」；
    开启后隐藏 `data-platform` 与当前平台不符的**侧栏导航项 + 对应页面**，再点变「显示全部功能」恢复。状态落 `localStorage['rrelaynest-platform-filter']`。
  - **平台标记**：侧栏三个平台相关导航项打 `data-platform`——爬虫·Cloudflare=`workers`、爬虫·Docker=`node`、代理=`node`（代理仅 Node/Docker，见 [[proxy-node-only-architecture]]）。
    测活/站点/设置/关于**无标记=两平台通用**，永不隐藏。
  - **隐藏效果**：Cloudflare 隐「爬虫·Docker + 代理」；Docker 隐「爬虫·Cloudflare」。`applyPlatformFilter()` 用 `.hidden` 切显隐；
    若正停留在被隐藏的页（`currentView` 命中），自动 `showView('dashboard')` 弹回站点页，避免看空白页。
  - `syncPlatformFilterCard()`（general 分区渲染 + 检测/切换后调）填充检测结果文案 + 按钮标签样式 + 说明；`loadPlatformFilter()` 在 init 调（恢复持久化平台+过滤态并 apply）。

**下一步（新终端接手）**：测活页 + 爬虫两页 + 关于页更新检查前端本轮全完；后端仍缺 `/api/sites/:id/ping`（测连接）与渠道测试端点（发 probe 调模型），
且需落 `probe_words` 表 + `site.probe_text` 字段 + 全局默认词进 `/api/settings`（memory 已记 [[activity-probe-backend-todo]]）。
爬虫两页后端：CF 用 wrangler.toml 的 Cron Triggers（前端只读展示），Docker 用 node-cron；并发/超时/重试落 `settings` scrape 段
（[[scraper-backend-concurrency-todo]] 记的待补实现，且需按平台分别取默认上限）。

## 恢复 active task 指针（如新终端识别不到）

```bash
cd H:/学习/Github/Rrelaynest
python ./.trellis/scripts/task.py current --source   # 确认是否已指向本任务
# 本任务 status 已是 in_progress，无需再 start；靠读本文件恢复上下文即可继续 Phase 2
```
