-- Add the actor creation timestamp to databases created by migration 001.
-- SQLite cannot add a NOT NULL column without a default and cannot alter a
-- column constraint in place, so rebuild the small configuration table.

CREATE TABLE actor_config_with_created_at (
  id          TEXT    PRIMARY KEY,
  config_json TEXT    NOT NULL,
  state_kind  TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

INSERT INTO actor_config_with_created_at (id, config_json, state_kind, created_at, updated_at)
SELECT id, config_json, state_kind, updated_at, updated_at
FROM actor_config;

DROP TABLE actor_config;
ALTER TABLE actor_config_with_created_at RENAME TO actor_config;

CREATE INDEX idx_actor_config_state ON actor_config(state_kind);
