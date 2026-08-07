// Characterization tests: they pin down what the HTTP API does today, so the
// route table and turn execution can be lifted into a runtime-agnostic core
// without silently changing behaviour. Nothing here asserts what the API
// *should* do - only what it already does.
//
// The real server is spawned as a child process against a temp data directory,
// which is the only way to cover the layer that server/index.ts and worker.ts
// each implement by hand.

import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const serverEntry = path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.ts')

let child
let baseUrl
let dataDirectory

// Node IDs are looked up across every canvas at once, so each fixture needs its
// own prefix or a run would report the ID as ambiguous. See the dedicated test
// below, which pins that behaviour down.
function canvasFixture(id, { prefix = id, ...overrides } = {}) {
  return {
    schemaVersion: '1.0',
    id,
    name: id,
    description: '',
    revision: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    nodes: [
      { id: `${prefix}-prompt`, type: 'prompt', name: 'Prompt', config: { text: 'a shark' }, ui: { position: { x: 0, y: 0 } } },
      { id: `${prefix}-generate-image`, type: 'generate-image', name: 'Generate Image', config: {}, ui: { position: { x: 300, y: 0 } } },
    ],
    edges: [
      { id: `${prefix}-edge-1`, source: { nodeId: `${prefix}-prompt`, port: 'output' }, target: { nodeId: `${prefix}-generate-image`, port: 'input' } },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    ...overrides,
  }
}

async function api(pathname, options) {
  const response = await fetch(new URL(pathname, baseUrl), options)
  const body = response.status === 204 ? null : await response.json()
  return { status: response.status, body }
}

async function postJson(pathname, payload) {
  return api(pathname, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

before(async () => {
  dataDirectory = await mkdtemp(path.join(tmpdir(), 'forge3d-api-'))
  await mkdir(path.join(dataDirectory, 'canvases'), { recursive: true })
  await writeFile(
    path.join(dataDirectory, 'canvases', 'canvas-fixture.json'),
    JSON.stringify(canvasFixture('canvas-fixture')),
  )
  await writeFile(path.join(dataDirectory, 'sessions.json'), JSON.stringify([
    {
      id: 'session-fixture',
      canvasId: 'canvas-fixture',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      // The bubble the request turn below is waiting on. The selection is only
      // echoed into the session when this message exists.
      messages: [
        { id: 'msg-request', role: 'assistant', content: '', turnId: 'turn-waiting', createdAt: '2026-01-01T00:00:00.000Z' },
      ],
    },
  ]))
  await writeFile(path.join(dataDirectory, 'runs.json'), '[]')
  // A running turn with a user selection request, so the continue endpoint can be exercised
  // without driving a real agent.
  await writeFile(path.join(dataDirectory, 'turns.json'), JSON.stringify([
    {
      id: 'turn-waiting',
      sessionId: 'session-fixture',
      canvasId: 'canvas-fixture',
      message: 'pick a style',
      status: 'running',
      progress: [],
      requestMessageId: 'msg-request',
      request: {
        request_id: 'request-waiting',
        prompt: 'Pick a style',
        options: [{ id: 'opt-a', label: 'Stylized' }, { id: 'opt-b', label: 'Realistic' }],
        min: 1,
        max: 1,
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ]))

  child = spawn('node', ['--import', 'tsx', serverEntry], {
    env: {
      ...process.env,
      PORT: '0',
      FORGE3D_DATA_DIR: dataDirectory,
      // Keep every run on the simulated producer and the built-in agent loop, so
      // these tests never reach a real provider.
      TRIPO_API_KEY: '',
      AGENT_SERVICE_URL: 'direct',
      DEEPSEEK_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  baseUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start in time')), 30000)
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += chunk.toString()
      const match = output.match(/API listening on (http:\/\/127\.0\.0\.1:\d+)/)
      if (match) {
        clearTimeout(timer)
        resolve(match[1])
      }
    })
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString()
      if (text.includes('Error') || text.includes('error')) {
        clearTimeout(timer)
        reject(new Error(`server failed to start: ${text}`))
      }
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`server exited with code ${code}`))
    })
  })
})

after(async () => {
  child?.kill('SIGKILL')
  if (dataDirectory) await rm(dataDirectory, { recursive: true, force: true })
})

test('rejects anything outside /api', async () => {
  assert.deepEqual(await api('/'), { status: 404, body: { error: 'Not found' } })
  assert.deepEqual(await api('/api/nope'), { status: 404, body: { error: 'Not found' } })
})

test('reports which providers it can actually run', async () => {
  const { status, body } = await api('/api/capabilities')
  assert.equal(status, 200)
  // No TRIPO_API_KEY in this environment, so only the simulated producer is up.
  assert.deepEqual(body.providers, { mock: true, tripo: false })
  assert.equal(body.defaultProvider, 'mock')
  assert.ok(Array.isArray(body.tripoNodeTypes))
})

test('lists projects as summaries without their graphs', async () => {
  const { status, body } = await api('/api/projects')
  assert.equal(status, 200)
  const project = body.find((item) => item.id === 'canvas-fixture')
  assert.ok(project)
  assert.equal(project.nodeCount, 2)
  assert.equal(project.edgeCount, 1)
  // The summary carries counts instead of the arrays themselves.
  assert.equal(project.nodes, undefined)
  assert.equal(project.edges, undefined)
})

test('reads one canvas with the node runs belonging to its revision', async () => {
  const { status, body } = await api('/api/canvases/canvas-fixture')
  assert.equal(status, 200)
  assert.equal(body.canvas.id, 'canvas-fixture')
  assert.deepEqual(body.nodeRuns, {})
  assert.deepEqual(await api('/api/canvases/missing'), { status: 404, body: { error: 'Canvas not found' } })
})

test('creating a project validates the canvas and seeds a session', async () => {
  assert.deepEqual(
    await postJson('/api/projects', { name: '  ' }),
    { status: 400, body: { error: 'Canvas name is required' } },
  )
  assert.deepEqual(
    await postJson('/api/projects', { name: 'Bad nodes', nodes: 'nope' }),
    { status: 400, body: { error: 'Canvas nodes are invalid' } },
  )
  assert.deepEqual(
    await postJson('/api/projects', {
      name: 'Dangling edge',
      nodes: [],
      edges: [{ id: 'e', source: { nodeId: 'a', port: 'o' }, target: { nodeId: 'b', port: 'i' } }],
    }),
    { status: 400, body: { error: 'Canvas edges must connect nodes inside the canvas' } },
  )

  const created = await postJson('/api/projects', { name: 'Fresh project', nodes: [], edges: [] })
  assert.equal(created.status, 201)
  assert.equal(created.body.name, 'Fresh project')
  assert.equal(created.body.revision, 1)

  // A brand new project comes with one session holding the opening message.
  const sessions = await api(`/api/canvases/${created.body.id}/sessions`)
  assert.equal(sessions.status, 200)
  assert.equal(sessions.body.length, 1)
  assert.equal(sessions.body[0].messages.length, 1)
  assert.equal(sessions.body[0].messages[0].role, 'assistant')
})

test('patching a project renames it and refuses a blank name', async () => {
  assert.deepEqual(
    await api('/api/projects/canvas-fixture', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    }),
    { status: 400, body: { error: 'Project name is required' } },
  )

  const renamed = await api('/api/projects/canvas-fixture', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '  Renamed fixture  ' }),
  })
  assert.equal(renamed.status, 200)
  assert.equal(renamed.body.name, 'Renamed fixture')

  assert.equal((await api('/api/projects/missing', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'x' }),
  })).status, 404)
})

test('PUT keeps the project identity and overwrites only the document', async () => {
  // Its own project: this replaces the whole document, which would strip the
  // shared fixture's nodes out from under the execution tests below.
  const created = await postJson('/api/projects', {
    name: 'Document target',
    description: 'original description',
    nodes: canvasFixture('z', { prefix: 'put' }).nodes,
    edges: canvasFixture('z', { prefix: 'put' }).edges,
  })
  const { body: before } = await api(`/api/canvases/${created.body.id}`)
  const saved = await api(`/api/canvases/${created.body.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...before.canvas, name: 'ignored', description: 'ignored', nodes: [], edges: [] }),
  })
  assert.equal(saved.status, 200)
  // Name and description live on the project, so a canvas save cannot change them.
  assert.equal(saved.body.name, before.canvas.name)
  assert.equal(saved.body.description, before.canvas.description)
  assert.equal(saved.body.nodes.length, 0)
  assert.equal(saved.body.createdAt, before.canvas.createdAt)
})

test('duplicating a project copies the graph and resets the revision', async () => {
  const source = await postJson('/api/projects', {
    name: 'Duplicate source',
    nodes: canvasFixture('x', { prefix: 'dup' }).nodes,
    edges: canvasFixture('x', { prefix: 'dup' }).edges,
  })
  const copy = await postJson(`/api/projects/${source.body.id}/duplicate`)
  assert.equal(copy.status, 201)
  assert.equal(copy.body.name, 'Duplicate source Copy')
  assert.equal(copy.body.revision, 1)
  assert.equal(copy.body.nodeCount, 2)
  assert.notEqual(copy.body.id, source.body.id)
  const sourceCanvas = (await api(`/api/canvases/${source.body.id}`)).body.canvas
  const copiedCanvas = (await api(`/api/canvases/${copy.body.id}`)).body.canvas
  assert.ok(copiedCanvas.nodes.every((node, index) => node.id !== sourceCanvas.nodes[index].id))
  assert.notEqual(copiedCanvas.edges[0].id, sourceCanvas.edges[0].id)
  assert.equal(copiedCanvas.edges[0].source.nodeId, copiedCanvas.nodes[0].id)
  assert.equal(copiedCanvas.edges[0].target.nodeId, copiedCanvas.nodes[1].id)

  assert.equal((await postJson('/api/projects/missing/duplicate')).status, 404)
})

test('deleting a project takes its sessions with it', async () => {
  const created = await postJson('/api/projects', { name: 'Disposable', nodes: [], edges: [] })
  const sessions = await api(`/api/canvases/${created.body.id}/sessions`)
  const sessionId = sessions.body[0].id

  assert.deepEqual(await api(`/api/projects/${created.body.id}`, { method: 'DELETE' }), { status: 204, body: null })
  assert.equal((await api(`/api/projects/${created.body.id}`)).status, 404)
  assert.equal((await api(`/api/sessions/${sessionId}/chat-history`)).status, 404)
  assert.equal((await api('/api/projects/missing', { method: 'DELETE' })).status, 404)
})

test('creating and reading a session on an existing canvas', async () => {
  const created = await postJson('/api/canvases/canvas-fixture/sessions')
  assert.equal(created.status, 201)
  assert.equal(created.body.canvasId, 'canvas-fixture')
  assert.deepEqual(created.body.messages, [])

  const history = await api(`/api/sessions/${created.body.id}/chat-history`)
  assert.equal(history.status, 200)
  assert.equal(history.body.id, created.body.id)

  assert.equal((await postJson('/api/canvases/missing/sessions')).status, 404)
  assert.equal((await api('/api/sessions/missing/chat-history')).status, 404)
})

test('posting a turn without DeepSeek configured reports it as unavailable', async () => {
  // This environment deliberately has no DEEPSEEK_API_KEY, so the turn is
  // refused before any agent work starts.
  const { status, body } = await postJson('/api/sessions/session-fixture/turns', { message: 'hello' })
  assert.equal(status, 503)
  assert.match(body.error, /DeepSeek is not configured/)
})

test('a turn requires a non-empty message, checked before the session exists', async () => {
  assert.deepEqual(
    await postJson('/api/sessions/session-fixture/turns', { message: '   ' }),
    { status: 400, body: { error: 'message is required' } },
  )
  assert.deepEqual(
    await postJson('/api/sessions/session-fixture/turns', {}),
    { status: 400, body: { error: 'message is required' } },
  )
  // Message validation runs first, so a missing session still answers 400 here.
  assert.equal((await postJson('/api/sessions/missing/turns', { message: '' })).status, 400)
})

test('listing turns filters by status and hides ones no longer in flight', async () => {
  // A turn with a selection request is listed even if no worker is active: the client needs it to
  // rebuild the pending bubble after a reload.
  const { status, body } = await api('/api/sessions/session-fixture/turns')
  assert.equal(status, 200)
  assert.deepEqual(body.map((turn) => turn.id), ['turn-waiting'])

  const filtered = await api('/api/sessions/session-fixture/turns?status=running')
  assert.deepEqual(filtered.body.map((turn) => turn.id), ['turn-waiting'])
  // A status the running turn does not have filters it back out.
  assert.deepEqual((await api('/api/sessions/session-fixture/turns?status=succeeded')).body, [])
  assert.equal((await api('/api/sessions/missing/turns')).status, 404)
})

test('a selection is validated against the parked turn request', async () => {
  // Wrong request id, unknown option, too many options, and a duplicate all fail
  // before the turn is resumed.
  assert.deepEqual(
    await postJson('/api/turns/turn-waiting/continue', { request_id: 'nope', selected_option_ids: ['opt-a'] }),
    { status: 409, body: { error: 'Turn is not waiting for this selection' } },
  )
  assert.deepEqual(
    await postJson('/api/turns/turn-waiting/continue', { request_id: 'request-waiting', selected_option_ids: ['opt-z'] }),
    { status: 400, body: { error: 'Selected options are invalid' } },
  )
  assert.deepEqual(
    await postJson('/api/turns/turn-waiting/continue', { request_id: 'request-waiting', selected_option_ids: ['opt-a', 'opt-b'] }),
    { status: 400, body: { error: 'Selected options are invalid' } },
  )
  assert.deepEqual(
    await postJson('/api/turns/turn-waiting/continue', { request_id: 'request-waiting', selected_option_ids: [] }),
    { status: 400, body: { error: 'Selected options are invalid' } },
  )
  assert.deepEqual(
    await postJson('/api/turns/turn-waiting/continue', { request_id: 'request-waiting', selected_option_ids: [42] }),
    { status: 400, body: { error: 'Selected options are invalid' } },
  )
})

test('a valid selection resumes the turn and is idempotent', async () => {
  const accepted = await postJson('/api/turns/turn-waiting/continue', {
    request_id: 'request-waiting',
    selected_option_ids: ['opt-a'],
  })
  assert.equal(accepted.status, 202)
  assert.deepEqual(accepted.body.selection, { request_id: 'request-waiting', selected_option_ids: ['opt-a'] })

  // The chosen label is echoed into the session as the user's reply.
  const history = await api('/api/sessions/session-fixture/chat-history')
  assert.ok(history.body.messages.some((message) => message.role === 'user' && message.content === 'Stylized'))

  // Replaying the same selection is a no-op rather than a second run...
  const replay = await postJson('/api/turns/turn-waiting/continue', {
    request_id: 'request-waiting',
    selected_option_ids: ['opt-a'],
  })
  assert.equal(replay.status, 200)
  // ...while changing it after the fact is refused.
  assert.deepEqual(
    await postJson('/api/turns/turn-waiting/continue', { request_id: 'request-waiting', selected_option_ids: ['opt-b'] }),
    { status: 409, body: { error: 'This selection was already submitted' } },
  )
})

test('continuing or cancelling an unknown turn is a 404', async () => {
  assert.deepEqual(
    await postJson('/api/turns/missing/continue', { request_id: 'r', selected_option_ids: [] }),
    { status: 404, body: { error: 'Turn not found' } },
  )
  assert.deepEqual(
    await postJson('/api/turns/missing/cancel'),
    { status: 404, body: { error: 'Turn not found' } },
  )
})

test('running a node executes it and its downstream on the simulated producer', async () => {
  const started = await postJson('/api/nodes/canvas-fixture-generate-image/executions', { mode: 'downstream' })
  assert.equal(started.status, 202)
  assert.equal(started.body.mode, 'downstream')
  assert.equal(started.body.entryNodeId, 'canvas-fixture-generate-image')
  assert.ok(['queued', 'running'].includes(started.body.status))

  let execution = started.body
  for (let attempt = 0; attempt < 100 && ['queued', 'running', 'cancelling'].includes(execution.status); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    execution = (await api(`/api/executions/${started.body.id}`)).body
  }
  assert.equal(execution.status, 'succeeded')
  assert.equal(execution.nodeExecutions['canvas-fixture-generate-image'].status, 'succeeded')
  assert.ok(execution.executedNodeCount >= 1)
})

// A node that carries no work of its own cannot be the entry point. This used to
// crash: downstreamCanvas returns null for such a node and createExecution fed
// that null straight into executionNodes, answering 500.
test('a node that carries no work cannot be the entry point', async () => {
  for (const mode of ['downstream', 'node']) {
    const { status, body } = await postJson('/api/nodes/canvas-fixture-prompt/executions', { mode })
    assert.equal(status, 400, `mode=${mode}`)
    assert.match(body.error, /cannot be run on its own/)
  }
})

test('a node ID present on more than one canvas is resolved within the requested canvas', async () => {
  const source = await postJson('/api/projects', {
    name: 'Ambiguous source',
    nodes: canvasFixture('y', { prefix: 'ambiguous' }).nodes,
    edges: canvasFixture('y', { prefix: 'ambiguous' }).edges,
  })
  const duplicate = await postJson('/api/projects', {
    name: 'Second canvas with legacy IDs',
    nodes: canvasFixture('y', { prefix: 'ambiguous' }).nodes,
    edges: canvasFixture('y', { prefix: 'ambiguous' }).edges,
  })

  const started = await postJson('/api/nodes/ambiguous-generate-image/executions', { mode: 'node', canvasId: duplicate.body.id })
  assert.equal(started.status, 202)
  assert.equal(started.body.canvasId, duplicate.body.id)
  assert.notEqual(started.body.canvasId, source.body.id)
})

test('rejects an unknown node, an invalid mode and an unconfigured provider', async () => {
  assert.deepEqual(
    await postJson('/api/nodes/missing/executions', { mode: 'node' }),
    { status: 404, body: { error: 'Node not found' } },
  )
  assert.deepEqual(
    await postJson('/api/nodes/canvas-fixture-prompt/executions', { mode: 'sideways' }),
    { status: 400, body: { error: 'Invalid execution mode' } },
  )
  assert.deepEqual(
    await postJson('/api/nodes/canvas-fixture-prompt/executions', { provider: 'banana' }),
    { status: 400, body: { error: 'provider must be "mock" or "tripo"' } },
  )
  // Tripo has no key in this environment, so asking for it explicitly is a 503.
  const tripo = await postJson('/api/nodes/canvas-fixture-prompt/executions', { provider: 'tripo' })
  assert.equal(tripo.status, 503)
  assert.match(tripo.body.error, /Tripo is not configured/)
})

test('reading and cancelling executions', async () => {
  assert.deepEqual(await api('/api/executions/missing'), { status: 404, body: { error: 'Execution not found' } })
  assert.deepEqual(await postJson('/api/executions/missing/cancel'), { status: 404, body: { error: 'Execution not found' } })

  const started = await postJson('/api/nodes/canvas-fixture-generate-image/executions', { mode: 'node' })
  const cancelled = await postJson(`/api/executions/${started.body.id}/cancel`)
  assert.equal(cancelled.status, 202)
  // Cancelling is a request; a run that already finished keeps its own status.
  assert.ok(['cancelling', 'cancelled', 'succeeded'].includes(cancelled.body.status))
})

test('lists the assets a run produced, paginated', async () => {
  const { status, body } = await api('/api/canvases/canvas-fixture/assets')
  assert.equal(status, 200)
  assert.ok(Array.isArray(body.items))
  assert.equal(typeof body.hasMore, 'boolean')
  assert.ok('nextCursor' in body)

  const limited = await api('/api/canvases/canvas-fixture/assets?limit=1')
  assert.ok(limited.body.items.length <= 1)
  assert.equal((await api('/api/canvases/missing/assets')).status, 404)
})

test('an unknown asset hash does not resolve', async () => {
  assert.deepEqual(await api('/api/assets/deadbeef'), { status: 404, body: { error: 'Asset not found' } })
})

test('the canvas event channel opens as a stream and 404s for a missing canvas', async () => {
  assert.equal((await fetch(new URL('/api/canvases/missing/events', baseUrl))).status, 404)

  const controller = new AbortController()
  const response = await fetch(new URL('/api/canvases/canvas-fixture/events', baseUrl), { signal: controller.signal })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /text\/event-stream/)
  // The subscribe comment is flushed up front so the client's EventSource opens.
  const { value } = await response.body.getReader().read()
  assert.match(new TextDecoder().decode(value), /: subscribed/)
  controller.abort()
})
