CREATE TABLE IF NOT EXISTS app_state (
  collection TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO app_state (collection, value, updated_at) VALUES
  ('canvases', '[]', datetime('now')),
  ('conversations', '[]', datetime('now')),
  ('runs', '[]', datetime('now')),
  ('fragments', '[]', datetime('now')),
  ('tasks', '[]', datetime('now'));
