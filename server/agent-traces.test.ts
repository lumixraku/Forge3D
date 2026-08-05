import assert from 'node:assert/strict'
import test from 'node:test'
import { appendAgentTrace, checkpointAgentTrace, createAgentTrace } from './agent-traces.js'

test('agent traces sequence events, redact secrets, and retain resumable checkpoints', () => {
  const trace = createAgentTrace({ id: 'turn-1', sessionId: 'session-1', canvasId: 'canvas-1' }, { model: 'deepseek-chat' }, '2026-08-04T00:00:00.000Z')
  appendAgentTrace(trace, 'model_request_started', {
    authorization: 'Bearer secret',
    nested: { apiKey: 'secret', prompt: 'safe' },
  }, '2026-08-04T00:00:01.000Z')
  appendAgentTrace(trace, 'tool_call_succeeded', { result: 'ok' }, '2026-08-04T00:00:02.000Z')
  checkpointAgentTrace(trace, { phase: 'tool_complete', round: 1, canvas: { id: 'canvas-1' } }, '2026-08-04T00:00:03.000Z')

  assert.deepEqual(trace.events.map((event) => event.seq), [1, 2])
  assert.equal(trace.events[0].payload.authorization, '[redacted]')
  assert.equal(trace.events[0].payload.nested.apiKey, '[redacted]')
  assert.equal(trace.events[0].payload.nested.prompt, 'safe')
  assert.equal(trace.checkpoint.phase, 'tool_complete')
  assert.equal(trace.updatedAt, '2026-08-04T00:00:03.000Z')
})
