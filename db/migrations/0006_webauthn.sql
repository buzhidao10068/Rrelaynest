-- 0006_webauthn：Passkey / WebAuthn 无密码登录凭证。
-- 每用户可注册多枚（多设备）。credential_id 为浏览器返回的凭证 ID（base64url，全局唯一）；
-- public_key 为 COSE 公钥字节的 base64url；counter 是签名计数器（每次认证后更新，防克隆重放）；
-- transports 是 JSON 数组（['internal','usb'…]，认证时提示）；name 用户可读标签（可空）；
-- last_used_at 最近一次认证时间。只做 DDL；不回填（新表，老用户自然为「无 Passkey」）。
-- 见 src/shared/routes.ts Passkey 端点。
--
-- 执行方式：migrate.ts 把本文件按 ';' 拆成单条语句，在一个事务(batch)内顺序执行。

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
