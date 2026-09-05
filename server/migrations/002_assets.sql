CREATE TABLE IF NOT EXISTS forge3d_assets (
  asset_id TEXT PRIMARY KEY,
  content_type TEXT NOT NULL,
  bytes BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
