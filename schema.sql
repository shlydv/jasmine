-- Jasmine Residency single-household data store.
-- Run once against the production D1 database before using cloud sync.

CREATE TABLE IF NOT EXISTS app_data (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

-- Private attachments are stored separately from the tenant/billing JSON.
CREATE TABLE IF NOT EXISTS attachments (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL,
 digest TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS attachment_chunks (
 file_id TEXT NOT NULL REFERENCES attachments(id), part INTEGER NOT NULL, data BLOB NOT NULL,
 PRIMARY KEY(file_id, part)
);
