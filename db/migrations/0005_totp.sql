-- 0005_totp：两步验证（TOTP）。
-- users 加 totp_secret_encrypted（AES-GCM 密文，NULL=未设置）+ totp_enabled（0/1，
-- 仅在验过一次码后置 1，避免误锁）。备份码单独一张表：丢验证器时的唯一自救途径
-- （尤其 admin，否则永久锁死），每码单向哈希存储、用后即焚（used_at）。
-- 只做 DDL；不回填（新列可空/默认，老用户自然为「未启用 2FA」）。见 src/shared/totp.ts。
--
-- 执行方式：migrate.ts 把本文件按 ';' 拆成单条语句，在一个事务(batch)内顺序执行。

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
