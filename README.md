# Rrelaynest

集中管理 LLM API 中转站（new-api）的自部署面板。一套代码，两种部署：

- **Docker / Node** —— 单容器，本地 SQLite 落盘，进程内定时任务。适合自有服务器。
- **Cloudflare Workers + D1** —— Serverless，全球边缘，零运维。适合无服务器托管。

功能：站点集中管理、余额/额度抓取、每日自动签到、活跃度探测、多用户（邀请制 + 完整隔离）、两步验证（TOTP）、Passkey 无密码登录。

---

## ⚠️ 安全前提：生产必须 HTTPS

会话与登录态用带 **`Secure` 标记**的 cookie 承载，浏览器**只在 HTTPS（或 `http://localhost`）下才会回传它**。

这意味着：直接用 `http://你的域名` 或 `http://内网IP` 暴露本服务，会出现「**登录成功、下一次请求却又变未登录**」的现象——因为 cookie 根本没被浏览器发回来。

**所以：**

- ✅ `https://你的域名` —— 正常
- ✅ `http://localhost:3100` —— 正常（仅本机调试，浏览器对 localhost 有安全豁免）
- ❌ `http://你的域名` / `http://内网IP` —— **登录必然失效，不要这样部署**

应用本身（Node 入口）只监听明文端口、不做 TLS。**生产环境请把它放到反向代理之后，由反代终结 HTTPS。** Workers 部署由平台自带 HTTPS，无需额外处理。

Nginx 反代示例：

```nginx
server {
    listen 443 ssl;
    server_name relay.example.com;

    ssl_certificate     /etc/letsencrypt/live/relay.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/relay.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    }
}
```

用 Caddy 更省事（自动签发 Let's Encrypt 证书），一个 `Caddyfile`：

```
relay.example.com {
    reverse_proxy 127.0.0.1:3100
}
```

Cloudflare Tunnel 亦可，同样能免公网端口地提供 HTTPS 入口。

---

## 部署一：Docker

### 1. 准备密钥

```bash
cp .env.example .env
```

编辑 `.env`，填入三个必需值（缺任一则容器启动即报错退出）：

| 变量 | 用途 | 生成方式 |
| --- | --- | --- |
| `ADMIN_PASSWORD` | 首个 admin 的**初始**登录密码（用户名固定 `admin`） | 自定义强口令 |
| `SESSION_SECRET` | 会话 cookie / MFA 短票 / Passkey 挑战票的 HMAC 签名密钥 | `openssl rand -hex 32` |
| `ENCRYPTION_KEY` | 上游 API Key 等敏感字段的 AES-GCM 加密密钥 | `openssl rand -hex 32` |

> `ADMIN_PASSWORD` **只在首次启动、库为空时**用于 seed 首个 admin。之后在设置页改密，此变量便不再影响登录——可以留着，也可以清空。

### 2. 启动

```bash
docker compose up -d --build
```

首次启动会自动：建表（跑全部迁移）→ seed 首个 admin（用户名 `admin`，密码 = `ADMIN_PASSWORD`）→ 回填存量数据。全部**幂等**，重复启动不会重复 seed。

sqlite 文件落在宿主的 `./data/`（compose 已挂 volume），删容器不丢数据。

### 3. 访问

服务监听 `3100`。**务必置于 HTTPS 反代之后**（见上文安全前提），然后用 `admin` + 你设的初始密码登录，进设置页尽快改密。

### 4. 升级

```bash
git pull
docker compose up -d --build
```

启动时自动应用新增迁移（幂等，不会动既有数据）。

### 5. 新增用户

本面板**邀请制**：首个 admin 登录后，在「管理 → 用户」里生成邀请，把邀请链接发给对方注册。用户之间数据完全隔离，admin 可只读查看。

---

## 部署二：Cloudflare Workers + D1

Serverless，平台自带 HTTPS（无需自己配反代）。全程在浏览器里点几下即可，**不需要本地终端**——Fork 项目 → 填几个密钥 → 网页点运行。

### 1. Fork 本仓库

打开本项目页面，右上角点 **Fork**，Fork 到你自己的 GitHub 账户。后续所有操作都在你 Fork 的仓库里进行。

### 2. 准备 Cloudflare 资源

**2.1 获取 API Token 和 Account ID**

1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com/)，右上角头像 → **My Profile → API Tokens**
2. 点 **Create Token**，选 **Edit Cloudflare Workers** 模板，创建后**记录生成的 Token**（只显示一次）
3. 回到控制台首页，右侧栏可见 **Account ID**，**记录下来**

**2.2 创建 D1 数据库**

1. 控制台左侧 **Storage & Databases → D1 SQL Database → Create**
2. 数据库名填 `rrelaynest-db`，创建后进入详情页，**记录 Database ID**

> 建表和初始化不用手动做——部署工作流会在首次运行时自动完成（见第 4 步）。

### 3. 配置 GitHub Secrets

在你 Fork 的仓库：**Settings → Secrets and variables → Actions → New repository secret**，逐个添加：

| Secret 名称 | 说明 | 取值 |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token | 第 2.1 步记录的 Token |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账户 ID | 第 2.1 步记录的 Account ID |
| `D1_DATABASE_ID` | D1 数据库 ID | 第 2.2 步记录的 Database ID |
| `ADMIN_PASSWORD` | 首个 admin 的**初始**登录密码（用户名固定 `admin`） | 自定义强口令 |
| `SESSION_SECRET` | 会话 cookie / MFA 短票 / Passkey 挑战票的 HMAC 签名密钥 | 随机 32 字节十六进制串 |
| `ENCRYPTION_KEY` | 上游 API Key 等敏感字段的 AES-GCM 加密密钥 | 随机 32 字节十六进制串 |

> `SESSION_SECRET` / `ENCRYPTION_KEY` 需要随机值。本地有终端的话用 `openssl rand -hex 32` 生成；没有也行，用任意在线随机十六进制生成器出两串 64 位十六进制即可。两者务必不同。

### 4. 运行部署

在你 Fork 的仓库：**Actions** 页 →（若提示先启用 Actions 就点启用）→ 左侧选 **部署到 Cloudflare Workers** → 右侧 **Run workflow** → 选 `main` 分支 → **Run workflow**。

工作流会自动：构建前端 → 注入 D1 ID 与三个密钥 → 部署 Worker → **调一次 `/api/admin/bootstrap` 完成建表 + seed 首个 admin**（幂等，重复运行不会重复 seed）。

跑完后展开最后一步日志，能看到访问地址（形如 `https://rrelaynest.<你的子域>.workers.dev`）。用 `admin` + 你设的初始密码登录，进设置页尽快改密。

### 5. 升级

在你 Fork 的仓库同步上游改动（GitHub 页面的 **Sync fork**），推到 `main` 会自动触发重新部署；也可以随时回 **Actions** 手动 **Run workflow**。新增迁移会在部署后的 bootstrap 调用中幂等应用。

> **想用本地 CLI 部署？** 也支持：`npx wrangler d1 create rrelaynest-db` 拿到 ID 填进 `wrangler.toml` → `npx wrangler secret put` 设三个密钥 → `npm run deploy` → `curl -X POST https://你的域名/api/admin/bootstrap -H "Authorization: Bearer 你的_ADMIN_PASSWORD"`。上面的 GitHub Actions 流程本质就是把这套搬到了云端。

---

## 本地开发

```bash
npm ci
npm run dev            # 前端 (Vite)

# 另开一个终端，起 Node 后端：
export ADMIN_PASSWORD=dev-admin
export SESSION_SECRET=$(openssl rand -hex 32)
export ENCRYPTION_KEY=$(openssl rand -hex 32)
npm run build:server && npm run start:node   # http://localhost:3100

# 或 Workers 本地：
npm run dev:worker     # http://localhost:7738
```

测试与类型检查：

```bash
npm test               # vitest
npm run typecheck      # tsc（客户端 + 服务端两套配置）
```

---

## 环境变量一览

| 变量 | 必需 | 默认 | 说明 |
| --- | --- | --- | --- |
| `ADMIN_PASSWORD` | 是 | —— | 首个 admin 初始密码 / Workers 引导令牌 |
| `SESSION_SECRET` | 是 | —— | 会话签名密钥 |
| `ENCRYPTION_KEY` | 是 | —— | 敏感字段加密密钥 |
| `PORT` | 否 | `3100` | Node 监听端口 |
| `DB_PATH` | 否 | `data/rrelaynest.sqlite` | Node SQLite 文件路径 |
| `DIST_DIR` | 否 | `dist` | Node 前端静态资源目录 |

> Node 部署需 **Node 22+**（依赖内置 `node:sqlite`）。Docker 镜像已锁 Node 24。
