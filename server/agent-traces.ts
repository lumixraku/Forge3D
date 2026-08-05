import { randomUUID } from './ids.js'

export function createAgentTrace(turn, config = {}, now = new Date().toISOString()) {
  return {
    id: `trace-${randomUUID()}`,
    turnId: turn.id,
    sessionId: turn.sessionId,
    canvasId: turn.canvasId,
    provider: 'deepseek',
    model: config.model || 'deepseek-chat',
    runtime: config.runtime || 'direct',
    status: 'queued',
    attempt: 0,
    resumeCount: 0,
    createdAt: now,
    updatedAt: now,
    events: [],
  }
}

export function appendAgentTrace(trace, type, payload = {}, now = new Date().toISOString()) {
  const safePayload = sanitizeTraceValue(payload)
  const event = {
    id: `trace-event-${randomUUID()}`,
    seq: (trace.events.at(-1)?.seq || 0) + 1,
    type,
    timestamp: now,
    payload: safePayload,
  }
  trace.events.push(event)
  trace.updatedAt = now
  return event
}

export function checkpointAgentTrace(trace, checkpoint, now = new Date().toISOString()) {
  trace.checkpoint = { ...structuredClone(checkpoint), updatedAt: now }
  trace.updatedAt = now
  return trace.checkpoint
}

export function sanitizeAgentError(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || String(error),
    status: error?.status,
  }
}

function sanitizeTraceValue(value, depth = 0) {
  if (depth > 8) return '[truncated]'
  if (typeof value === 'string') return value.length > 20000 ? `${value.slice(0, 20000)}...[truncated]` : value
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => sanitizeTraceValue(item, depth + 1))
  if (!value || typeof value !== 'object') return value
  const sanitized = {}
  for (const [key, item] of Object.entries(value)) {
    if (/^(authorization|api[-_]?key|token|secret)$/i.test(key)) sanitized[key] = '[redacted]'
    else sanitized[key] = sanitizeTraceValue(item, depth + 1)
  }
  return sanitized
}
