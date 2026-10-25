-- Wire ties: pins a few wires are routed through.

ALTER TABLE canvases ADD COLUMN IF NOT EXISTS wire_ties JSONB NOT NULL DEFAULT '[]'::jsonb;
