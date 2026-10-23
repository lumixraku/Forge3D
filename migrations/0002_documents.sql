-- Same layout as the local PostgreSQL store (server/migrations): one row per
-- document, with canvas ownership in a real, indexed column. The old app_state
-- table is left untouched and no longer read.
CREATE TABLE IF NOT EXISTS forge3d_documents (
  collection TEXT NOT NULL,
  document_id TEXT NOT NULL,
  document TEXT NOT NULL,
  owner_id TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (collection, document_id),
  CHECK (collection <> 'canvases' OR owner_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS forge3d_documents_collection_updated_idx
  ON forge3d_documents (collection, updated_at);

CREATE INDEX IF NOT EXISTS forge3d_documents_owner_idx
  ON forge3d_documents (collection, owner_id);
