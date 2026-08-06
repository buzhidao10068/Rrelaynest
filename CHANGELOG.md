# 更新日志（Changelog）

本项目所有值得记录的变更都写在这里。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

每次发布新版时：先在这里新增一节，再 bump `package.json` 的 `version`，
并在 GitHub 打上对应的 `vX.Y.Z` tag 发 Release——应用内的「检查更新」据此判断新版。

## [未发布]

### 文档
- **修正 D1 绑定说明（重要纠错）**：此前文档称 `wrangler.toml` 的 `keep_vars = true` 能让面板里手动绑定的 D1 在后续部署中保留——这是错的，`keep_vars` 只保留「变量 / Secrets」，**不保留资源绑定**（D1 / KV / R2 这类）。实际行为是：仓库配置里 D1 段被注释掉，等于声明「该 Worker 没有 D1」，于是每次部署都会把面板上手绑的 D1 抹掉，应用随即连不上数据库。
  - 方式 B（连接 Git）的 D1 步骤重写为三种做法，按使用习惯选：甲、直接改 `wrangler.toml` 填自己的 `database_id`（最简单，推荐）；乙、专用部署分支放独立的 `wrangler.deploy.toml`、部署命令加 `--config` 指向它（同步上游零冲突）；丙、只在面板绑定（零文件编辑，但每次部署后必须重绑）
  - 方式 C（一键按钮）补充警告：它建的是独立克隆仓库、没接 Git 自动部署，平时绑一次够用，但只要再触发一次部署（手动 merge 上游后推送、或面板点 Redeploy），面板绑定同样会被抹掉
  - 本地 CLI 部署改口径：解注释 D1 的改动「提交或不提交都可以」（此前要求务必不提交，以免污染面板绑定方案）
  - `wrangler.toml` 内的注释与 CHANGELOG 0.2.0 的相应描述一并更正

## [0.3.0] - 2026-08-04

### 修复
- **部署平台不再需要手动选择**：此前「设置 → 通用偏好 → 部署平台」的值靠前端本地存储猜测（默认 Docker），部署在 Cloudflare 上也会错显 Docker；且可任意切换、点「自动检测」只是把当前选中项原样报回。现改为由后端下发真实平台（随会话探测返回，无额外请求），前端只读展示，「自动检测」会真正重新询问后端。侧栏按平台隐藏另一平台专属功能、代理页提示、关于页升级步骤三处也随之修正
- **站点未填 Access Token 的红三角提示不再被裁切**：提示原为手写的绝对定位元素，被站点表格的横向滚动容器裁掉（首行被顶边切、靠右列被右边界切）。改用带 portal 的 tooltip 组件渲染到页面顶层，并自带边界碰撞翻转，各种位置与窄屏下均可完整显示；表格列宽拖拽与横向滚动不受影响

### 变更
- **移除「演示平台」切换器**：设置页原有的手动切换部署平台的控件已删除。平台由运行环境决定、后端下发，前端不再可改——此前的「可切换」是迁移期的演示遗留，会让界面与真实部署不一致

### 安全
- 依赖 `ip-address` 升级至 10.4.0（经 `socks` 传递引入），修复两个可绕过 SSRF / 信任边界检查的问题（GHSA-4xrf-jv44-h6hh、GHSA-22jq-vg5j-6vgg）。同时在 `package.json` 增加 `overrides` 锁定版本下界，避免后续重装依赖时回退到受影响版本。该依赖仅用于 Node / Docker 出站代理的地址解析，代理地址由用户自行配置

### 文档
- README 改为三语（English 主入口 + 简体中文 / 繁體中文）

## [0.2.0] - 2026-08-02

### 新增
- **三语国际化（i18n）**：简体中文 / 繁体中文 / English 一键切换，localStorage 持久化、首屏无语言闪烁；繁体为台湾正体 + 惯用词（opencc-js 构建期从简体自动生成，不手工维护第三份）
- **首次使用免责声明门禁**：登录后、进入主面板前弹出免责声明（封禁风险 + AI 创作声明），需勾选同意方可使用；同意状态按账号记录（服务端），每个账号仅需确认一次
- README 增加「免责声明与使用须知」章节

### 变更
- **D1 数据库改为 Cloudflare 面板绑定**：`wrangler.toml` 不再写死 `database_id`，「连接 Git」方式（方式 B）与本地部署全程无需编辑仓库文件——在面板 Bindings 下拉绑定 `DB` 即可；配合 `keep_vars = true` 保证后续部署面板绑定不丢
  > ⚠️ **后续更正**：最后半句是错的。`keep_vars` 只保留变量 / Secrets，不保留资源绑定，面板手绑的 D1 每次部署都会被抹掉。正确做法见「未发布」一节的文档纠错与 README 方式 B 的 B1。
- 一键部署按钮（方式 C）现需部署后在面板手动绑定一次 D1（README 已说明）
- GitHub Actions（方式 A）自动激活并注入 `database_id`，不依赖面板绑定

## [0.1.0] - 2026-07-30

中转站管理面板首个正式版。

### 部署
- **Cloudflare Workers + D1**：一键 Deploy 按钮 / GitHub Actions / 连接 Git 三种方式
- **Node / Docker**：Dockerfile + docker-compose（需外部反代提供 HTTPS）
- ⚠️ 生产环境必须走 HTTPS：会话 Cookie 带 Secure 标志，纯 HTTP 下无法保持登录

### 新增
- 多用户：邀请制 + 完整数据隔离 + 两级角色 + 即时吊销
- 站点管理、代理出站、测活探针、抓取设置（并发 / 超时 / 重试）
- 签到自动化、时区感知调度
- 安全：两步验证（TOTP）、Passkey / WebAuthn 无密码登录、令牌 AES-GCM 加密存储
- CSV / JSON 导出、检查更新
- Worker 首访自动引导（幂等建表 + seed 首个 admin）

[未发布]: https://github.com/buzhidao10068/Rrelaynest/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/buzhidao10068/Rrelaynest/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/buzhidao10068/Rrelaynest/releases/tag/v0.1.0
