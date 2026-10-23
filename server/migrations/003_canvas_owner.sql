-- Every canvas belongs to one visitor. Canvases created before visitors existed
-- were shared by everyone through the single demo account, so they go to it.
ALTER TABLE forge3d_documents ADD COLUMN IF NOT EXISTS owner_id TEXT;

UPDATE forge3d_documents
  SET owner_id = COALESCE(NULLIF(document->>'ownerId', ''), 'demo-user')
  WHERE collection = 'canvases' AND owner_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'forge3d_documents_canvas_owner_check') THEN
    ALTER TABLE forge3d_documents
      ADD CONSTRAINT forge3d_documents_canvas_owner_check CHECK (collection <> 'canvases' OR owner_id IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS forge3d_documents_owner_idx
  ON forge3d_documents (collection, owner_id);
