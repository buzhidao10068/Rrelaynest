-- 0003_probe：测活词池 + 站点绑定词。
-- probe_words 每用户隔离（UNIQUE(user_id, text)）；sites 加 probe_text（单站绑定的测活词，
-- 空/NULL = 跟随全局）。全局默认词与开关走每用户 settings（probe_global_text /
-- probe_global_enabled），故此处只建表/加列，不塞 settings（由入口按需 seed）。
-- 只做 DDL；不回填（新列可空，老数据自然为 NULL = 跟随全局）。见 memory activity-probe-backend-todo。
--
-- 执行方式：migrate.ts 把本文件按 ';' 拆成单条语句，在一个事务(batch)内顺序执行。

-- 1) 测活词池：text 为「发给模型的一句话」（渠道测试用），非模型名。每用户隔离，(user_id, text) 唯一。
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

-- 2) 站点单站绑定的测活词（空/NULL = 跟随全局默认词）。SQLite ADD COLUMN 默认 NULL，满足限制。
ALTER TABLE sites ADD COLUMN probe_text TEXT;
