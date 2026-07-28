-- 0002_multiuser：单用户 → 邀请制多用户 + 完整数据隔离。
-- 本文件只做「建表 / 改列 / 重建 settings」的纯 DDL。
-- seed 默认 admin、回填 sites/proxies.user_id、把每用户 settings 从 user_id=0
-- 迁到 admin —— 这些需要算 PBKDF2 哈希、拿 seed 出来的 admin id，纯 SQL 做不到，
-- 由入口代码 runStartupMigration() 在本迁移之后执行（见 multiuser-plan 第六节）。
--
-- 执行方式：migrate.ts 把本文件按 ';' 拆成单条语句，在一个事务(batch)内顺序执行。
-- 故此处不能写多语句依赖同一 PRAGMA 状态的技巧，每条都需独立可跑。

-- 1) 用户表：邀请制，仅 admin 建号。session_version 为即时吊销核心（停用/改密/降级/删号时 +1）。
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  username        TEXT    NOT NULL UNIQUE,          -- 登录名
  password_hash   TEXT    NOT NULL,                 -- PBKDF2: pbkdf2$<iter>$<salt_b64>$<hash_b64>
  role            TEXT    NOT NULL DEFAULT 'user',  -- 'admin' | 'user'
  disabled        INTEGER NOT NULL DEFAULT 0,       -- 停用不删除，禁止登录
  session_version INTEGER NOT NULL DEFAULT 1,       -- 会话版本号；+1 使旧 cookie 立即失效
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- 2) 业务表加 user_id（可空；非空由应用层 INSERT 保证）。REFERENCES 提供引用完整性；
--    默认值为 NULL，故满足 SQLite「ADD COLUMN 带 REFERENCES 时默认值须为 NULL」的限制。
--    site_groups / site_models 不加 user_id：经 site_id -> sites.user_id 间接归属（查询 JOIN 过滤）。
ALTER TABLE sites ADD COLUMN user_id INTEGER REFERENCES users(id);

ALTER TABLE proxies ADD COLUMN user_id INTEGER REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_sites_user ON sites(user_id);

CREATE INDEX IF NOT EXISTS idx_proxies_user ON proxies(user_id);

-- 3) settings 全局单例 → 每用户。复合主键 (user_id, key)，user_id=0 约定为系统级。
--    SQLite 不能改主键，需重建表。旧全局键先全部落到 user_id=0，
--    入口代码再把「每用户键」(scrape_interval_min / last_cron_run_at /
--    checkin_last_reset_at / global_proxy_id) 从 0 迁到 seed 出的 admin。
CREATE TABLE IF NOT EXISTS settings_new (
  user_id INTEGER NOT NULL DEFAULT 0,
  key     TEXT    NOT NULL,
  value   TEXT,
  PRIMARY KEY (user_id, key)
);

INSERT OR IGNORE INTO settings_new (user_id, key, value) SELECT 0, key, value FROM settings;

DROP TABLE settings;

ALTER TABLE settings_new RENAME TO settings;
