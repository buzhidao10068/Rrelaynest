-- Rrelaynest D1 / SQLite 数据库 schema
-- 同一份 DDL 两平台共用：
--   Workers/D1： wrangler d1 execute rrelaynest-db --local  --file=./schema.sql
--                wrangler d1 execute rrelaynest-db --remote --file=./schema.sql
--   Node/Docker：server 启动时对空库执行本文件（见 src/server/sqlite-db.ts）

-- 站点表：一个中转站一行
CREATE TABLE IF NOT EXISTS sites (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL,                 -- 站点名
  base_url        TEXT    NOT NULL,                 -- 站点地址，如 https://api.example.com
  -- access token 加密后存储（AES-GCM，见 shared/crypto.ts），明文不落库
  token_encrypted TEXT,
  rate            REAL,                             -- 汇率：1 RMB 换多少站点货币
  currency        TEXT    DEFAULT 'USD',            -- 站点货币单位
  balance         REAL,                             -- 余额（站点货币），由爬虫更新
  checkin_enabled INTEGER NOT NULL DEFAULT 0,       -- 是否需要签到 0/1
  checkin_done    INTEGER NOT NULL DEFAULT 0,       -- 今日是否已签到 0/1（cron 跨天重置）
  last_checkin_at INTEGER,                          -- 上次签到时间戳(ms)
  checkin_result  TEXT,                             -- 上次签到结果（获得额度 / 失败原因 / 需手动）
  email           TEXT,                             -- 注册邮箱
  note            TEXT,                             -- 备注
  sort_order      INTEGER NOT NULL DEFAULT 0,       -- 手动排序
  last_scraped_at INTEGER,                          -- 上次成功爬取的时间戳(ms)
  last_error      TEXT,                             -- 上次爬取错误信息，成功则清空
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

-- 分组表：从 /api/pricing 爬到的倍率分组，一个站点多行
CREATE TABLE IF NOT EXISTS site_groups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id     INTEGER NOT NULL,
  group_name  TEXT    NOT NULL,                     -- 分组标识，如 default / vip
  group_ratio REAL,                                 -- 分组倍率
  group_desc  TEXT,                                 -- 分组显示名/描述
  updated_at  INTEGER NOT NULL,
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  UNIQUE (site_id, group_name)
);

-- 模型定价表：从 /api/pricing 爬到的模型列表，一个站点多行
CREATE TABLE IF NOT EXISTS site_models (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id        INTEGER NOT NULL,
  model_name     TEXT    NOT NULL,
  quota_type     INTEGER,                           -- 0=按量(倍率) 1=按次
  model_ratio    REAL,                              -- 模型倍率
  completion_ratio REAL,                            -- 补全倍率
  model_price    REAL,                              -- 按次价格
  enable_groups  TEXT,                              -- 可用分组，JSON 数组字符串
  updated_at     INTEGER NOT NULL,
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  UNIQUE (site_id, model_name)
);

-- 键值设置表：面板可改的运行时配置
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- 默认设置
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('scrape_interval_min', '30'),     -- 自动爬取间隔（分钟），面板可改
  ('last_cron_run_at', '0'),         -- 上次 cron 实际执行爬取的时间戳(ms)
  ('checkin_last_reset_at', '0');    -- 上次跨天重置 checkin_done 的时间戳(ms)

CREATE INDEX IF NOT EXISTS idx_site_groups_site ON site_groups(site_id);
CREATE INDEX IF NOT EXISTS idx_site_models_site ON site_models(site_id);
