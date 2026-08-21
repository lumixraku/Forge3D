import assert from 'node:assert/strict'
import test from 'node:test'
import { cancelAgentViaService, runAgentViaService } from './agent-client.js'

test('passes the turn id to the agent service and surfaces cancellation', async () => {
  const originalFetch = globalThis.fetch
  let body: any
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(String(init?.body))
    return new Response('{"type":"cancelled"}\n', {
      headers: { 'content-type': 'application/x-ndjson' },
    })
  }

  try {
    await assert.rejects(
      runAgentViaService({ serviceUrl: 'http://agent.test/agent', turnId: 'turn-1', apiKey: 'secret', message: 'stop', canvas: { id: 'canvas-1' }, account: { balance: 1000, executionCost: 10 } }),
      (error: any) => error.name === 'AbortError',
    )
    assert.equal(body.turnId, 'turn-1')
    assert.deepEqual(body.account, { balance: 1000, executionCost: 10 })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('calls the agent service cancel endpoint for a turn', async () => {
  const originalFetch = globalThis.fetch
  let request: { url?: string; body?: any } = {}
  globalThis.fetch = async (url, init) => {
    request = { url: String(url), body: JSON.parse(String(init?.body)) }
    return Response.json({ cancelled: true })
  }

  try {
    await cancelAgentViaService('http://agent.test/agent', 'turn-2')
    assert.deepEqual(request, { url: 'http://agent.test/agent/cancel', body: { taskId: 'turn-2', turnId: 'turn-2' } })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('streams trace and checkpoint events and forwards a resume checkpoint', async () => {
  const originalFetch = globalThis.fetch
  const trace: any[] = []
  const checkpoints: any[] = []
  let body: any
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(String(init?.body))
    return new Response([
      JSON.stringify({ type: 'trace', event: { type: 'tool_call_succeeded', payload: { toolName: 'build_canvas' } } }),
      JSON.stringify({ type: 'checkpoint', checkpoint: { phase: 'tool_complete', round: 1 } }),
      JSON.stringify({ type: 'result', plan: { canvas: { id: 'canvas-1' }, reply: 'resumed' } }),
      '',
    ].join('\n'))
  }

  try {
    const checkpoint = { phase: 'tool_complete', round: 1 }
    const result = await runAgentViaService({
      serviceUrl: 'http://agent.test/agent',
      turnId: 'turn-3',
      apiKey: 'secret',
      message: 'continue',
      canvas: { id: 'canvas-1' },
      checkpoint,
      onTrace: (event) => trace.push(event),
      onCheckpoint: (value) => checkpoints.push(value),
    })
    assert.deepEqual(body.checkpoint, checkpoint)
    assert.equal(result.reply, 'resumed')
    assert.equal(trace[0].type, 'tool_call_succeeded')
    assert.deepEqual(checkpoints, [checkpoint])
  } finally {
    globalThis.fetch = originalFetch
  }
})
