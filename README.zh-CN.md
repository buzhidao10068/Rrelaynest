> **语言 / Language**：[English](README.md) · **简体中文** · [繁體中文](README.zh-TW.md)

# Rrelaynest

集中管理 LLM API 中转站（new-api）的自部署面板。一套代码，两种部署：

- **Docker / Node** —— 单容器，本地 SQLite 落盘，进程内定时任务。适合自有服务器。
- **Cloudflare Workers + D1** —— Serverless，全球边缘，零运维。适合无服务器托管。

功能：站点集中管理、余额/额度抓取、每日自动签到、活跃度探测、多用户（邀请制 + 完整隔离）、两步验证（TOTP）、Passkey 无密码登录。

---

## ⚠️ 免责声明与使用须知

- **封禁风险**：本项目的部分功能（如每日自动签到、余额/额度抓取、活跃度探测等）会以**自动化方式**访问上游中转站（new-api 等服务），**可能触发上游的风控策略，导致你的账号被限制或封禁**。是否启用相关功能、以及由此产生的一切后果，均由你自行评估与承担，**与本项目及其作者无关**。
- **AI 创作声明**：本项目**完全由 AI 创作**，可能存在各类错误、缺陷或考虑不周之处，**不对其正确性、稳定性或适用性作任何保证**。请在充分理解代码与风险的前提下自行使用。

> 首次登录后，面板会展示以上声明，**需勾选同意后方可进入使用**；同意状态按账号记录（服务端持久化），每个账号仅需确认一次。

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
| `SESSION_SECRET` | 会话 cookie / MFA 短票 / Passkey 挑战票的 HMAC 签名密钥 | `openssl rand -hex 32`（任意长度均可） |
| `ENCRYPTION_KEY` | 上游 API Key 等敏感字段的 AES-GCM 加密密钥 | `openssl rand -base64 32`（**必须**是 base64 编码的 32 字节：44 字符、末尾带 `=`） |

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

Serverless，平台自带 HTTPS（无需自己配反代）。有三种方式，都不需要本地终端，任选其一：

- **方式 C — 一键部署按钮（首次最省事，推荐新手）**：点下面的按钮，Cloudflare 自动帮你克隆仓库、创建 D1、引导你填三个密钥、构建部署。部署后在面板加一次 D1 绑定即可（建表由首次访问自动完成）。
- **方式 A — GitHub Actions**：密钥填在 **GitHub** 仓库，网页点 Run 部署。CI 自动注入 D1 ID 并触发建表，无需面板绑定。适合想让部署走 GitHub、自己掌控 CI 的人。
- **方式 B — Cloudflare 连接 Git**：密钥填在 **Cloudflare** 面板，推送即自动部署，连 GitHub Actions 都不用碰。**不用改仓库任何文件**，D1 在面板下拉绑定一次。

> 三种方式的建表（跑迁移 + seed 首个 admin）都由 **首次访问自动完成**——Worker 收到第一个 `/api/*` 请求时会幂等地跑一次引导，无需再手动 curl。

### 方式 C — 一键部署按钮（推荐）

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/buzhidao10068/Rrelaynest)

1. 点上面的 **Deploy to Cloudflare** 按钮，用 GitHub 账户授权登录 Cloudflare
2. 按提示**填入三个密钥**的值（`ADMIN_PASSWORD` / `SESSION_SECRET` / `ENCRYPTION_KEY`，取值见下方「通用准备第 3 步」；`ADMIN_PASSWORD` 务必改掉示例默认值）
3. 点部署（此时 Worker 已起，但还没绑 D1）
4. **绑定 D1**：先在 **Storage & Databases → D1** 创建一个数据库（名字随意，如 `rrelaynest-db`）；再到该 Worker 的 **Settings → Bindings → Add binding → D1 database**，**Variable name 填 `DB`**（必须大写、必须是 `DB`），下拉选刚建的库；保存后点 **Retry/Redeploy** 让绑定生效
5. 打开分配的 `*.workers.dev` 地址，首访自动建表 + seed admin，用 `admin` + 你填的初始密码登录，进设置页尽快改密

> **为什么方式 C 也要手动绑 D1？** 本项目的 `wrangler.toml` 默认**不声明 D1**（那段配置带 `#@d1 ` 前缀注释掉了），让三种部署方式共用同一份干净配置、fork 的人开箱不用改文件。代价是一键按钮不会自动建库并写回 ID——这一步挪到了部署后由你在面板点一下（第 4 步）。若你更想要「点完全自动、连 D1 都不用管」，用**本地 CLI 部署**（见页面末尾），它会 `wrangler d1 create` 自动建库。
>
> ⚠️ **面板绑定只在「不会再自动部署」的前提下才稳。** 方式 C 建的是独立克隆仓库、没接 Git 自动部署，所以平时绑一次就够。但**只要之后又触发了一次部署**（比如你手动 merge upstream 后推送、或在面板点 Redeploy），Cloudflare 会按仓库里那份「没有 D1」的配置覆盖，**面板上的 D1 绑定会被抹掉**，需要重新绑。若你会经常同步上游，建议改用下面方式 B 的 B1 甲/乙两种「把 D1 写进配置」的做法，一次到位。

> **升级**：方式 C 在你 GitHub 账户下建的是**独立克隆仓库（不是 Fork）**，所以**没有「Sync fork」一键同步按钮**。想拿本项目后续更新，需手动操作：给你的仓库加一个 upstream 远程（`git remote add upstream <本仓库地址>`），再 `git fetch upstream && git merge upstream/main` 并推送，Cloudflare 会自动重新构建部署。
>
> 如果你更看重**一键同步上游更新**，用**方式 A / B**（它们基于 Fork，GitHub 上有「Sync fork」按钮可一键拉取上游代码）。方式 C 胜在首次部署最省事，但后续更新反而更麻烦。

---

方式 A / B 需要先做下面的「通用准备」。方式 C 只需其中的「创建 D1 数据库」（第 2 步），Fork 与密钥准备可跳过（一键按钮会引导）。

### 通用准备（方式 A / B 都要做）

**1. Fork 本仓库**

打开本项目页面，右上角点 **Fork**，Fork 到你自己的 GitHub 账户。后续所有操作都在你 Fork 的仓库里进行。

**2. 创建 D1 数据库**

1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com/)，左侧 **Storage & Databases → D1 SQL Database → Create**
2. 数据库名填 `rrelaynest-db`，创建后进入详情页，**记录 Database ID**

**3. 准备三个密钥的值**

| 密钥 | 说明 | 取值 |
| --- | --- | --- |
| `ADMIN_PASSWORD` | 首个 admin 的**初始**登录密码（用户名固定 `admin`） | 自定义强口令 |
| `SESSION_SECRET` | 会话 cookie / MFA 短票 / Passkey 挑战票的 HMAC 签名密钥 | 任意长度的随机串（32 字节十六进制串即可） |
| `ENCRYPTION_KEY` | 上游 API Key 等敏感字段的 AES-GCM 加密密钥 | **base64 编码的 32 字节** —— 44 字符、末尾带 `=` |

> 两者**格式要求不同**，请分别生成：
>
> ```bash
> openssl rand -hex 32      # SESSION_SECRET —— 任意长度均可
> openssl rand -base64 32   # ENCRYPTION_KEY —— 必须正好解码出 32 字节
> ```
>
> 没有终端也行：`ENCRYPTION_KEY` 用任意「随机 base64 / 32 字节」在线生成器，`SESSION_SECRET` 用任意随机串即可。`ENCRYPTION_KEY` 可自检：形如 `ifgL8RczRrNJ03tJ93+jC2w10S78/OIHhyR7bqEVYH8=`，**44 字符、末尾带 `=`**。64 位十六进制串是**错的**（它解码出 48 字节而非 32），填了之后保存带 Access Token 的站点会失败。两者的值务必不同。

---

### 方式 A — GitHub Actions

**A1. 再获取 API Token 和 Account ID**

1. Cloudflare 控制台右上角头像 → **My Profile → API Tokens**
2. 点 **Create Token**，选 **Edit Cloudflare Workers** 模板，创建后**记录生成的 Token**（只显示一次）
3. 回到控制台首页，右侧栏可见 **Account ID**，**记录下来**

**A2. 配置 GitHub Secrets**

在你 Fork 的仓库：**Settings → Secrets and variables → Actions → New repository secret**，逐个添加 6 个：

| Secret 名称 | 取值 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | A1 记录的 Token |
| `CLOUDFLARE_ACCOUNT_ID` | A1 记录的 Account ID |
| `D1_DATABASE_ID` | 通用准备第 2 步记录的 Database ID |
| `ADMIN_PASSWORD` | 通用准备第 3 步的强口令 |
| `SESSION_SECRET` | 通用准备第 3 步的随机串 |
| `ENCRYPTION_KEY` | 通用准备第 3 步的随机串 |

**A3. 运行部署**

在你 Fork 的仓库：**Actions** 页 →（若提示先启用 Actions 就点启用）→ 左侧选 **部署到 Cloudflare Workers** → 右侧 **Run workflow** → 选 `main` 分支 → **Run workflow**。

工作流会自动：构建前端 → 注入 D1 ID 与三个密钥 → 部署 Worker → **调一次 `/api/admin/bootstrap` 完成建表 + seed 首个 admin**（幂等，重复运行不会重复 seed）。

跑完后展开最后一步日志，能看到访问地址（形如 `https://rrelaynest.<你的子域>.workers.dev`）。用 `admin` + 初始密码登录，进设置页尽快改密。

> 建表首次访问就会自动完成（三种方式通用），工作流里那步 bootstrap 只是让 CI 日志能直接看到引导结果，冗余但无害。

**A4. 升级**：这条工作流**只手动触发**（不会因为推代码或同步就自动跑）。升级步骤：在 Fork 仓库点 **Sync fork** 同步上游 → ⚠️ **然后必须回 Actions 页手动点一次 Run workflow**，部署才会真正更新。（光点 Sync fork 不会自动部署——网页同步是快进合并，不产生触发工作流的 push 事件。）新增迁移会在部署后的 bootstrap 调用中幂等应用。

---

### 方式 B — Cloudflare 连接 Git（密钥填在 Cloudflare）

这条路是 Cloudflare 直接拉你的仓库、读仓库里的配置跑 `wrangler deploy`，**不经过 GitHub Actions**。每次 push 到生产分支就自动重新部署。你需要做三件事：**让 D1 生效**（B1，三种做法选一）、**配置三个密钥**（B3）、其余交给首次访问自动建表（B5）。

**B1. 让 D1 绑定生效（三种做法，选一种）**

> ⚠️ **先理解这里的坑，否则会反复踩：** 方式 B 每次部署都以**仓库里的配置文件**为准。而本仓库的 `wrangler.toml` 默认把 D1 段注释掉了（每行带 `#@d1 ` 前缀，为的是让 fork 的人开箱不用改文件），这等于告诉 Cloudflare「这个 Worker 没有 D1 绑定」——于是**你在面板里手动加的 D1，每次自动部署都会被抹掉**。
>
> 文件顶部的 `keep_vars = true` **救不了这个**：它只保留「变量 / Secrets」，**不保留资源绑定**（D1 / KV / R2 这类）。所以想让 D1 稳定存在，得让配置文件里真的有它。

下面三种做法效果不同，按你的使用习惯选：

---

**甲、改 `wrangler.toml`（最简单，推荐大多数人）**

在你 Fork 的仓库里编辑 `wrangler.toml`：把 D1 那 4 行的 `#@d1 ` 前缀去掉，并把 `database_id` 换成你自己的（在面板 **Storage & Databases → D1 → 点开你的库**，页面上的 **Database ID**，形如 `b48ad7cc-1e14-4fe7-a6aa-798485bfa0fc`）：

```toml
[[d1_databases]]
binding = "DB"                        # 必须是大写 DB，与代码里的 env.DB 一致
database_name = "rrelaynest-db"
database_id = "换成你自己的 Database ID"
```

提交推送即可，面板的构建配置不用改。

- ✅ 步骤最少、最好懂，一次到位不会再掉
- ⚠️ 以后点 **Sync fork** 同步上游时，这一行可能和上游冲突（上游那行是占位符）。冲突时保留你自己的版本即可

---

**乙、专用部署分支 + 独立配置（避开 Sync fork 冲突）**

适合会频繁同步上游的人。思路是让 `wrangler.toml` 跟上游**永远保持一致**（所以永不冲突），把你的 `database_id` 放进一个**只存在于你部署分支**的独立文件里。

1. 从主分支拉一条部署分支，例如 `deploy/cloudflare`
2. 在该分支上新建 `wrangler.deploy.toml`：内容复制 `wrangler.toml`，但把 D1 段解注释并填上你的真实 `database_id`（其余保持一致）
3. 只在这条分支上提交这个文件（主分支不要有它）
4. 面板 **Settings → Build（构建配置）** 改两处：
   - **生产分支** → `deploy/cloudflare`
   - **部署命令** → `npx wrangler deploy --config wrangler.deploy.toml`
   - 构建命令保持 `npm run build`、非生产分支部署命令保持默认即可
5. 以后要部署：把主分支合进部署分支再推送
   ```bash
   git checkout deploy/cloudflare
   git merge main        # wrangler.toml 两边一致，不会冲突
   git push
   ```

- ✅ 同步上游零冲突；你的 ID 不出现在主分支上
- ⚠️ 步骤多一些，需要理解分支操作

---

**丙、只在面板绑定（零文件编辑，但每次部署后要重绑）**

完全不动仓库文件，只在面板 **Settings → Bindings → Add binding → D1 database** 绑一次（Variable name 填 `DB`，大写）。

- ✅ 不用碰任何文件，首次上手最快
- ❌ **每次自动部署后绑定都会消失，必须再去面板绑一次**；而且在你重绑之前，应用是连不上数据库的（页面会报错）。方式 B 是 push 就自动部署，所以这个代价会反复出现
- 只建议在「先跑起来看看效果」的试用阶段用；打算长期用请选甲或乙

> `database_id` 不是密钥，提交进公开仓库没有安全问题——光有 ID 没有你的 API Token 访问不了数据。

**B2. 在 Cloudflare 导入仓库**

1. Cloudflare 控制台 **Workers & Pages → Create → 选 Import a repository** 旁的 **Get started**
2. 授权并选中你 Fork 的仓库
3. 构建配置：
   - **Build command** 填 `npm run build`
   - **Deploy command** 保持默认 `npx wrangler deploy`
   - Worker 名建议保持 `rrelaynest`（**必须与 `wrangler.toml` 里的 `name` 一致**，否则构建失败）

**B3. 配置运行时密钥**

在该 Worker 的 **Settings → Variables and Secrets** 里，添加三个 **Secret 类型**变量（不是 build 变量，build 变量运行时读不到）：`ADMIN_PASSWORD`、`SESSION_SECRET`、`ENCRYPTION_KEY`，值取自通用准备第 3 步。

> 若在 B2 已点 Save and Deploy 部署过一次，配置完密钥后需再触发一次部署让密钥生效（改仓库推一下，或在面板点 Retry/Redeploy）。

**B4. 确认 D1 已生效**

D1 的处理在 **B1** 就做完了（甲/乙写进配置文件，丙在面板绑定），这一步只是确认：

- 部署完成后到该 Worker 的 **Settings → Bindings**，应能看到一条 D1 绑定，**Variable name 是 `DB`**（必须大写、必须是 `DB`，与代码里的 `env.DB` 一致；名字不对运行时会报 D1 未绑定）
- 若走的是 B1 甲/乙，这条绑定由配置文件生成，之后每次部署都在，不用管
- 若走的是 B1 丙，**每次部署后都要回来检查并重绑**（这就是丙的代价）

> 如果绑定在但应用仍报数据库错误，先确认 Variable name 是大写 `DB` 而不是 `db` 或别的名字。

**B5. 首次访问，完成建表 + seed admin**

部署完成后 D1 还是空库，但**无需手动做任何事**：用浏览器打开一次 Worker 地址（形如 `https://rrelaynest.<你的子域>.workers.dev`），首个请求会自动建表 + seed 首个 admin（幂等）。稍等一两秒刷新，即可用 `admin` + 初始密码登录，进设置页尽快改密。

> 若想显式确认，也可调引导端点（带 `Authorization` Header 的 POST，浏览器地址栏访问不了，用 Postman / Hoppscotch 或 curl）：
> ```bash
> curl -X POST https://你的-worker-域名/api/admin/bootstrap \
>   -H "Authorization: Bearer 你设的_ADMIN_PASSWORD"
> ```
> 成功返回 `{"ok":true,...}`，`alreadyInitialized:true` 表示首次访问已引导过。

**B6. 升级**：在 Fork 仓库点 **Sync fork** 同步上游并推到生产分支，Cloudflare 会自动重新构建部署。新增迁移会在下一次访问时自动应用（幂等）。

D1 绑定在升级时是否需要重新处理，取决于 B1 选了哪种：

| B1 做法 | 升级后 D1 |
|---|---|
| 甲（改 `wrangler.toml`） | 不用管。但 Sync fork 时那一行可能冲突，保留你自己的版本 |
| 乙（部署分支 + 独立配置） | 不用管，也不会冲突。记得把主分支合进部署分支再推 |
| 丙（只在面板绑定） | **每次都要重新绑一遍**，重绑前应用连不上数据库 |

---

> **想用本地 CLI 部署？** 也支持：`npx wrangler d1 create rrelaynest-db` 拿到 ID → 打开 `wrangler.toml` 把 D1 段每行开头的 `#@d1 ` 删掉（取消注释），并把占位符换成你的真实 ID → `npx wrangler secret put` 设三个密钥 → `npm run deploy` → 浏览器访问一次自动建表。
>
> 这个改动**提交或不提交都可以**：不提交就只在本地生效（每台机器各自改一次）；提交了就等于 B1 甲，以后 CLI、面板连 Git 都能用，代价是 Sync fork 时那行可能冲突。方式 A 的 GitHub Actions 本质就是把「取消注释 + 填 ID」这套搬到了云端（用仓库 Secret 存 ID）。

---

## 本地开发

```bash
npm ci
npm run dev            # 前端 (Vite)

# 另开一个终端，起 Node 后端：
export ADMIN_PASSWORD=dev-admin
export SESSION_SECRET=$(openssl rand -hex 32)
export ENCRYPTION_KEY=$(openssl rand -base64 32)   # 必须是 base64 的 32 字节，不是 hex
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

---

## 许可证

[MIT](LICENSE)。可自由使用、修改、商用与二次分发，保留版权与许可声明即可。
