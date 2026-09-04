-- actor persistence (SQLite, WAL mode)
-- 最小子集: actor_config + actor_event
-- 不含 checkpoint 表 (恢复从 sequence=0 重放) 与 processed 表 (内存去重)

CREATE TABLE actor_config (
  id              TEXT    PRIMARY KEY,
  config_json     TEXT    NOT NULL,
  state_kind      TEXT    NOT NULL,                 -- 当前状态; 由持久化层从最新 state-changed 事件提取
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_actor_config_state ON actor_config(state_kind);

CREATE TABLE actor_event (
  actor_id        TEXT    NOT NULL,
  sequence        INTEGER NOT NULL,                 -- per-actor 单调
  event_id        TEXT    NOT NULL,
  event_json      TEXT    NOT NULL,
  created_at      INTEGER NOT NULL,
  PRIMARY KEY (actor_id, sequence)
);
CREATE UNIQUE INDEX idx_event_id ON actor_event(event_id);

-- 连接初始化时执行:
--   PRAGMA journal_mode = WAL;
--   PRAGMA foreign_keys = ON;