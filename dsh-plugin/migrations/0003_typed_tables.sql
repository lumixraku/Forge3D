-- One table per domain, matching the local PostgreSQL store. Scalar fields
-- become columns. Nested graphs, messages, and run details stay as JSON text.
-- Existing rows in forge3d_documents are copied over; that table is left as a backup.

CREATE TABLE IF NOT EXISTS canvases (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL,
  schema_version TEXT NOT NULL DEFAULT '1.0',
  revision INTEGER NOT NULL DEFAULT 1,
  nodes TEXT NOT NULL DEFAULT '[]',
  edges TEXT NOT NULL DEFAULT '[]',
  viewport TEXT NOT NULL DEFAULT '{"x":0,"y":0,"zoom":1}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS canvases_owner_updated_idx ON canvases (owner_id, updated_at);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  canvas_id TEXT NOT NULL,
  messages TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
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
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  node_ids TEXT,
  parameters TEXT,
  input TEXT,
  node_runs TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
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
  attachments TEXT,
  progress TEXT,
  request TEXT,
  selection TEXT,
  result TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  interrupted_at TEXT,
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
  events TEXT NOT NULL DEFAULT '[]',
  checkpoint TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
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
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS credit_ledger_account_idx ON credit_ledger (account_id);

INSERT OR IGNORE INTO canvases (id, owner_id, name, description, provider, schema_version, revision, nodes, edges, viewport, created_at, updated_at)
SELECT
  document_id,
  COALESCE(owner_id, json_extract(document, '$.ownerId'), 'demo-user'),
  COALESCE(json_extract(document, '$.name'), ''),
  COALESCE(json_extract(document, '$.description'), ''),
  COALESCE(json_extract(document, '$.provider'), 'meshy'),
  COALESCE(json_extract(document, '$.schemaVersion'), '1.0'),
  COALESCE(json_extract(document, '$.revision'), 1),
  COALESCE(json_extract(document, '$.nodes'), '[]'),
  COALESCE(json_extract(document, '$.edges'), '[]'),
  COALESCE(json_extract(document, '$.viewport'), '{"x":0,"y":0,"zoom":1}'),
  COALESCE(json_extract(document, '$.createdAt'), updated_at),
  COALESCE(json_extract(document, '$.updatedAt'), updated_at)
FROM forge3d_documents
WHERE collection = 'canvases';

INSERT OR IGNORE INTO sessions (id, canvas_id, messages, created_at, updated_at)
SELECT
  document_id,
  COALESCE(json_extract(document, '$.canvasId'), ''),
  COALESCE(json_extract(document, '$.messages'), '[]'),
  COALESCE(json_extract(document, '$.createdAt'), updated_at),
  COALESCE(json_extract(document, '$.updatedAt'), updated_at)
FROM forge3d_documents
WHERE collection = 'sessions';

INSERT OR IGNORE INTO runs (id, canvas_id, status, mode, entry_node_id, entry_node_type, entry_node_name, canvas_revision, idempotency_key, cancel_requested, node_ids, parameters, input, node_runs, created_at, completed_at)
SELECT
  document_id,
  COALESCE(json_extract(document, '$.canvasId'), json_extract(document, '$.projectId'), ''),
  COALESCE(json_extract(document, '$.status'), 'queued'),
  json_extract(document, '$.mode'),
  json_extract(document, '$.entryNodeId'),
  json_extract(document, '$.entryNodeType'),
  json_extract(document, '$.entryNodeName'),
  json_extract(document, '$.canvasRevision'),
  json_extract(document, '$.idempotencyKey'),
  COALESCE(json_extract(document, '$.cancelRequested'), 0),
  json_extract(document, '$.nodeIds'),
  json_extract(document, '$.parameters'),
  json_extract(document, '$.input'),
  json_extract(document, '$.nodeRuns'),
  COALESCE(json_extract(document, '$.createdAt'), updated_at),
  json_extract(document, '$.completedAt')
FROM forge3d_documents
WHERE collection = 'runs';

INSERT OR IGNORE INTO turns (id, canvas_id, session_id, status, message, client_id, trace_id, attempt, attachments, progress, request, selection, result, error, created_at, started_at, updated_at, completed_at, interrupted_at, resume_count, request_message_id)
SELECT
  document_id,
  COALESCE(json_extract(document, '$.canvasId'), ''),
  json_extract(document, '$.sessionId'),
  COALESCE(json_extract(document, '$.status'), 'queued'),
  json_extract(document, '$.message'),
  json_extract(document, '$.clientId'),
  json_extract(document, '$.traceId'),
  json_extract(document, '$.attempt'),
  json_extract(document, '$.attachments'),
  json_extract(document, '$.progress'),
  json_extract(document, '$.request'),
  json_extract(document, '$.selection'),
  json_extract(document, '$.result'),
  json_extract(document, '$.error'),
  COALESCE(json_extract(document, '$.createdAt'), updated_at),
  json_extract(document, '$.startedAt'),
  COALESCE(json_extract(document, '$.updatedAt'), updated_at),
  json_extract(document, '$.completedAt'),
  json_extract(document, '$.interruptedAt'),
  json_extract(document, '$.resumeCount'),
  json_extract(document, '$.requestMessageId')
FROM forge3d_documents
WHERE collection = 'turns';

INSERT OR IGNORE INTO agent_traces (id, turn_id, canvas_id, session_id, status, provider, model, runtime, attempt, resume_count, events, checkpoint, created_at, updated_at, completed_at)
SELECT
  document_id,
  COALESCE(json_extract(document, '$.turnId'), ''),
  json_extract(document, '$.canvasId'),
  json_extract(document, '$.sessionId'),
  json_extract(document, '$.status'),
  json_extract(document, '$.provider'),
  json_extract(document, '$.model'),
  json_extract(document, '$.runtime'),
  json_extract(document, '$.attempt'),
  json_extract(document, '$.resumeCount'),
  COALESCE(json_extract(document, '$.events'), '[]'),
  json_extract(document, '$.checkpoint'),
  COALESCE(json_extract(document, '$.createdAt'), updated_at),
  COALESCE(json_extract(document, '$.updatedAt'), updated_at),
  json_extract(document, '$.completedAt')
FROM forge3d_documents
WHERE collection = 'agentTraces';

INSERT OR IGNORE INTO accounts (id, name, balance)
SELECT
  document_id,
  COALESCE(json_extract(document, '$.name'), 'Visitor'),
  COALESCE(json_extract(document, '$.balance'), 0)
FROM forge3d_documents
WHERE collection = 'accounts';

INSERT OR IGNORE INTO credit_ledger (id, account_id, run_id, type, amount, created_at)
SELECT
  document_id,
  COALESCE(json_extract(document, '$.accountId'), ''),
  json_extract(document, '$.runId'),
  COALESCE(json_extract(document, '$.type'), ''),
  COALESCE(json_extract(document, '$.amount'), 0),
  COALESCE(json_extract(document, '$.createdAt'), updated_at)
FROM forge3d_documents
WHERE collection = 'creditLedger';
