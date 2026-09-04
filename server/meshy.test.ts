import test from 'node:test'
import assert from 'node:assert/strict'
import { createMeshyClient, isMeshyConfigured, MeshyError } from './meshy.js'

function reply(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } })
}

// `wait` is stubbed everywhere so backoff is asserted rather than slept through.
function client(fetchImpl, waited = []) {
  return createMeshyClient({ apiKey: 'test-key', fetchImpl, wait: async (duration) => { waited.push(duration) } })
}

test('reports whether a key is configured', () => {
  assert.equal(isMeshyConfigured({}), false)
  assert.equal(isMeshyConfigured({ MESHY_API_KEY: '' }), false)
  assert.equal(isMeshyConfigured({ MESHY_API_KEY: 'k' }), true)
})

test('refuses to build a client without a key', () => {
  assert.throws(() => createMeshyClient({ apiKey: '' }), (error) => error instanceof MeshyError && error.status === 503)
})

test('sends a bearer token against the configured base url', async () => {
  const calls = []
  const meshy = createMeshyClient({
    apiKey: 'test-key',
    // A trailing slash must not produce a double slash in the path.
    baseUrl: 'https://example.test/openapi/',
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      return reply({ result: 'task_abc' })
    },
  })

  await meshy.createTask('/v1/image-to-3d', { image_url: 'https://cdn/in.png' })
  assert.equal(calls[0].url, 'https://example.test/openapi/v1/image-to-3d')
  assert.equal(calls[0].options.headers.authorization, 'Bearer test-key')
  assert.equal(calls[0].options.headers['content-type'], 'application/json')
  assert.deepEqual(JSON.parse(calls[0].options.body), { image_url: 'https://cdn/in.png' })
})

test('returns the task id from the result field', async () => {
  const meshy = client(async () => reply({ result: 'task_abc' }))
  assert.equal(await meshy.createTask('/v2/text-to-3d', { mode: 'preview', prompt: 'a shark' }), 'task_abc')
})

test('a create response without a result is an error', async () => {
  const meshy = client(async () => reply({}))
  await assert.rejects(meshy.createTask('/v2/text-to-3d', {}), /did not return a task id/)
})

test('never leaks the api key in an error message', async () => {
  const meshy = createMeshyClient({
    apiKey: 'super-secret',
    fetchImpl: async () => reply({ message: 'invalid token' }, 401),
    wait: async () => {},
  })
  await assert.rejects(meshy.getTask('/v1/image-to-3d', 'task_abc'), (error) => !error.message.includes('super-secret') && error.status === 503)
})

test('retries a 429 with exponential backoff and then succeeds', async () => {
  const waited = []
  let attempts = 0
  const meshy = client(async () => {
    attempts += 1
    if (attempts <= 3) return reply({}, 429)
    return reply({ result: 'task_abc' })
  }, waited)

  assert.equal(await meshy.createTask('/v1/image-to-3d', { image_url: 'https://cdn/in.png' }), 'task_abc')
  assert.equal(attempts, 4)
  assert.deepEqual(waited, [1000, 2000, 4000])
})

test('prefers the Retry-After header over its own backoff', async () => {
  const waited = []
  let attempts = 0
  const meshy = client(async () => {
    attempts += 1
    if (attempts === 1) return reply({}, 429, { 'retry-after': '7' })
    return reply({ result: 'task_abc' })
  }, waited)

  await meshy.createTask('/v1/image-to-3d', {})
  assert.deepEqual(waited, [7000])
})

test('caps the backoff and gives up as a retryable error', async () => {
  const waited = []
  const meshy = client(async () => reply({}, 429), waited)
  await assert.rejects(meshy.createTask('/v1/image-to-3d', {}), (error) => error.status === 503)
  // Five retries: 1s, 2s, 4s, 8s, 16s. The cap only binds beyond that.
  assert.deepEqual(waited, [1000, 2000, 4000, 8000, 16000])
})

test('retries a 5xx but not a 4xx', async () => {
  const waited = []
  let attempts = 0
  const retried = client(async () => {
    attempts += 1
    return attempts === 1 ? reply({}, 502) : reply({ result: 'task_ok' })
  }, waited)
  assert.equal(await retried.createTask('/v1/image-to-3d', {}), 'task_ok')
  assert.equal(attempts, 2)

  let badRequests = 0
  const notRetried = client(async () => {
    badRequests += 1
    return reply({ message: 'bad params' }, 400)
  })
  await assert.rejects(notRetried.createTask('/v1/image-to-3d', {}), /bad params/)
  assert.equal(badRequests, 1)
})

test('surfaces an unreachable service as retryable', async () => {
  const waited = []
  const meshy = client(async () => { throw new TypeError('network down') }, waited)
  await assert.rejects(meshy.getTask('/v1/image-to-3d', 'task_abc'), (error) => error.status === 503 && /unavailable/.test(error.message))
  // A dropped connection costs a whole node run, so it backs off like a 5xx.
  assert.deepEqual(waited, [1000, 2000, 4000, 8000, 16000])
})

test('recovers from a dropped connection instead of failing the node', async () => {
  const waited = []
  let attempts = 0
  const meshy = client(async () => {
    attempts += 1
    if (attempts === 1) throw new TypeError('fetch failed')
    return reply({ result: 'task_abc' })
  }, waited)

  assert.equal(await meshy.createTask('/v1/image-to-3d', { image_url: 'https://cdn/in.png' }), 'task_abc')
  assert.equal(attempts, 2)
  assert.deepEqual(waited, [1000])
})

test('polls until the task succeeds and reports progress', async () => {
  const statuses = [
    { id: 'task_abc', status: 'PENDING', progress: 0 },
    { id: 'task_abc', status: 'IN_PROGRESS', progress: 40 },
    { id: 'task_abc', status: 'SUCCEEDED', progress: 100, model_urls: { glb: 'https://cdn/m.glb' } },
  ]
  const waited = []
  const seen = []
  const meshy = client(async () => reply(statuses.shift()), waited)

  const task = await meshy.awaitTask('/v1/image-to-3d', 'task_abc', { onProgress: (current) => seen.push(current.progress) })
  assert.equal(task.model_urls.glb, 'https://cdn/m.glb')
  assert.deepEqual(seen, [0, 40, 100])
  // No sleep after the terminal poll.
  assert.deepEqual(waited, [2000, 2000])
})

test('raises each terminal failure status', async () => {
  for (const status of ['FAILED', 'CANCELED']) {
    const meshy = client(async () => reply({ id: 'task_abc', status, task_error: { message: '' } }))
    await assert.rejects(meshy.awaitTask('/v1/image-to-3d', 'task_abc'), (error) => error.status === 422 && error.message.includes(status), status)
  }
})

test('a failed task names the task id so it can be looked up afterwards', async () => {
  const meshy = client(async () => reply({ id: 'task_abc', status: 'FAILED', task_error: { message: '' } }))
  await assert.rejects(meshy.awaitTask('/v1/image-to-3d', 'task_abc'), /task task_abc/)
})

test('a failed task passes through the reason Meshy gave', async () => {
  const meshy = client(async () => reply({ id: 'task_abc', status: 'FAILED', task_error: { message: 'unsupported image format' } }))
  await assert.rejects(meshy.awaitTask('/v1/image-to-3d', 'task_abc'), /unsupported image format/)
})

// A status lookup that cannot be answered says nothing about the task, so the
// only correct reading of it is "not known yet". Only Meshy can report a failure.
test('keeps polling when the status lookup itself fails', async () => {
  let calls = 0
  const meshy = client(async () => {
    calls += 1
    // Enough consecutive outages to exhaust `send`'s own retries twice over.
    if (calls <= 14) return new Response('gateway down', { status: 502 })
    return reply({ id: 'task_abc', status: 'SUCCEEDED', model_urls: { glb: 'https://cdn/m.glb' } })
  })

  const task = await meshy.awaitTask('/v1/image-to-3d', 'task_abc')
  assert.equal(task.model_urls.glb, 'https://cdn/m.glb')
})

test('keeps polling a task that stays running', async () => {
  let calls = 0
  const meshy = client(async () => {
    calls += 1
    return calls <= 30
      ? reply({ id: 'task_abc', status: 'IN_PROGRESS', progress: 10 })
      : reply({ id: 'task_abc', status: 'SUCCEEDED', model_urls: { glb: 'https://cdn/m.glb' } })
  })

  const task = await meshy.awaitTask('/v1/image-to-3d', 'task_abc')
  assert.equal(task.status, 'SUCCEEDED')
  assert.equal(calls, 31)
})
