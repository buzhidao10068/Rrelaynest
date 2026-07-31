# 更新日志（Changelog）

本项目所有值得记录的变更都写在这里。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

每次发布新版时：先在这里新增一节，再 bump `package.json` 的 `version`，
并在 GitHub 打上对应的 `vX.Y.Z` tag 发 Release——应用内的「检查更新」据此判断新版。

## [未发布]

### 新增
- **首次使用免责声明门禁**：登录后、进入主面板前弹出免责声明（封禁风险 + AI 创作声明），需勾选同意方可使用；同意状态按账号记录（服务端），每个账号仅需确认一次
- README 增加「免责声明与使用须知」章节

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

[未发布]: https://github.com/buzhidao10068/Rrelaynest/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/buzhidao10068/Rrelaynest/releases/tag/v0.1.0
