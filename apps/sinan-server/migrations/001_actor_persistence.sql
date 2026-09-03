-- actor persistence (SQLite, WAL mode)
-- Minimal schema: actor_config + actor_event.
-- Checkpoints and processed-event records are intentionally omitted for now.

CREATE TABLE actor_config (
  id          TEXT    PRIMARY KEY,
  config_json TEXT    NOT NULL,
  state_kind  TEXT    NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX idx_actor_config_state ON actor_config(state_kind);

CREATE TABLE actor_event (
  actor_id    TEXT    NOT NULL,
  sequence    INTEGER NOT NULL,
  event_id    TEXT    NOT NULL,
  event_json  TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (actor_id, sequence)
);

CREATE UNIQUE INDEX idx_event_id ON actor_event(event_id);
