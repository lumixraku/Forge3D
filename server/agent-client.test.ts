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
      runAgentViaService({ serviceUrl: 'http://agent.test/agent', turnId: 'turn-1', apiKey: 'secret', message: 'stop', canvas: { id: 'canvas-1' } }),
      (error: any) => error.name === 'AbortError',
    )
    assert.equal(body.turnId, 'turn-1')
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
    assert.deepEqual(request, { url: 'http://agent.test/agent/cancel', body: { turnId: 'turn-2' } })
  } finally {
    globalThis.fetch = originalFetch
  }
})
