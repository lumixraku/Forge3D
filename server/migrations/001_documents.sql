CREATE TABLE IF NOT EXISTS forge3d_documents (
  collection TEXT NOT NULL,
  document_id TEXT NOT NULL,
  document JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (collection, document_id)
);

CREATE INDEX IF NOT EXISTS forge3d_documents_collection_updated_idx
  ON forge3d_documents (collection, updated_at DESC);
