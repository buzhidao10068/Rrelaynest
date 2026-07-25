# 多用户改造实施计划 / MULTIUSER-PLAN — Rrelaynest

> 配合 `design.md` / `prd.md` 阅读。本文件是**改造前的评审清单**，不是已实现记录。
> 目标：从「单用户 + 单一 ADMIN_PASSWORD」升级为「邀请制多用户 + 完整数据隔离 + 两级角色」。
> **动手顺序**：先评审本文档 → 逐节落地 → 每节配套的越权测试用例必须全绿才算完成。

## 锁定的设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 注册方式 | **邀请制**：仅 admin 手动开账号，无自助注册端点 | 去掉 `/api/register` + 防滥用/限流/验证码，缩小攻击面与工作量 |
| 数据隔离 | **完整隔离**：每个用户只见自己的 sites / proxies / settings | 一处漏判 = 数据泄露，隔离必须在 SQL 层强制，不靠前端 |
| 角色 | **两级**：`admin` / `user` | admin 管账号；可读他人站点（需条款解锁）；user 只管自己数据 |
| 密码存储 | **PBKDF2**（crypto.subtle，Workers/Node 通用）单向哈希，迭代 **100_000** | 不能用 AES-GCM（那是可逆的，用于 token/代理密码） |
| 会话 | HMAC cookie payload 增加 `uid` + `role` + **`sv`（session 版本号）**；**有状态** | 需即时吊销（停用/改密/删号立刻掉线），故每请求校验 `sv` 与 users 表一致 |
| admin 看他人数据 | 方案 **A**：业务端点永远只看自己；他人数据走独立只读 admin 端点，**默认隐藏 + 读条款解锁** | 业务端点零 admin 分支，越权面最小；跨用户读是显式、受 ack 门控的旁路 |
| 迁移 | 新建**首个迁移系统**（当前 schema 全靠 `IF NOT EXISTS` 幂等，无版本） | 需要 `ADD COLUMN` + 回填，幂等 DDL 无法表达「一次性数据变更」 |

## 影响面总览（先读这张表）

| 层 | 文件 | 改动量 | 风险 |
|----|------|--------|------|
| Schema | `schema.sql` + 新迁移目录 | 中 | 高（回填错 = 数据错乱） |
| 迁移系统 | `src/shared/migrate.ts`（新）+ 两入口调用 | 中 | 高（两平台 DDL 差异） |
| 鉴权 | `src/shared/auth.ts` | 中 | 高（session payload 变更） |
| 密码哈希 | `src/shared/password.ts`（新） | 小 | 中 |
| 路由 | `src/shared/routes.ts` | **大**（~20 端点全改 + 新增用户管理） | 高（越权核心） |
| 类型 | `src/shared/types.ts` | 小 | 低 |
| 定时 | `src/shared/scheduler.ts` | 中（改为按用户遍历） | 中（settings 语义变化） |
| 入口 | `src/server/index.ts` / `src/worker/index.ts` | 小（调迁移 + seed admin） | 中 |
| 前端 | `frontend/*`（本次不含，块7 UI 已 mock） | — | — |

---

## 一、Schema 与迁移

### 1.1 新增 `users` 表

```sql
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  username        TEXT    NOT NULL UNIQUE,          -- 登录名
  password_hash   TEXT    NOT NULL,                 -- PBKDF2: iterations:salt_b64:hash_b64
  role            TEXT    NOT NULL DEFAULT 'user',  -- 'admin' | 'user'
  disabled        INTEGER NOT NULL DEFAULT 0,       -- 停用不删除，禁止登录
  session_version INTEGER NOT NULL DEFAULT 1,       -- 会话版本号；停用/改密/手动踢出时 +1，使旧 cookie 立即失效（即时吊销核心，见第三节）
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
```

### 1.2 业务表加 `user_id`

- `sites` 增 `user_id INTEGER NOT NULL REFERENCES users(id)`。
- `proxies` 增 `user_id INTEGER NOT NULL REFERENCES users(id)`。
- `site_groups` / `site_models`：**不加** `user_id`。它们通过 `site_id → sites.user_id` 间接归属；查询时 JOIN sites 过滤即可，避免冗余列与回填不一致风险。
- 新增索引：`idx_sites_user ON sites(user_id)`、`idx_proxies_user ON proxies(user_id)`。

> ⚠ SQLite 的 `ALTER TABLE ADD COLUMN` **不能加 `NOT NULL` 且无默认值**的列到有数据的表。
> 迁移做法：先 `ADD COLUMN user_id INTEGER`（可空）→ 回填 → 应用层始终写入非空。
> SQLite 无法后期改成 NOT NULL（需重建表），故约束由**应用层保证**（所有 INSERT 必带 user_id）。
> D1 同此限制。两平台迁移脚本一致。

### 1.3 `settings` 表：全局 → 每用户

当前 `settings(key PK, value)` 是**全局单例**。改造后需区分：

- **每用户设置**（`scrape_interval_min`、`last_cron_run_at`、`checkin_last_reset_at`、`global_proxy_id`）→ 归属各用户。
- **系统级设置**（未来的更新检查开关等）→ 保留全局。

方案：settings 主键改为复合 `(user_id, key)`，`user_id = 0` 约定为系统级。

```sql
-- 需重建表（SQLite 不能改主键）。迁移脚本：
CREATE TABLE settings_new (
  user_id INTEGER NOT NULL DEFAULT 0,
  key     TEXT    NOT NULL,
  value   TEXT,
  PRIMARY KEY (user_id, key)
);
-- 旧全局设置回填给默认 admin（见 1.4），系统级键归 user_id=0。
```

> 这是本次**最容易出错的一步**：`last_cron_run_at` / `checkin_last_reset_at` 从全局节流变成每用户节流，
> scheduler 语义随之改变（见第五节）。评审时重点确认这里。

### 1.4 迁移系统（首个）

当前无版本机制。新建轻量迁移器：

```
db/migrations/
  0001_init.sql          ← 现有 schema.sql 内容（首装用）
  0002_multiuser.sql     ← 本次：users 表 + ADD COLUMN + settings 重建
src/shared/migrate.ts    ← 读 schema_migrations 表，按序执行未跑过的 .sql
```

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
```

`migrate.ts` 逻辑（平台无关，走 `Database` 接口）：
1. 建 `schema_migrations`（幂等）。
2. 列出所有迁移 version，跳过已在表中的。
3. 逐个在事务内执行 SQL + 插入 version 记录。

> Workers/D1 侧：迁移文件通过 `wrangler d1 migrations apply` 或构建时内联执行；
> 两平台**共用同一批 .sql 内容**（DDL 已确认双平台兼容）。文档需在部署章节写清各自命令。

### 1.5 `0002_multiuser.sql` 回填步骤（有序、事务内）

1. 建 `users` 表。
2. `sites` / `proxies` `ADD COLUMN user_id INTEGER`。
3. **Seed 默认 admin**：用 `ADMIN_PASSWORD` 环境变量的 PBKDF2 哈希插入一行
   `username='admin', role='admin'`（幂等：`INSERT OR IGNORE`，username UNIQUE 兜底）。
   - ⚠ 迁移是纯 SQL，无法算哈希。故 **seed 由入口代码在迁移后执行**（见第六节），
     而非写死在 .sql 里。.sql 只建表/改列，代码负责计算哈希 + 回填 user_id。
4. **回填存量数据**：把所有现有 `sites` / `proxies` 的 `user_id` 指向该默认 admin 的 id。
   （由入口代码执行，因为要拿到 seed 出来的 admin id。）
5. **重建 settings**：旧全局键回填给默认 admin 的 user_id；系统级键（如有）归 0。

> 回填顺序不可乱：必须先有 admin 行拿到 id，再回填 sites/proxies/settings。
> 这一整套「算哈希 + seed + 回填」放在 `runStartupMigration()`（第六节），一次性、幂等。

---

## 二、密码哈希（新 `src/shared/password.ts`）

crypto.ts 的 AES-GCM 是**可逆**的，只能用于 token/代理密码。用户登录密码必须**单向**。

```ts
// PBKDF2-SHA256，crypto.subtle，Workers/Node 20+ 通用。
// 存储格式： "pbkdf2$<iterations>$<salt_b64>$<hash_b64>"
export async function hashPassword(plain: string): Promise<string>;
export async function verifyPassword(plain: string, stored: string): Promise<boolean>;
```

- 迭代次数 ≥ 100_000（评审定值）；随机 16 字节 salt；32 字节输出。
- `verifyPassword` 用恒定时间比较（复用 auth.ts 的 `timingSafeEqual`，或本地实现）。
- ⚠ 与 auth.ts 现有的 `verifyPassword(adminPassword, password)`（明文常量时间比较）**同名不同义**。
  改造时 auth.ts 的旧 `verifyPassword` 删除（不再有单一 ADMIN_PASSWORD 登录路径），
  登录改走 users 表 + 本模块。避免两个同名函数并存造成误用。

---

## 三、鉴权改造（`src/shared/auth.ts`）——即时吊销（有状态会话）

> **已定案：即时吊销**。停用 / 改密 / 删号后，该用户**已签发的 cookie 立即失效**，
> 不等 TTL 过期。代价：每个 API 请求鉴权时**多查一次库**（读 users 的 `session_version` +
> `disabled` 比对），当前「验证纯算签名、不碰 DB」的无状态优点让位于安全性。
> 撞 `db-sqlite.ts` 的单文件锁瓶颈——本次小规模可接受；量大时随 SCALING NOTE 升级 libSQL/PG。

### 3.1 session payload 增 `uid` + `role` + `ver`（会话版本号）

```ts
// 旧： payload = b64url(exp)
// 新： payload = b64url(JSON.stringify({ uid, role, ver, exp }))
//   ver = 签发时该用户的 users.session_version 快照
export async function createSession(sessionSecret, uid: number, role: string, ver: number): Promise<string>;
// verifySession 只做「签名 + 过期」的无状态校验，返回 { uid, role, ver } | null
export async function verifySession(sessionSecret, token): Promise<{ uid: number; role: string; ver: number } | null>;
```

- HMAC 签名机制不变（对 payload 签名）。
- ⚠ **破坏性变更**：`verifySession` 返回类型从 `boolean` 变对象。旧格式 cookie（仅 exp）失效，
  用户需重新登录（改造期一次性，可接受）。

### 3.2 即时吊销机制 —— `session_version` 单调递增

`users` 表的 `session_version`（见 1.1，默认 1）是吊销开关：

- **签发**：登录时把当前 `session_version` 写进 cookie payload 的 `ver`。
- **校验（中间件，每请求）**：`verifySession` 通过后，**再查一次库**：
  1. `SELECT session_version, disabled, role FROM users WHERE id = ?`（用 payload 的 uid）。
  2. 用户不存在 / `disabled=1` → 401（已删 / 已停用，立即失效）。
  3. `row.session_version !== payload.ver` → 401（密码已改 / 被强制下线，旧 cookie 作废）。
  4. 全过 → 把 **库里最新的** `{ uid, role }` 挂 `c.set('user', ...)`（角色以库为准，
     防止「降级后旧 cookie 仍带 admin role」——payload 里的 role 只作参考，**授权判定用库里的**）。
- **触发 +1（吊销全部旧会话）**：以下操作对目标用户 `session_version = session_version + 1`：
  - admin 停用用户（`disabled=1`）—— 停用即时生效（下一次请求就被拒）。
  - admin / 本人重置密码 —— 改密后旧会话全掉线。
  - admin 降级 / 升级角色 —— 强制重新登录，拿到新 role 的 cookie。
  - admin 删除用户 —— 行没了，校验步骤 2 直接 401。

> 授权用「库里的 role」而非 cookie 里的 role，是这套的关键：即使有人留着降级前的旧 cookie，
> 每请求都会被步骤 3（ver 不匹配）拦掉；即便 ver 侥幸相同，步骤 4 也以库里 role 为准。双保险。

### 3.3 登录端点改写

`/api/login` 从「比 ADMIN_PASSWORD」改为：
1. 收 `{ username, password }`。
2. 查 users 表该 username（`disabled=0`）。
3. `password.verifyPassword(password, row.password_hash)`。
4. 成功 → `createSession(secret, row.id, row.role, row.session_version)` 写 cookie。
5. 失败 → 401（用户名不存在与密码错误返回**相同**错误文案，避免枚举用户名）。

---

## 四、路由改造清单（`src/shared/routes.ts`）——越权核心

**原则**：
- 中间件已保证「已登录」并提供 `c.get('user') = { uid, role }`。
- 每个数据端点：`user` 只操作 `WHERE user_id = ?`（自己的 uid）；`admin` 视需要放开。
- 所有按 `:id` 的单资源操作：`WHERE id = ? AND user_id = ?`（不存在或不属己都返回 404，
  **不区分**「不存在」与「无权」，避免探测他人资源 id）。

### 4.1 逐端点清单

| 端点 | 方法 | 现状 | 改动 |
|------|------|------|------|
| `/api/login` | POST | 比 ADMIN_PASSWORD | 改查 users 表（第三节） |
| `/api/logout` | POST | 清 cookie | 不变 |
| `/api/session` | GET | 返回 authenticated | 增返回 `{ authenticated, username, role }` |
| `/api/me` **新** | GET | — | 返回当前用户 `{ id, username, role }` |
| `/api/sites` | GET | `SELECT * FROM sites` | 加 `WHERE user_id = ?`（admin 可选看全部，见 4.3）；groups/models 查询改 JOIN sites 过滤 user |
| `/api/sites` | POST | INSERT 无 user_id | INSERT 带 `user_id = uid` |
| `/api/sites/:id` | PUT | `WHERE id = ?` | `WHERE id = ? AND user_id = ?`；existing 查询同样带 user 过滤 |
| `/api/sites/:id` | DELETE | `WHERE id = ?` | `WHERE id = ? AND user_id = ?`（返回受影响行数=0 → 404） |
| `/api/sites/:id/scrape` | POST | 查 site by id | 查 `id AND user_id`；不属己→404 |
| `/api/scrape-all` | POST | `SELECT * FROM sites` | `WHERE user_id = ?`（只爬自己的） |
| `/api/sites/:id/checkin` | POST | 查 site by id | 查 `id AND user_id`；不属己→404 |
| `/api/proxies` | GET | `SELECT * FROM proxies` | `WHERE user_id = ?` |
| `/api/proxies` | POST | INSERT 无 user_id | INSERT 带 `user_id = uid` |
| `/api/proxies/:id` | PUT | `WHERE id = ?` | `WHERE id = ? AND user_id = ?` |
| `/api/proxies/:id` | DELETE | 联动清 sites.proxy_id + global | 联动语句全部加 `AND user_id = ?`（只清自己的站与自己的 global_proxy_id） |
| `/api/settings` | GET | `SELECT key,value` 全局 | `WHERE user_id = ?`（+ 系统级 user_id=0 合并，只读） |
| `/api/settings` | PUT | upsert 全局 | upsert 带 `user_id = uid`；禁止 user 写系统级键 |
| `/api/export` | GET | `SELECT * FROM sites` | `WHERE user_id = ?` |

### 4.2 新增：用户管理端点（admin-only）

新增中间件 `requireAdmin`（读 `c.get('user').role !== 'admin'` → 403）。

| 端点 | 方法 | 作用 |
|------|------|------|
| `/api/admin/users` | GET | 列所有用户（不含 password_hash），admin-only |
| `/api/admin/users` | POST | 创建用户 `{ username, password, role }`；username 查重；哈希密码；admin-only |
| `/api/admin/users/:id` | PUT | 改角色 / 停用 / 重置密码；admin-only；**禁止 admin 停用/降级自己**（防锁死） |
| `/api/admin/users/:id` | DELETE | 删除用户；**级联删除**其 sites/proxies/settings（事务）；禁止删自己；admin-only |
| `/api/admin/bootstrap` | POST | 首装 seed + 回填（仅 Workers 用）；双闸幂等（users 非空即空操作）+ bootstrap 令牌校验，见第六节 |

> 删用户的级联：先删该用户的 site_groups/site_models（JOIN sites）、sites、proxies、settings，
> 最后删 users 行。全部一个 batch 事务，避免留孤儿数据。

### 4.3 admin 看他人数据 —— 方案 A + 独立只读端点 + 条款解锁（已定案）

**核心：业务端点保持纯净**。`/api/sites` / `/api/proxies` / `/api/settings` / `/api/export` 等
**永远只查 `WHERE user_id = self`**，一条 admin 分支都不加——这是方案 A 的价值（越权面最小、
逻辑统一、前端简单）。admin 看他人数据走**物理隔离的、只读的、admin-only** 端点，不塞进业务端点。

新增（admin-only + 条款解锁双校验）：

| 端点 | 方法 | 作用 |
|------|------|------|
| `/api/admin/users/:uid/sites` | GET | 只读列出指定用户的站点（含分组/模型摘要，剔除 token） |
| `/api/admin/users/:uid/proxies` | GET | 只读列出指定用户的代理（剔除密码） |

**条款解锁机制**（「默认隐藏，读完条款才显示」不只是前端摆设，后端强制）：

- 持久化标记：`settings` 里 `(user_id = 该admin, key = 'admin_global_view_ack', value = 确认时间戳)`。
- 前端：设置页「查看他人站点数据」区块默认折叠/灰置，展开是条款（数据隐私责任、仅用于管理排障），
  读完勾选「我已阅读并同意」才点亮开关；开关写/删上面这条 setting。
- 后端：`/api/admin/users/:uid/*` 这两个端点，除 `requireAdmin` 外，**再校验该 admin 的 ack 标记存在**，
  否则 403。撤销 ack（关开关）后端立即拒。代价：每次跨用户读多一次 settings 查询（admin 低频路径）。
- **只读**：这两个端点没有对应的写/删/爬取版本。admin 要改他人数据只能先给自己开号或走用户管理端点，
  不能直接改写他人业务数据——把「读」和「改」分开，降低越权与误操作面。

---

## 五、定时任务改造（`src/shared/scheduler.ts`）

现状：全局 `SELECT * FROM sites` + 全局 `last_cron_run_at` / `checkin_last_reset_at` 节流。
改造后 settings 每用户化，节流也每用户：

- `runScheduledTick` 改为：先 `SELECT id FROM users WHERE disabled=0`（停用用户不参与定时），对每个用户：
  - 读**该用户的** `scrape_interval_min` / `last_cron_run_at`，判 due，占位，
    `SELECT * FROM sites WHERE user_id = ?` 逐站爬。
  - 该用户的 `checkin_last_reset_at` 跨天重置**其**站点 checkin_done。
  - 自动签到 `WHERE user_id = ? AND checkin_enabled=1 AND checkin_done=0`。

> ⚠ 性能：用户数 × 站点数。node:sqlite 单文件锁下串行即可（本就小规模，见 db-sqlite SCALING NOTE）。
> Workers 单次 scheduled 时长有限，用户量大时需分批 —— 本次小规模不处理，仅在文档标注上限风险。
> 关联待办：[[scraper-backend-concurrency-todo]]（并发/超时/重试仍未实现，多用户后更需要）。

---

## 六、入口改造（`src/server/index.ts` / `src/worker/index.ts`）

启动时（Node）/ 部署时（Workers）执行一次 `runStartupMigration(db, secrets)`：
1. 跑 `migrate.ts`（建表 / ADD COLUMN / 重建 settings）。
2. 若 users 表为空：用 `ADMIN_PASSWORD` 哈希 seed 默认 admin（幂等）。
3. 若存在 user_id 为 NULL 的 sites/proxies：回填到默认 admin，并回填旧全局 settings。
   （用「NULL 存量」判定，保证只在首次改造后跑一次，重启幂等。）

- **Node**：进程启动时有「服务未开始收请求」的时机 → `await runStartupMigration()` 后再 `serve()`。
- **Workers（已定案：选项 1 — bootstrap 端点 + 双闸）**：Workers 无启动钩子（冷启动即处理请求），
  seed 这步必须跑代码（算 PBKDF2 哈希、拿 admin id 回填），纯 SQL 迁移做不到。故：
  - **建表改列**：走 D1 官方 `wrangler d1 migrations apply`（部署时跑，与代码无关）。
  - **seed + 回填**：新增 `POST /api/admin/bootstrap`，首次部署后触发一次（浏览器按钮或 curl）。
    两道闸保证幂等且不构成持续攻击面：
    - **幂等闸**：进来先查 users 表，只要已存在任何 admin 就直接返回「已初始化」、啥也不做 → 跑一百次只 seed 一次。
    - **首闸**：只在 users 表为空时真正执行，初始化后自动退化为空操作。
    - 触发用一次性 bootstrap 令牌（读 `ADMIN_PASSWORD` 或专门 env）校验，防部署窗口被人抢先 seed。
  - 两平台最终都收敛到同一个 `runStartupMigration()`，只是触发点不同（Node 启动钩子 / Workers 首访 bootstrap）。

> ⚠ `ADMIN_PASSWORD` 语义变化：从「登录密码」变成「首个 admin 的初始密码」。
> seed 后改密码走 `/api/admin/users/:id`。文档需明确：改了 users 表密码后，
> `ADMIN_PASSWORD` 环境变量仅用于**首次** seed，之后不再影响登录。

---

## 七、类型改造（`src/shared/types.ts`）

- 新增 `UserRow { id, username, password_hash, role, disabled, session_version, created_at, updated_at }`。
- `SiteRow` / `ProxyRow` 增 `user_id: number`。
- `AppSecrets`：`ADMIN_PASSWORD` 注释更新为「首个 admin 初始密码」。
- Hono context 变量类型：`c.get('user')` 的 `{ uid: number; role: string }`（由中间件在**查库校验 session_version 通过后**注入，见第三节）。

---

## 八、越权（authZ）测试用例——落地验收标准

每条都要写成自动化测试（或 Playwright/HTTP 脚本），**全绿才算该节完成**。

### 8.1 数据隔离
1. 用户 A 建站点 S_A；用户 B `GET /api/sites` **看不到** S_A。
2. 用户 B `PUT /api/sites/{S_A.id}` → 404（不是 403，不泄露存在性）。
3. 用户 B `DELETE /api/sites/{S_A.id}` → 404，且 S_A 仍在。
4. 用户 B `POST /api/sites/{S_A.id}/scrape` / `.../checkin` → 404。
5. proxies 同样跑 1–4。
6. 用户 B `GET /api/export` 不含 A 的任何站点。
7. 用户 B `GET /api/settings` 只见自己的键；改 `scrape_interval_min` 不影响 A。

### 8.2 角色边界
8. user 角色调 `/api/admin/users`（任意方法）→ 403。
9. admin 调 `/api/admin/users` 成功列出。
10. admin 建重复 username → 409/400。
11. admin `DELETE` 自己 → 拒绝（防锁死）。
12. admin 停用/降级自己 → 拒绝。
13. 删除用户 U 后：U 的 sites/proxies/settings/groups/models 全部消失（无孤儿）。

### 8.3 会话与登录（含即时吊销）
14. 停用用户后其**新**登录被拒。
15. **即时吊销 - 停用**：用户 B 持有效 cookie，admin 停用 B → B 用**旧 cookie** 调任意端点立即 401（不等 TTL）。
16. **即时吊销 - 改密**：admin 重置 B 密码 → B 旧 cookie 立即 401；B 用新密码可重新登录。
17. **即时吊销 - 降级**：B 是 admin 且持 admin cookie，admin 把 B 降为 user → B 旧 cookie 立即被拒（ver 不匹配），重登后仅 user 权限。
18. **越权兜底**：即便构造一个 ver 匹配但 role 被篡改为 admin 的场景，授权仍以**库里 role** 为准（步骤 4）→ 被拒。
19. 错误用户名与错误密码返回**相同**文案（防用户名枚举）。
20. 旧格式 cookie（仅 exp）被 `verifySession` 判为无效。
21. 篡改 payload（改 uid/role/ver）后签名不匹配 → 无效。

### 8.4 admin 跨用户只读 + 条款解锁
22. admin **未 ack**（无 `admin_global_view_ack`）调 `/api/admin/users/:uid/sites` → 403。
23. admin **ack 后**调该端点 → 200，返回目标用户站点（剔除 token），且**无对应写/删端点**。
24. admin 撤销 ack（关开关）→ 再调立即 403。
25. **普通 user** 无论是否 ack，调 `/api/admin/users/:uid/*` → 403（先撞 requireAdmin）。

### 8.5 定时任务隔离
26. A 的间隔到点、B 未到点：只有 A 的站被爬。
27. 跨天重置只清对应用户的 checkin_done。
28. **停用用户不参与定时**：B 被停用（disabled=1）后，scheduler 不爬 B 的站、不签 B 的到。

### 8.6 Bootstrap（Workers 首装）与迁移正确性
29. 拿一份**改造前**的库跑迁移：所有存量 sites/proxies 归到默认 admin；admin 能登录；旧设置保留。
30. 迁移**重复执行**幂等：再跑一次不重复 seed、不重复回填、不报错。
31. **bootstrap 幂等闸**：users 表已有 admin 时调 `/api/admin/bootstrap` → 返回「已初始化」、不新增行、不改数据。
32. **bootstrap 令牌校验**：无 / 错 bootstrap 令牌调该端点 → 拒绝。

---

## 九、落地顺序建议（每步可独立评审 / 回滚）

1. `password.ts`（PBKDF2，迭代 100_000）+ 单测（纯函数，零风险先落）。
2. `migrate.ts` + `0001`/`0002` .sql + `schema_migrations`（在测试库验证 8.6-29/30）。
3. `auth.ts` payload 改造（uid/role/ver）+ 每请求查库校验 `session_version`/`disabled` + 调用点。
4. 入口 `runStartupMigration` + seed + 回填；Workers 侧 `/api/admin/bootstrap`（双闸 + 令牌，跑 8.6-31/32）。
5. routes.ts 数据端点逐个加 user 过滤（每加一个跑对应 8.1 用例）。
6. admin-only 用户管理端点 + `requireAdmin` + `session_version` 递增触发（跑 8.2 / 8.3 即时吊销）。
7. admin 跨用户只读端点 `/api/admin/users/:uid/{sites,proxies}` + 条款 ack 双校验（跑 8.4）。
8. scheduler.ts 每用户化 + 跳过 `disabled=1` 用户（跑 8.5）。
9. 全量越权用例回归（8.1–8.6 全绿）。
10. 更新 `design.md` 平台适配表与安全章节、部署文档（ADMIN_PASSWORD 语义、Workers 迁移 + bootstrap 命令）。

## 十、评审决策（已定案）

| 评审点 | 决定 | 落地位置 |
|--------|------|----------|
| **4.3** admin 看他人数据 | **方案 A** + 独立只读端点 `/api/admin/users/:uid/{sites,proxies}`；默认隐藏，设置页读完条款 ack 后才解锁，后端双校验（`requireAdmin` + ack 标记） | 4.2 / 4.3、8.4 用例 22–25 |
| **六** Workers seed/回填 | **选项 1**：`POST /api/admin/bootstrap` + 双闸（幂等闸 + 首闸）+ 一次性令牌 | 第六节、8.6 用例 31–32 |
| **会话吊销** | **即时吊销**：`users.session_version` 单调递增 + 每请求查库校验；授权以库里 role 为准 | 1.1、第三节、8.3 用例 15–18 |
| **PBKDF2 迭代** | **默认 100_000**；格式 `pbkdf2$<iter>$<salt>$<hash>`，迭代数存串内可平滑上调 | 第二节 |

评审点全部定案，无遗留待拍板项。可按第九节 10 步顺序开始落地。
