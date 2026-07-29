// 迁移注册表：运行时的 SQL 真源（内联为字符串，Node 与 Workers 同一份、无需读文件系统）。
// db/migrations/*.sql 是「人读 / wrangler 手动执行」的镜像副本，二者内容必须一致，
// 由 migrations.test.ts 的漂移检测守住（改一处必须同步另一处）。
//
// 顺序即执行顺序。version 用文件名（不含扩展名），字典序 = 应用序。
// 只做建表/改列/重建 DDL；seed / 回填由入口 runStartupMigration() 承担（见 multiuser-plan 第六节）。

export interface Migration {
  version: string;
  sql: string;
}

// 0001：现有 schema.sql 内容，首装建库用（已装库跑到此步时全是 IF NOT EXISTS，幂等空转）。
const M0001_INIT = `
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

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('scrape_interval_min', '30');
INSERT OR IGNORE INTO settings (key, value) VALUES ('last_cron_run_at', '0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('checkin_last_reset_at', '0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('global_proxy_id', '');

CREATE INDEX IF NOT EXISTS idx_site_groups_site ON site_groups(site_id);
CREATE INDEX IF NOT EXISTS idx_site_models_site ON site_models(site_id);
CREATE INDEX IF NOT EXISTS idx_sites_proxy ON sites(proxy_id);
`;

// 0002：单用户 → 多用户。users 表 + sites/proxies 加 user_id + settings 重建为 (user_id, key)。
// 只做 DDL；seed admin / 回填 user_id / 迁移每用户 settings 由入口代码执行。
const M0002_MULTIUSER = `
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  username        TEXT    NOT NULL UNIQUE,
  password_hash   TEXT    NOT NULL,
  role            TEXT    NOT NULL DEFAULT 'user',
  disabled        INTEGER NOT NULL DEFAULT 0,
  session_version INTEGER NOT NULL DEFAULT 1,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

ALTER TABLE sites ADD COLUMN user_id INTEGER REFERENCES users(id);

ALTER TABLE proxies ADD COLUMN user_id INTEGER REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_sites_user ON sites(user_id);

CREATE INDEX IF NOT EXISTS idx_proxies_user ON proxies(user_id);

CREATE TABLE IF NOT EXISTS settings_new (
  user_id INTEGER NOT NULL DEFAULT 0,
  key     TEXT    NOT NULL,
  value   TEXT,
  PRIMARY KEY (user_id, key)
);

INSERT OR IGNORE INTO settings_new (user_id, key, value) SELECT 0, key, value FROM settings;

DROP TABLE settings;

ALTER TABLE settings_new RENAME TO settings;
`;

// 0003：测活词池 + 站点绑定词。probe_words 每用户隔离（UNIQUE(user_id, text)）；
// sites 加 probe_text（单站绑定的测活词，空/NULL = 跟随全局）。全局默认词与开关走每用户 settings
// （probe_global_text / probe_global_enabled），故此处只建表/加列，不塞 settings（由入口按需 seed）。
// 只做 DDL；不回填（新列可空，老数据自然为 NULL = 跟随全局）。见 memory activity-probe-backend-todo。
const M0003_PROBE = `
CREATE TABLE IF NOT EXISTS probe_words (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  text       TEXT    NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, text)
);

CREATE INDEX IF NOT EXISTS idx_probe_words_user ON probe_words(user_id);

ALTER TABLE sites ADD COLUMN probe_text TEXT;
`;

// 0004：站点「用户分组」标签。group_label 是用户自定义的站点归类（主力/备用/测试…），
// 与爬取所得的 site_groups（上游分组倍率，另一个概念）互不相干。空/NULL = 未分组。
// 只做 DDL；不回填（新列可空，老数据自然为 NULL = 未分组）。见前端 stores/sites.ts。
const M0004_GROUP_LABEL = `
ALTER TABLE sites ADD COLUMN group_label TEXT;
`;

// 0005：两步验证（TOTP）。users 加 totp_secret_encrypted（AES-GCM 密文，NULL=未设置）
// + totp_enabled（0/1，仅在验过一次码后置 1，避免误锁）。备份码单独一张表：
// 丢验证器时的唯一自救途径（尤其 admin，否则永久锁死），每码单向哈希存储、用后即焚（used_at）。
// 只做 DDL；不回填（新列可空/默认，老用户自然为「未启用 2FA」）。见 shared/totp.ts。
const M0005_TOTP = `
ALTER TABLE users ADD COLUMN totp_secret_encrypted TEXT;

ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS totp_backup_codes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  TEXT    NOT NULL,
  used_at    INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_totp_backup_user ON totp_backup_codes(user_id);
`;

// 0006：Passkey / WebAuthn 凭证。无密码登录 + 已登录用户可绑多枚凭证。
// credential_id（base64url，浏览器返回的凭证 ID）全局唯一——无密码登录时靠它反查 user_id。
// public_key 存 base64url(COSE 公钥字节)；counter 每次认证后更新（防克隆重放）。
// transports 为 JSON 数组（['internal','usb'…]，认证时给浏览器提示）；name 是用户可读标签。
// 只做 DDL；不回填（新表，老用户自然为「无 Passkey」）。见 shared/routes.ts Passkey 端点。
const M0006_WEBAUTHN = `
CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT    NOT NULL UNIQUE,
  public_key    TEXT    NOT NULL,
  counter       INTEGER NOT NULL DEFAULT 0,
  transports    TEXT,
  name          TEXT,
  created_at    INTEGER NOT NULL,
  last_used_at  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_webauthn_user ON webauthn_credentials(user_id);
`;

// 顺序即应用序。
export const MIGRATIONS: Migration[] = [
  { version: '0001_init', sql: M0001_INIT },
  { version: '0002_multiuser', sql: M0002_MULTIUSER },
  { version: '0003_probe', sql: M0003_PROBE },
  { version: '0004_group_label', sql: M0004_GROUP_LABEL },
  { version: '0005_totp', sql: M0005_TOTP },
  { version: '0006_webauthn', sql: M0006_WEBAUTHN },
];
