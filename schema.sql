-- Jasmine Residency single-household data store.
-- Run once against the production D1 database before using cloud sync.

CREATE TABLE IF NOT EXISTS app_data (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);
