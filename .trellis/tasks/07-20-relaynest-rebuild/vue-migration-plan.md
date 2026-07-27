# 块 7 前端:mock → Vue 3 迁移计划

> 把 `docs/ui-preview.html`(4719 行 / 237 函数 / 10 视图 / 7 设置分区)迁移成真实 Vue 3 工程。
> 已锁决策:**shadcn-vue 组件**(Reka UI + Tailwind)/ **全量 mock 数据**(本轮不接真实 API)/ **构建期 Tailwind v3**。
> 每个 Phase 是独立可 build/review 的批准单元;逐 Phase 执行,每步 `npm run build` + `npm run typecheck` 绿灯。

## 目标与边界

- **目标**:把 mock 的观感与交互 1:1 落成 Vue 3 SFC 工程,产物进 `dist/`,由现有 Node/Workers 入口托管。
- **本轮数据**:全部前端 mock(sites/proxies/settings/users/probe 都是内存假数据),**不接** `src/shared/routes.ts` 的真实 API。接线留到后续轮次(与 `multiuser-plan.md` 的后端多用户一并推进)。
- **不动**:后端 `src/shared`、`src/server`、`src/worker`、schema、代理逻辑一律不改。
- **保留**:mock 的所有 localStorage 键(theme / interval / platform / platform-filter / auto-update / demo-role / global-view-ack / probe-words)。
- **图标**:mock 用内联 lucide 风格 SVG → 换成 `lucide-vue-next` 组件。
- **状态**:轻量 `reactive()` store 模块(不引 Pinia,减依赖);行为封装进 composables。

## 目录结构

```
src/frontend/
  main.ts                 # createApp + 挂载
  App.vue                 # 顶层视图切换(view router)+ 抽屉 + 全局弹窗
  style.css               # @tailwind 指令 + :root/.dark CSS 变量 token(照搬 mock)
  lib/
    utils.ts              # cn() = clsx + tailwind-merge
    mock.ts               # 所有 mock 数据(sites/proxies/users/probe/settings 初值)
  stores/
    ui.ts                 # currentView / drawer / theme / deployPlatform
    sites.ts              # sites / columns / pageSize / batchMode / groupMode
    proxies.ts            # proxies / globalProxy
    settings.ts           # settingsSection + 各设置项
    users.ts              # currentRole / mockUsers / mockUserSites / globalViewAck
    probe.ts              # probe 词 / 测活状态
  composables/
    useTheme.ts  useSidebar.ts  ...(按需)
  components/ui/          # shadcn-vue 原语(手写落地,不跑 CLI)
    button/ card/ input/ label/ badge/ dialog/ switch/ select/ tooltip/ ...
  views/
    LoginView.vue  DashboardView.vue  ProxyView.vue  ActivityView.vue
    ScraperCfView.vue  ScraperDockerView.vue  AboutView.vue
    SettingsView.vue  UsersView.vue  UserSitesView.vue
  components/
    AppDrawer.vue         # 侧边栏抽屉(导航 + 操作中枢 + 账户)
    SiteTable.vue  SiteEditorModal.vue  ProxyModal.vue  ...(视图内子组件)
```

## Phase A — 脚手架与构建(无可视产出)

- 装依赖(代理已配好):`tailwindcss@3` `postcss` `autoprefixer` `tailwindcss-animate` `reka-ui` `class-variance-authority` `clsx` `tailwind-merge` `lucide-vue-next`
- `tailwind.config.ts`:照搬 CDN 的 `tailwind.config`(darkMode:'class' + token 颜色映射 + radius);`content` 指向 `src/frontend/**/*.{vue,ts}` + `index.html`
- `postcss.config.js`
- `src/frontend/style.css`:`@tailwind base/components/utilities` + mock 的 `:root`/`.dark` 变量块 + 自定义 CSS(滚动条、col-resizer、`[data-view]` 规则改由 Vue 控制可删)
- `@/` 别名 → `src/frontend`(vite.config.ts `resolve.alias` + tsconfig `paths`)
- `lib/utils.ts` cn()
- `main.ts` + `App.vue` 空壳(含 FOUC 主题守卫,从 index.html 内联脚本迁移或保留)
- **校验**:`npm run build` 出 `dist/`;`npm run typecheck` 绿

## Phase B — shadcn-vue 原语

按视图实际用到的集合手写落地:`Button` `Card`(+Header/Content/Footer)`Input` `Label` `Textarea` `Badge` `Switch` `Dialog`(Reka)`Select`(Reka)`Tooltip`(Reka)`DropdownMenu`(Reka,分组/分页菜单用)。
- **校验**:build + typecheck 绿

## Phase C — 登录 + Dashboard 外壳 + 主题/抽屉

- `LoginView`、`DashboardView` 顶栏 + 统计卡、`AppDrawer`(导航项含 admin-only 门控 + 账户 + demo 角色切换)
- `useTheme`(light/dark/system + localStorage + matchMedia)、`useSidebar`
- **校验**:build + Playwright 冒烟(登录→dashboard、抽屉开合、主题切换)

## Phase D — 站点表格(最大块)

`SiteTable`:列定义 / 排序 / 分组模式(不分页)/ 分页 / 批量模式(毛玻璃浮动栏)/ 自定义列面板 / 列宽拖拽 / 行拖拽 / 紧凑模式 / 地址跳转确认。
- **校验**:build + Playwright(分页、分组、批量选删、列宽、拖拽)

## Phase E — 站点编辑弹窗 + 行内动作

`SiteEditorModal`(含 checkin_enabled / proxy 绑定 / 货币汇率)、手动爬取 / 手动签到 / 充值 / 可编辑余额、签到金额链路。
- **校验**:build + Playwright(新增/编辑/删除、签到、充值)

## Phase F — 代理

`ProxyView` + `ProxyModal` + 全局代理选择 + 平台提示(Workers 灰掉)+ 连通性测试 mock。
- **校验**:build + Playwright

## Phase G — 测活(Activity)

`ActivityView` + 分组头 + 测活弹窗 + 站点/探测词分配 + 两种检测 + 测活词全局/单站覆盖。
- **校验**:build + Playwright

## Phase H — 爬虫设置(CF + Docker)

`ScraperCfView`(cron 复制)+ `ScraperDockerView`(并发/超时/重试字段,mock)。
- **校验**:build

## Phase I — 设置页(7 分区)

`SettingsView` 左分区导航 + 右内容:general / security / checkin / data / records / privacy(协作与隐私:条款解锁)。admin-only 分区门控。
- **校验**:build + Playwright(分区切换、条款解锁/撤销)

## Phase J — 多用户(用户管理 + 跨用户只读)

`UsersView`(邀请制、用户 CRUD、自我保护)、`UserSitesView`(管理员只读横幅)、`useMultiUser`(角色门控 + 条款解锁双守卫)。逻辑照搬本会话已在 mock 里验证过的实现。
- **校验**:build + Playwright(角色门控、解锁/撤销、CRUD、自我保护)

## Phase K — 关于 + 收尾

`AboutView`(版本 / 检查更新 mock / 平台检测 / 自动更新开关 / 危险区)、导出弹窗、全量 parity 走查。
- **校验**:build + typecheck + 全量 Playwright 对照 mock 逐视图核对

## 风险 / 注意

- **规模**:这是多轮工程。逐 Phase 提交(经你确认后),不一次性铺开。
- **`node --check` 不适用 SFC**:Vue 单文件靠 `npm run build`(vite)+ `npm run typecheck`(vue-tsc/tsc)校验;需确认 typecheck 是否要加 `vue-tsc`(当前脚本是纯 tsc,对 `.vue` 模板类型检查有限)。
- **mock 的行为细节**(列宽拖拽、行拖拽、毛玻璃浮动栏)在 Vue 里要用指令/ref 重写,是 Phase D 的主要工作量,易偏离,重点自测。
- **docs/ui-preview.html 保留**为设计快照/对照基线,不删。
- Playwright 走本地 `npm run dev`(5173)或 build 后 `npm run start:node`(需 secrets + dist),优先前者做纯前端验证。

## 落地顺序建议

Phase A→B 先把地基和原语打好(一次性),之后 C→K 逐视图推进。每个 Phase 结束汇报并等你确认再进下一个,或你可授权连续推进若干 Phase。
