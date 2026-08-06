> **語言 / Language**：[English](README.md) · [简体中文](README.zh-CN.md) · **繁體中文**

# Rrelaynest

集中管理 LLM API 中轉站（new-api）的自部署面板。一套程式碼，兩種部署：

- **Docker / Node** —— 單容器，本地 SQLite 落盤，程式內定時任務。適合自有伺服器。
- **Cloudflare Workers + D1** —— Serverless，全球邊緣，零運維。適合無伺服器託管。

功能：站點集中管理、餘額/額度抓取、每日自動簽到、活躍度探測、多使用者（邀請制 + 完整隔離）、兩步驗證（TOTP）、Passkey 無密碼登入。

---

## ⚠️ 免責宣告與使用須知

- **封禁風險**：本專案的部分功能（如每日自動簽到、餘額/額度抓取、活躍度探測等）會以**自動化方式**訪問上游中轉站（new-api 等服務），**可能觸發上游的風控策略，導致你的帳號被限制或封禁**。是否啟用相關功能、以及由此產生的一切後果，均由你自行評估與承擔，**與本專案及其作者無關**。
- **AI 創作宣告**：本專案**完全由 AI 創作**，可能存在各類錯誤、缺陷或考慮不周之處，**不對其正確性、穩定性或適用性作任何保證**。請在充分理解程式碼與風險的前提下自行使用。

> 首次登入後，面板會展示以上宣告，**需勾選同意後方可進入使用**；同意狀態按帳號記錄（服務端持久化），每個帳號僅需確認一次。

---

## ⚠️ 安全前提：生產必須 HTTPS

會話與登入態用帶 **`Secure` 標記**的 cookie 承載，瀏覽器**只在 HTTPS（或 `http://localhost`）下才會回傳它**。

這意味著：直接用 `http://你的域名` 或 `http://內網IP` 暴露本服務，會出現「**登入成功、下一次請求卻又變未登入**」的現象——因為 cookie 根本沒被瀏覽器發回來。

**所以：**

- ✅ `https://你的域名` —— 正常
- ✅ `http://localhost:3100` —— 正常（僅本機除錯，瀏覽器對 localhost 有安全豁免）
- ❌ `http://你的域名` / `http://內網IP` —— **登入必然失效，不要這樣部署**

應用本身（Node 入口）只監聽明文埠、不做 TLS。**生產環境請把它放到反向代理之後，由反代終結 HTTPS。** Workers 部署由平臺自帶 HTTPS，無需額外處理。

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

用 Caddy 更省事（自動簽發 Let's Encrypt 證書），一個 `Caddyfile`：

```
relay.example.com {
    reverse_proxy 127.0.0.1:3100
}
```

Cloudflare Tunnel 亦可，同樣能免公網埠地提供 HTTPS 入口。

---

## 部署一：Docker

### 1. 準備金鑰

```bash
cp .env.example .env
```

編輯 `.env`，填入三個必需值（缺任一則容器啟動即報錯退出）：

| 變數 | 用途 | 生成方式 |
| --- | --- | --- |
| `ADMIN_PASSWORD` | 首個 admin 的**初始**登入密碼（使用者名稱固定 `admin`） | 自定義強口令 |
| `SESSION_SECRET` | 會話 cookie / MFA 短票 / Passkey 挑戰票的 HMAC 簽名金鑰 | `openssl rand -hex 32`（任意長度均可） |
| `ENCRYPTION_KEY` | 上游 API Key 等敏感欄位的 AES-GCM 加密金鑰 | `openssl rand -base64 32`（**必須**是 base64 編碼的 32 位元組：44 字元、末尾帶 `=`） |

> `ADMIN_PASSWORD` **只在首次啟動、庫為空時**用於 seed 首個 admin。之後在設定頁改密，此變數便不再影響登入——可以留著，也可以清空。

### 2. 啟動

```bash
docker compose up -d --build
```

首次啟動會自動：建表（跑全部遷移）→ seed 首個 admin（使用者名稱 `admin`，密碼 = `ADMIN_PASSWORD`）→ 回填存量資料。全部**冪等**，重複啟動不會重複 seed。

sqlite 檔案落在宿主的 `./data/`（compose 已掛 volume），刪容器不丟資料。

### 3. 訪問

服務監聽 `3100`。**務必置於 HTTPS 反代之後**（見上文安全前提），然後用 `admin` + 你設的初始密碼登入，進設定頁儘快改密。

### 4. 升級

```bash
git pull
docker compose up -d --build
```

啟動時自動應用新增遷移（冪等，不會動既有資料）。

### 5. 新增使用者

本面板**邀請制**：首個 admin 登入後，在「管理 → 使用者」裡生成邀請，把邀請連結發給對方註冊。使用者之間資料完全隔離，admin 可只讀檢視。

---

## 部署二：Cloudflare Workers + D1

Serverless，平臺自帶 HTTPS（無需自己配反代）。有三種方式，都不需要本地終端，任選其一：

- **方式 C — 一鍵部署按鈕（首次最省事，推薦新手）**：點下面的按鈕，Cloudflare 自動幫你克隆倉庫、建立 D1、引導你填三個金鑰、構建部署。部署後在面板加一次 D1 繫結即可（建表由首次訪問自動完成）。
- **方式 A — GitHub Actions**：金鑰填在 **GitHub** 倉庫，網頁點 Run 部署。CI 自動注入 D1 ID 並觸發建表，無需面板繫結。適合想讓部署走 GitHub、自己掌控 CI 的人。
- **方式 B — Cloudflare 連線 Git**：金鑰填在 **Cloudflare** 面板，推送即自動部署，連 GitHub Actions 都不用碰。**不用改倉庫任何檔案**，D1 在面板下拉繫結一次。

> 三種方式的建表（跑遷移 + seed 首個 admin）都由 **首次訪問自動完成**——Worker 收到第一個 `/api/*` 請求時會冪等地跑一次引導，無需再手動 curl。

### 方式 C — 一鍵部署按鈕（推薦）

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/buzhidao10068/Rrelaynest)

1. 點上面的 **Deploy to Cloudflare** 按鈕，用 GitHub 帳戶授權登入 Cloudflare
2. 按提示**填入三個金鑰**的值（`ADMIN_PASSWORD` / `SESSION_SECRET` / `ENCRYPTION_KEY`，取值見下方「通用準備第 3 步」；`ADMIN_PASSWORD` 務必改掉示例預設值）
3. 點部署（此時 Worker 已起，但還沒綁 D1）
4. **繫結 D1**：先在 **Storage & Databases → D1** 建立一個資料庫（名字隨意，如 `rrelaynest-db`）；再到該 Worker 的 **Settings → Bindings → Add binding → D1 database**，**Variable name 填 `DB`**（必須大寫、必須是 `DB`），下拉選剛建的庫；儲存後點 **Retry/Redeploy** 讓繫結生效
5. 開啟分配的 `*.workers.dev` 地址，首訪自動建表 + seed admin，用 `admin` + 你填的初始密碼登入，進設定頁儘快改密

> **為什麼方式 C 也要手動綁 D1？** 本專案的 `wrangler.toml` 預設**不宣告 D1**（那段配置帶 `#@d1 ` 前綴註釋掉了），讓三種部署方式共用同一份乾淨配置、fork 的人開箱不用改檔案。代價是一鍵按鈕不會自動建庫並寫回 ID——這一步挪到了部署後由你在面板點一下（第 4 步）。若你更想要「點完全自動、連 D1 都不用管」，用**本地 CLI 部署**（見頁面末尾），它會 `wrangler d1 create` 自動建庫。
>
> ⚠️ **面板繫結只在「不會再自動部署」的前提下才穩。** 方式 C 建的是獨立克隆倉庫、沒接 Git 自動部署，所以平時綁一次就夠。但**只要之後又觸發了一次部署**（比如你手動 merge upstream 後推送、或在面板點 Redeploy），Cloudflare 會按倉庫裡那份「沒有 D1」的配置覆蓋，**面板上的 D1 繫結會被抹掉**，需要重新綁。若你會經常同步上游，建議改用下面方式 B 的 B1 甲/乙兩種「把 D1 寫進配置」的做法，一次到位。

> **升級**：方式 C 在你 GitHub 帳戶下建的是**獨立克隆倉庫（不是 Fork）**，所以**沒有「Sync fork」一鍵同步按鈕**。想拿本專案後續更新，需手動操作：給你的倉庫加一個 upstream 遠端（`git remote add upstream <本倉庫地址>`），再 `git fetch upstream && git merge upstream/main` 並推送，Cloudflare 會自動重新構建部署。
>
> 如果你更看重**一鍵同步上游更新**，用**方式 A / B**（它們基於 Fork，GitHub 上有「Sync fork」按鈕可一鍵拉取上游程式碼）。方式 C 勝在首次部署最省事，但後續更新反而更麻煩。

---

方式 A / B 需要先做下面的「通用準備」。方式 C 只需其中的「建立 D1 資料庫」（第 2 步），Fork 與金鑰準備可跳過（一鍵按鈕會引導）。

### 通用準備（方式 A / B 都要做）

**1. Fork 本倉庫**

開啟本專案頁面，右上角點 **Fork**，Fork 到你自己的 GitHub 帳戶。後續所有操作都在你 Fork 的倉庫裡進行。

**2. 建立 D1 資料庫**

1. 登入 [Cloudflare 控制台](https://dash.cloudflare.com/)，左側 **Storage & Databases → D1 SQL Database → Create**
2. 資料庫名填 `rrelaynest-db`，建立後進入詳情頁，**記錄 Database ID**

**3. 準備三個金鑰的值**

| 金鑰 | 說明 | 取值 |
| --- | --- | --- |
| `ADMIN_PASSWORD` | 首個 admin 的**初始**登入密碼（使用者名稱固定 `admin`） | 自定義強口令 |
| `SESSION_SECRET` | 會話 cookie / MFA 短票 / Passkey 挑戰票的 HMAC 簽名金鑰 | 任意長度的隨機串（32 位元組十六進位制串即可） |
| `ENCRYPTION_KEY` | 上游 API Key 等敏感欄位的 AES-GCM 加密金鑰 | **base64 編碼的 32 位元組** —— 44 字元、末尾帶 `=` |

> 兩者**格式要求不同**，請分別生成：
>
> ```bash
> openssl rand -hex 32      # SESSION_SECRET —— 任意長度均可
> openssl rand -base64 32   # ENCRYPTION_KEY —— 必須正好解碼出 32 位元組
> ```
>
> 沒有終端也行：`ENCRYPTION_KEY` 用任意「隨機 base64 / 32 位元組」線上生成器，`SESSION_SECRET` 用任意隨機串即可。`ENCRYPTION_KEY` 可自檢：形如 `ifgL8RczRrNJ03tJ93+jC2w10S78/OIHhyR7bqEVYH8=`，**44 字元、末尾帶 `=`**。64 位十六進位制串是**錯的**（它解碼出 48 位元組而非 32），填了之後儲存帶 Access Token 的站點會失敗。兩者的值務必不同。

---

### 方式 A — GitHub Actions

**A1. 再獲取 API Token 和 Account ID**

1. Cloudflare 控制台右上角頭像 → **My Profile → API Tokens**
2. 點 **Create Token**，選 **Edit Cloudflare Workers** 模板，建立後**記錄生成的 Token**（只顯示一次）
3. 回到控制台首頁，右側欄可見 **Account ID**，**記錄下來**

**A2. 配置 GitHub Secrets**

在你 Fork 的倉庫：**Settings → Secrets and variables → Actions → New repository secret**，逐個新增 6 個：

| Secret 名稱 | 取值 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | A1 記錄的 Token |
| `CLOUDFLARE_ACCOUNT_ID` | A1 記錄的 Account ID |
| `D1_DATABASE_ID` | 通用準備第 2 步記錄的 Database ID |
| `ADMIN_PASSWORD` | 通用準備第 3 步的強口令 |
| `SESSION_SECRET` | 通用準備第 3 步的隨機串 |
| `ENCRYPTION_KEY` | 通用準備第 3 步的隨機串 |

**A3. 執行部署**

在你 Fork 的倉庫：**Actions** 頁 →（若提示先啟用 Actions 就點啟用）→ 左側選 **部署到 Cloudflare Workers** → 右側 **Run workflow** → 選 `main` 分支 → **Run workflow**。

工作流會自動：構建前端 → 注入 D1 ID 與三個金鑰 → 部署 Worker → **調一次 `/api/admin/bootstrap` 完成建表 + seed 首個 admin**（冪等，重複執行不會重複 seed）。

跑完後展開最後一步日誌，能看到訪問地址（形如 `https://rrelaynest.<你的子域>.workers.dev`）。用 `admin` + 初始密碼登入，進設定頁儘快改密。

> 建表首次訪問就會自動完成（三種方式通用），工作流裡那步 bootstrap 只是讓 CI 日誌能直接看到引導結果，冗餘但無害。

**A4. 升級**：這條工作流**隻手動觸發**（不會因為推程式碼或同步就自動跑）。升級步驟：在 Fork 倉庫點 **Sync fork** 同步上游 → ⚠️ **然後必須回 Actions 頁手動點一次 Run workflow**，部署才會真正更新。（光點 Sync fork 不會自動部署——網頁同步是快進合併，不產生觸發工作流的 push 事件。）新增遷移會在部署後的 bootstrap 呼叫中冪等應用。

---

### 方式 B — Cloudflare 連線 Git（金鑰填在 Cloudflare）

這條路是 Cloudflare 直接拉你的倉庫、讀倉庫裡的配置跑 `wrangler deploy`，**不經過 GitHub Actions**。每次 push 到生產分支就自動重新部署。你需要做三件事：**讓 D1 生效**（B1，三種做法選一）、**配置三個金鑰**（B3）、其餘交給首次訪問自動建表（B5）。

**B1. 讓 D1 繫結生效（三種做法，選一種）**

> ⚠️ **先理解這裡的坑，否則會反覆踩：** 方式 B 每次部署都以**倉庫裡的配置檔案**為準。而本倉庫的 `wrangler.toml` 預設把 D1 段註釋掉了（每行帶 `#@d1 ` 前綴，為的是讓 fork 的人開箱不用改檔案），這等於告訴 Cloudflare「這個 Worker 沒有 D1 繫結」——於是**你在面板裡手動加的 D1，每次自動部署都會被抹掉**。
>
> 檔案頂部的 `keep_vars = true` **救不了這個**：它只保留「變數 / Secrets」，**不保留資源繫結**（D1 / KV / R2 這類）。所以想讓 D1 穩定存在，得讓配置檔案裡真的有它。

下面三種做法效果不同，按你的使用習慣選：

---

**甲、改 `wrangler.toml`（最簡單，推薦大多數人）**

在你 Fork 的倉庫裡編輯 `wrangler.toml`：把 D1 那 4 行的 `#@d1 ` 前綴去掉，並把 `database_id` 換成你自己的（在面板 **Storage & Databases → D1 → 點開你的庫**，頁面上的 **Database ID**，形如 `b48ad7cc-1e14-4fe7-a6aa-798485bfa0fc`）：

```toml
[[d1_databases]]
binding = "DB"                        # 必須是大寫 DB，與程式碼裡的 env.DB 一致
database_name = "rrelaynest-db"
database_id = "換成你自己的 Database ID"
```

提交推送即可，面板的構建配置不用改。

- ✅ 步驟最少、最好懂，一次到位不會再掉
- ⚠️ 以後點 **Sync fork** 同步上游時，這一行可能和上游衝突（上游那行是佔位符）。衝突時保留你自己的版本即可

---

**乙、專用部署分支 + 獨立配置（避開 Sync fork 衝突）**

適合會頻繁同步上游的人。思路是讓 `wrangler.toml` 跟上游**永遠保持一致**（所以永不衝突），把你的 `database_id` 放進一個**只存在於你部署分支**的獨立檔案裡。

1. 從主分支拉一條部署分支，例如 `deploy/cloudflare`
2. 在該分支上新建 `wrangler.deploy.toml`：內容複製 `wrangler.toml`，但把 D1 段解註釋並填上你的真實 `database_id`（其餘保持一致）
3. 只在這條分支上提交這個檔案（主分支不要有它）
4. 面板 **Settings → Build（構建配置）** 改兩處：
   - **生產分支** → `deploy/cloudflare`
   - **部署命令** → `npx wrangler deploy --config wrangler.deploy.toml`
   - 構建命令保持 `npm run build`、非生產分支部署命令保持預設即可
5. 以後要部署：把主分支合進部署分支再推送
   ```bash
   git checkout deploy/cloudflare
   git merge main        # wrangler.toml 兩邊一致，不會衝突
   git push
   ```

- ✅ 同步上游零衝突；你的 ID 不出現在主分支上
- ⚠️ 步驟多一些，需要理解分支操作

---

**丙、只在面板繫結（零檔案編輯，但每次部署後要重綁）**

完全不動倉庫檔案，只在面板 **Settings → Bindings → Add binding → D1 database** 綁一次（Variable name 填 `DB`，大寫）。

- ✅ 不用碰任何檔案，首次上手最快
- ❌ **每次自動部署後繫結都會消失，必須再去面板綁一次**；而且在你重綁之前，應用是連不上資料庫的（頁面會報錯）。方式 B 是 push 就自動部署，所以這個代價會反覆出現
- 只建議在「先跑起來看看效果」的試用階段用；打算長期用請選甲或乙

> `database_id` 不是金鑰，提交進公開倉庫沒有安全問題——光有 ID 沒有你的 API Token 訪問不了資料。

**B2. 在 Cloudflare 匯入倉庫**

**B2. 在 Cloudflare 匯入倉庫**

1. Cloudflare 控制台 **Workers & Pages → Create → 選 Import a repository** 旁的 **Get started**
2. 授權並選中你 Fork 的倉庫
3. 構建配置：
   - **Build command** 填 `npm run build`
   - **Deploy command** 保持預設 `npx wrangler deploy`
   - Worker 名建議保持 `rrelaynest`（**必須與 `wrangler.toml` 裡的 `name` 一致**，否則構建失敗）

**B3. 配置執行時金鑰**

在該 Worker 的 **Settings → Variables and Secrets** 裡，新增三個 **Secret 型別**變數（不是 build 變數，build 變數執行時讀不到）：`ADMIN_PASSWORD`、`SESSION_SECRET`、`ENCRYPTION_KEY`，值取自通用準備第 3 步。

> 若在 B2 已點 Save and Deploy 部署過一次，配置完金鑰後需再觸發一次部署讓金鑰生效（改倉庫推一下，或在面板點 Retry/Redeploy）。

**B4. 確認 D1 已生效**

D1 的處理在 **B1** 就做完了（甲/乙寫進配置檔案，丙在面板繫結），這一步只是確認：

- 部署完成後到該 Worker 的 **Settings → Bindings**，應能看到一條 D1 繫結，**Variable name 是 `DB`**（必須大寫、必須是 `DB`，與程式碼裡的 `env.DB` 一致；名字不對執行時會報 D1 未繫結）
- 若走的是 B1 甲/乙，這條繫結由配置檔案生成，之後每次部署都在，不用管
- 若走的是 B1 丙，**每次部署後都要回來檢查並重綁**（這就是丙的代價）

> 如果繫結在但應用仍報資料庫錯誤，先確認 Variable name 是大寫 `DB` 而不是 `db` 或別的名字。

**B5. 首次訪問，完成建表 + seed admin**

部署完成後 D1 還是空庫，但**無需手動做任何事**：用瀏覽器開啟一次 Worker 地址（形如 `https://rrelaynest.<你的子域>.workers.dev`），首個請求會自動建表 + seed 首個 admin（冪等）。稍等一兩秒重新整理，即可用 `admin` + 初始密碼登入，進設定頁儘快改密。

> 若想顯式確認，也可調引導端點（帶 `Authorization` Header 的 POST，瀏覽器位址列訪問不了，用 Postman / Hoppscotch 或 curl）：
> ```bash
> curl -X POST https://你的-worker-域名/api/admin/bootstrap \
>   -H "Authorization: Bearer 你設的_ADMIN_PASSWORD"
> ```
> 成功返回 `{"ok":true,...}`，`alreadyInitialized:true` 表示首次訪問已引導過。

**B6. 升級**：在 Fork 倉庫點 **Sync fork** 同步上游並推到生產分支，Cloudflare 會自動重新構建部署。新增遷移會在下一次訪問時自動應用（冪等）。

D1 繫結在升級時是否需要重新處理，取決於 B1 選了哪種：

| B1 做法 | 升級後 D1 |
|---|---|
| 甲（改 `wrangler.toml`） | 不用管。但 Sync fork 時那一行可能衝突，保留你自己的版本 |
| 乙（部署分支 + 獨立配置） | 不用管，也不會衝突。記得把主分支合進部署分支再推 |
| 丙（只在面板繫結） | **每次都要重新綁一遍**，重綁前應用連不上資料庫 |

---

> **想用本地 CLI 部署？** 也支援：`npx wrangler d1 create rrelaynest-db` 拿到 ID → 開啟 `wrangler.toml` 把 D1 段每行開頭的 `#@d1 ` 刪掉（取消註釋），並把佔位符換成你的真實 ID → `npx wrangler secret put` 設三個金鑰 → `npm run deploy` → 瀏覽器訪問一次自動建表。
>
> 這個改動**提交或不提交都可以**：不提交就只在本地生效（每台機器各自改一次）；提交了就等於 B1 甲，以後 CLI、面板連 Git 都能用，代價是 Sync fork 時那行可能衝突。方式 A 的 GitHub Actions 本質就是把「取消註釋 + 填 ID」這套搬到了雲端（用倉庫 Secret 存 ID）。

---

## 本地開發

```bash
npm ci
npm run dev            # 前端 (Vite)

# 另開一個終端，起 Node 後端：
export ADMIN_PASSWORD=dev-admin
export SESSION_SECRET=$(openssl rand -hex 32)
export ENCRYPTION_KEY=$(openssl rand -base64 32)   # 必須是 base64 的 32 位元組，不是 hex
npm run build:server && npm run start:node   # http://localhost:3100

# 或 Workers 本地：
npm run dev:worker     # http://localhost:7738
```

測試與型別檢查：

```bash
npm test               # vitest
npm run typecheck      # tsc（客戶端 + 服務端兩套配置）
```

---

## 環境變數一覽

| 變數 | 必需 | 預設 | 說明 |
| --- | --- | --- | --- |
| `ADMIN_PASSWORD` | 是 | —— | 首個 admin 初始密碼 / Workers 引導令牌 |
| `SESSION_SECRET` | 是 | —— | 會話簽名金鑰 |
| `ENCRYPTION_KEY` | 是 | —— | 敏感欄位加密金鑰 |
| `PORT` | 否 | `3100` | Node 監聽埠 |
| `DB_PATH` | 否 | `data/rrelaynest.sqlite` | Node SQLite 檔案路徑 |
| `DIST_DIR` | 否 | `dist` | Node 前端靜態資源目錄 |

> Node 部署需 **Node 22+**（依賴內建 `node:sqlite`）。Docker 映象已鎖 Node 24。

---

## 許可證

[MIT](LICENSE)。可自由使用、修改、商用與二次分發，保留版權與許可宣告即可。
