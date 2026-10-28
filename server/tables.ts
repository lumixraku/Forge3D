// Column layout for each domain table, shared by the local SQLite store and the
// D1 Worker store so the two cannot drift apart. Each entry maps an in-memory
// field to its column. `json` columns hold nested data (graphs, messages, run
// details); everything else is a plain scalar column.

const LEGACY_OWNER_ID = 'demo-user'

type Kind = 'text' | 'int' | 'bool' | 'json' | 'time'
type Column = [column: string, field: string, kind: Kind]

export const tableColumns: Record<string, { table: string; orderBy: string; columns: Column[] }> = {
  canvases: {
    table: 'canvases',
    orderBy: 'updated_at, id',
    columns: [
      ['id', 'id', 'text'],
      ['owner_id', 'ownerId', 'text'],
      ['name', 'name', 'text'],
      ['description', 'description', 'text'],
      ['provider', 'provider', 'text'],
      ['schema_version', 'schemaVersion', 'text'],
      ['revision', 'revision', 'int'],
      ['nodes', 'nodes', 'json'],
      ['edges', 'edges', 'json'],
      ['wire_ties', 'wireTies', 'json'],
      ['viewport', 'viewport', 'json'],
      ['created_at', 'createdAt', 'time'],
      ['updated_at', 'updatedAt', 'time'],
    ],
  },
  sessions: {
    table: 'sessions',
    orderBy: 'updated_at, id',
    columns: [
      ['id', 'id', 'text'],
      ['canvas_id', 'canvasId', 'text'],
      ['messages', 'messages', 'json'],
      ['created_at', 'createdAt', 'time'],
      ['updated_at', 'updatedAt', 'time'],
    ],
  },
  runs: {
    table: 'runs',
    orderBy: 'created_at, id',
    columns: [
      ['id', 'id', 'text'],
      ['canvas_id', 'canvasId', 'text'],
      ['status', 'status', 'text'],
      ['mode', 'mode', 'text'],
      ['entry_node_id', 'entryNodeId', 'text'],
      ['entry_node_type', 'entryNodeType', 'text'],
      ['entry_node_name', 'entryNodeName', 'text'],
      ['canvas_revision', 'canvasRevision', 'int'],
      ['idempotency_key', 'idempotencyKey', 'text'],
      ['cancel_requested', 'cancelRequested', 'bool'],
      ['node_ids', 'nodeIds', 'json'],
      ['parameters', 'parameters', 'json'],
      ['input', 'input', 'json'],
      ['node_runs', 'nodeRuns', 'json'],
      ['created_at', 'createdAt', 'time'],
      ['completed_at', 'completedAt', 'time'],
    ],
  },
  turns: {
    table: 'turns',
    orderBy: 'updated_at, id',
    columns: [
      ['id', 'id', 'text'],
      ['canvas_id', 'canvasId', 'text'],
      ['session_id', 'sessionId', 'text'],
      ['status', 'status', 'text'],
      ['message', 'message', 'text'],
      ['client_id', 'clientId', 'text'],
      ['trace_id', 'traceId', 'text'],
      ['attempt', 'attempt', 'int'],
      ['attachments', 'attachments', 'json'],
      ['progress', 'progress', 'json'],
      ['request', 'request', 'json'],
      ['selection', 'selection', 'json'],
      ['result', 'result', 'json'],
      ['error', 'error', 'text'],
      ['created_at', 'createdAt', 'time'],
      ['started_at', 'startedAt', 'time'],
      ['updated_at', 'updatedAt', 'time'],
      ['completed_at', 'completedAt', 'time'],
      ['interrupted_at', 'interruptedAt', 'time'],
      ['resume_count', 'resumeCount', 'int'],
      ['request_message_id', 'requestMessageId', 'text'],
    ],
  },
  agentTraces: {
    table: 'agent_traces',
    orderBy: 'updated_at, id',
    columns: [
      ['id', 'id', 'text'],
      ['turn_id', 'turnId', 'text'],
      ['canvas_id', 'canvasId', 'text'],
      ['session_id', 'sessionId', 'text'],
      ['status', 'status', 'text'],
      ['provider', 'provider', 'text'],
      ['model', 'model', 'text'],
      ['runtime', 'runtime', 'text'],
      ['attempt', 'attempt', 'int'],
      ['resume_count', 'resumeCount', 'int'],
      ['events', 'events', 'json'],
      ['checkpoint', 'checkpoint', 'json'],
      ['created_at', 'createdAt', 'time'],
      ['updated_at', 'updatedAt', 'time'],
      ['completed_at', 'completedAt', 'time'],
    ],
  },
  accounts: {
    table: 'accounts',
    orderBy: 'id',
    columns: [
      ['id', 'id', 'text'],
      ['name', 'name', 'text'],
      ['balance', 'balance', 'int'],
    ],
  },
  creditLedger: {
    table: 'credit_ledger',
    orderBy: 'created_at, id',
    columns: [
      ['id', 'id', 'text'],
      ['account_id', 'accountId', 'text'],
      ['run_id', 'runId', 'text'],
      ['type', 'type', 'text'],
      ['amount', 'amount', 'int'],
      ['created_at', 'createdAt', 'time'],
    ],
  },
}

// Fields whose absence is stored as SQL NULL but read back as `null` rather
// than dropped, because the core distinguishes "not finished" from "missing".
const keepNull = new Set(['runs.completedAt'])

/**
 * Turns a database row into the in-memory record. `parseJson` is true when JSON
 * columns come back as text, which is how SQLite and D1 return them.
 */
export function rowToRecord(collection: string, row: Record<string, unknown>, parseJson: boolean) {
  const record: Record<string, unknown> = {}
  for (const [column, field, kind] of tableColumns[collection].columns) {
    let value = row[column]
    if (value === null || value === undefined) {
      if (keepNull.has(`${collection}.${field}`)) record[field] = null
      continue
    }
    if (kind === 'json' && parseJson && typeof value === 'string') value = JSON.parse(value)
    else if (kind === 'bool') value = Boolean(value)
    else if (kind === 'time' && value instanceof Date) value = value.toISOString()
    record[field] = value
  }
  if (collection === 'runs') record.projectId = record.canvasId
  if (collection === 'canvases' && !record.ownerId) record.ownerId = LEGACY_OWNER_ID
  // A canvas without wire ties stores no field, so it round-trips unchanged.
  if (collection === 'canvases' && Array.isArray(record.wireTies) && !record.wireTies.length) delete record.wireTies
  return record
}

// NOT NULL columns a record may legitimately omit.
const notNullDefaults: Record<string, unknown> = {
  'canvases.description': '',
  'canvases.schemaVersion': '1.0',
  'canvases.revision': 1,
  'canvases.nodes': [],
  'canvases.edges': [],
  'canvases.wireTies': [],
  'canvases.viewport': { x: 0, y: 0, zoom: 1 },
  'sessions.messages': [],
  'agentTraces.events': [],
}

/** Column values for one record, in `tableColumns` order. */
export function recordToValues(collection: string, record: Record<string, any>, { boolAsInt = false } = {}) {
  return tableColumns[collection].columns.map(([, field, kind]) => {
    let value = record[field]
    if (collection === 'canvases' && field === 'ownerId') value ||= LEGACY_OWNER_ID
    if ((value === undefined || value === null) && notNullDefaults[`${collection}.${field}`] !== undefined) value = notNullDefaults[`${collection}.${field}`]
    if (kind === 'bool') return boolAsInt ? (value ? 1 : 0) : Boolean(value)
    if (value === undefined || value === null) return null
    return kind === 'json' ? JSON.stringify(value) : value
  })
}
