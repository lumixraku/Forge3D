-- Split the generic document table into one table per domain. Scalar fields
-- become columns. Nested graphs, messages, and run details stay as JSON.
-- Existing rows are copied over; forge3d_documents is left as a backup.

CREATE TABLE IF NOT EXISTS canvases (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL,
  schema_version TEXT NOT NULL DEFAULT '1.0',
  revision INTEGER NOT NULL DEFAULT 1,
  nodes JSONB NOT NULL DEFAULT '[]'::jsonb,
  edges JSONB NOT NULL DEFAULT '[]'::jsonb,
  viewport JSONB NOT NULL DEFAULT '{"x":0,"y":0,"zoom":1}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS canvases_owner_updated_idx ON canvases (owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  canvas_id TEXT NOT NULL,
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_canvas_idx ON sessions (canvas_id);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  canvas_id TEXT NOT NULL,
  status TEXT NOT NULL,
  mode TEXT,
  entry_node_id TEXT,
  entry_node_type TEXT,
  entry_node_name TEXT,
  canvas_revision INTEGER,
  idempotency_key TEXT,
  cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
  node_ids JSONB,
  parameters JSONB,
  input JSONB,
  node_runs JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS runs_canvas_idx ON runs (canvas_id);

CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  canvas_id TEXT NOT NULL,
  session_id TEXT,
  status TEXT NOT NULL,
  message TEXT,
  client_id TEXT,
  trace_id TEXT,
  attempt INTEGER,
  attachments JSONB,
  progress JSONB,
  request JSONB,
  selection JSONB,
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  interrupted_at TIMESTAMPTZ,
  resume_count INTEGER,
  request_message_id TEXT
);
CREATE INDEX IF NOT EXISTS turns_canvas_idx ON turns (canvas_id);
CREATE INDEX IF NOT EXISTS turns_session_idx ON turns (session_id);

CREATE TABLE IF NOT EXISTS agent_traces (
  id TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL,
  canvas_id TEXT,
  session_id TEXT,
  status TEXT,
  provider TEXT,
  model TEXT,
  runtime TEXT,
  attempt INTEGER,
  resume_count INTEGER,
  events JSONB NOT NULL DEFAULT '[]'::jsonb,
  checkpoint JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS agent_traces_turn_idx ON agent_traces (turn_id);
CREATE INDEX IF NOT EXISTS agent_traces_canvas_idx ON agent_traces (canvas_id);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  balance INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS credit_ledger (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  run_id TEXT,
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS credit_ledger_account_idx ON credit_ledger (account_id);

CREATE TABLE IF NOT EXISTS forge3d_schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The server runs every migration file on each start, so the one-time copy from
-- forge3d_documents is guarded; otherwise a deleted record would come back.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM forge3d_schema_migrations WHERE name = '004_typed_tables') THEN
INSERT INTO canvases (id, owner_id, name, description, provider, schema_version, revision, nodes, edges, viewport, created_at, updated_at)
SELECT
  document_id,
  COALESCE(owner_id, NULLIF(document->>'ownerId', ''), 'demo-user'),
  COALESCE(document->>'name', ''),
  COALESCE(document->>'description', ''),
  COALESCE(document->>'provider', 'meshy'),
  COALESCE(document->>'schemaVersion', '1.0'),
  COALESCE((document->>'revision')::integer, 1),
  COALESCE(document->'nodes', '[]'::jsonb),
  COALESCE(document->'edges', '[]'::jsonb),
  COALESCE(document->'viewport', '{"x":0,"y":0,"zoom":1}'::jsonb),
  COALESCE((document->>'createdAt')::timestamptz, updated_at),
  COALESCE((document->>'updatedAt')::timestamptz, updated_at)
FROM forge3d_documents
WHERE collection = 'canvases'
ON CONFLICT (id) DO NOTHING;

INSERT INTO sessions (id, canvas_id, messages, created_at, updated_at)
SELECT
  document_id,
  COALESCE(document->>'canvasId', ''),
  COALESCE(document->'messages', '[]'::jsonb),
  COALESCE((document->>'createdAt')::timestamptz, updated_at),
  COALESCE((document->>'updatedAt')::timestamptz, updated_at)
FROM forge3d_documents
WHERE collection = 'sessions'
ON CONFLICT (id) DO NOTHING;

INSERT INTO runs (id, canvas_id, status, mode, entry_node_id, entry_node_type, entry_node_name, canvas_revision, idempotency_key, cancel_requested, node_ids, parameters, input, node_runs, created_at, completed_at)
SELECT
  document_id,
  COALESCE(document->>'canvasId', document->>'projectId', ''),
  COALESCE(document->>'status', 'queued'),
  document->>'mode',
  document->>'entryNodeId',
  document->>'entryNodeType',
  document->>'entryNodeName',
  (document->>'canvasRevision')::integer,
  document->>'idempotencyKey',
  COALESCE((document->>'cancelRequested')::boolean, FALSE),
  document->'nodeIds',
  document->'parameters',
  document->'input',
  document->'nodeRuns',
  COALESCE((document->>'createdAt')::timestamptz, updated_at),
  (document->>'completedAt')::timestamptz
FROM forge3d_documents
WHERE collection = 'runs'
ON CONFLICT (id) DO NOTHING;

INSERT INTO turns (id, canvas_id, session_id, status, message, client_id, trace_id, attempt, attachments, progress, request, selection, result, error, created_at, started_at, updated_at, completed_at, interrupted_at, resume_count, request_message_id)
SELECT
  document_id,
  COALESCE(document->>'canvasId', ''),
  document->>'sessionId',
  COALESCE(document->>'status', 'queued'),
  document->>'message',
  document->>'clientId',
  document->>'traceId',
  (document->>'attempt')::integer,
  document->'attachments',
  document->'progress',
  document->'request',
  document->'selection',
  document->'result',
  document->>'error',
  COALESCE((document->>'createdAt')::timestamptz, updated_at),
  (document->>'startedAt')::timestamptz,
  COALESCE((document->>'updatedAt')::timestamptz, updated_at),
  (document->>'completedAt')::timestamptz,
  (document->>'interruptedAt')::timestamptz,
  (document->>'resumeCount')::integer,
  document->>'requestMessageId'
FROM forge3d_documents
WHERE collection = 'turns'
ON CONFLICT (id) DO NOTHING;

INSERT INTO agent_traces (id, turn_id, canvas_id, session_id, status, provider, model, runtime, attempt, resume_count, events, checkpoint, created_at, updated_at, completed_at)
SELECT
  document_id,
  COALESCE(document->>'turnId', ''),
  document->>'canvasId',
  document->>'sessionId',
  document->>'status',
  document->>'provider',
  document->>'model',
  document->>'runtime',
  (document->>'attempt')::integer,
  (document->>'resumeCount')::integer,
  COALESCE(document->'events', '[]'::jsonb),
  document->'checkpoint',
  COALESCE((document->>'createdAt')::timestamptz, updated_at),
  COALESCE((document->>'updatedAt')::timestamptz, updated_at),
  (document->>'completedAt')::timestamptz
FROM forge3d_documents
WHERE collection = 'agentTraces'
ON CONFLICT (id) DO NOTHING;

INSERT INTO accounts (id, name, balance)
SELECT
  document_id,
  COALESCE(document->>'name', 'Visitor'),
  COALESCE((document->>'balance')::integer, 0)
FROM forge3d_documents
WHERE collection = 'accounts'
ON CONFLICT (id) DO NOTHING;

INSERT INTO credit_ledger (id, account_id, run_id, type, amount, created_at)
SELECT
  document_id,
  COALESCE(document->>'accountId', ''),
  document->>'runId',
  COALESCE(document->>'type', ''),
  COALESCE((document->>'amount')::integer, 0),
  COALESCE((document->>'createdAt')::timestamptz, updated_at)
FROM forge3d_documents
WHERE collection = 'creditLedger'
ON CONFLICT (id) DO NOTHING;

    INSERT INTO forge3d_schema_migrations (name) VALUES ('004_typed_tables');
  END IF;
END $$;
