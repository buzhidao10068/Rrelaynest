-- 0001_init：首装建库。内容是改造前 schema.sql 的等价 DDL。
-- 本文件是 src/shared/migrations.ts 里 M0001_INIT 的人读镜像，二者内容必须一致
-- （由 migrate.test.ts 的漂移检测守住：改一处必须同步另一处）。
--
-- 执行：migrate.ts 按 ';' 拆成单条语句在一个事务(batch)内顺序执行；
-- 或 Workers/D1 侧用 wrangler d1 execute --file 手动跑。
-- 故 INSERT 拆成单条（不用多值 VALUES），每条独立可跑。

-- 代理表：出站代理池，一个代理一行。仅 Node/Docker 部署生效（Workers 的 fetch 无法走自建代理）。
CREATE TABLE IF NOT EXISTS proxies (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  name               TEXT    NOT NULL,
  type               TEXT    NOT NULL DEFAULT 'http',
  host               TEXT    NOT NULL,
  port               INTEGER NOT NULL,
  username           TEXT,
  password_encrypted TEXT,
  enabled            INTEGER NOT NULL DEFAULT 1,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);

-- 站点表：一个中转站一行
CREATE TABLE IF NOT EXISTS sites (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL,
  base_url        TEXT    NOT NULL,
  token_encrypted TEXT,
  rate            REAL,
  currency        TEXT    DEFAULT 'USD',
  balance         REAL,
  checkin_enabled INTEGER NOT NULL DEFAULT 0,
  checkin_done    INTEGER NOT NULL DEFAULT 0,
  last_checkin_at INTEGER,
  checkin_result  TEXT,
  email           TEXT,
  note            TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  last_scraped_at INTEGER,
  last_error      TEXT,
  proxy_id        INTEGER REFERENCES proxies(id) ON DELETE SET NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

-- 分组表：从 /api/pricing 爬到的倍率分组，一个站点多行
CREATE TABLE IF NOT EXISTS site_groups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id     INTEGER NOT NULL,
  group_name  TEXT    NOT NULL,
  group_ratio REAL,
  group_desc  TEXT,
  updated_at  INTEGER NOT NULL,
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  UNIQUE (site_id, group_name)
);

-- 模型定价表：从 /api/pricing 爬到的模型列表，一个站点多行
CREATE TABLE IF NOT EXISTS site_models (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id        INTEGER NOT NULL,
  model_name     TEXT    NOT NULL,
  quota_type     INTEGER,
  model_ratio    REAL,
  completion_ratio REAL,
  model_price    REAL,
  enable_groups  TEXT,
  updated_at     INTEGER NOT NULL,
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  UNIQUE (site_id, model_name)
);

-- 键值设置表：面板可改的运行时配置
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- 默认设置（单条 INSERT，每条独立幂等）
INSERT OR IGNORE INTO settings (key, value) VALUES ('scrape_interval_min', '30');
INSERT OR IGNORE INTO settings (key, value) VALUES ('last_cron_run_at', '0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('checkin_last_reset_at', '0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('global_proxy_id', '');

CREATE INDEX IF NOT EXISTS idx_site_groups_site ON site_groups(site_id);
CREATE INDEX IF NOT EXISTS idx_site_models_site ON site_models(site_id);
CREATE INDEX IF NOT EXISTS idx_sites_proxy ON sites(proxy_id);
