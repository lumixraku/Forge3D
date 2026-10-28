-- Wire ties: pins a few wires are routed through.

ALTER TABLE canvases ADD COLUMN wire_ties TEXT NOT NULL DEFAULT '[]';
