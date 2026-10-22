import assert from 'node:assert/strict'
import test from 'node:test'
import { createApi } from './api-core.js'
import { createMeshyRunner, createMeshySubmitter, createMeshyTaskReader } from './meshy-run.js'
import { applyUserKeys, readUserKeys } from './user-keys.js'

const withCookie = (cookie) => new Request('https://forge.test/api/capabilities', { headers: cookie ? { cookie } : {} })

test('reads both keys from their cookies', () => {
  const keys = readUserKeys(withCookie('theme=light; forge3d_deepseek_key=sk-abc; forge3d_meshy_key=msy%5Fxyz'))
  assert.deepEqual(keys, { deepseek: 'sk-abc', meshy: 'msy_xyz' })
})

test('missing, blank, malformed or oversized cookies read as no key', () => {
  assert.deepEqual(readUserKeys(withCookie('')), { deepseek: '', meshy: '' })
  assert.deepEqual(readUserKeys(withCookie('forge3d_deepseek_key=  ; forge3d_meshy_key=%E0%A4%A')), { deepseek: '', meshy: '' })
  assert.equal(readUserKeys(withCookie(`forge3d_deepseek_key=${'k'.repeat(300)}`)).deepseek, '')
})

test('no user keys leaves the built-in config untouched', () => {
  const config = { deepseek: { apiKey: 'built-in' }, createMeshyProvider: null }
  assert.equal(applyUserKeys(config, { deepseek: '', meshy: '' }, () => ({})), config)
})

test('a user DeepSeek key replaces only the DeepSeek key', () => {
  const config = { deepseek: { apiKey: 'built-in', model: 'deepseek-chat' }, createMeshyProvider: 'built-in-meshy' }
  const next = applyUserKeys(config, { deepseek: 'mine', meshy: '' }, () => { throw new Error('Meshy should not be rebuilt') })
  assert.deepEqual(next.deepseek, { apiKey: 'mine', model: 'deepseek-chat' })
  assert.equal(next.createMeshyProvider, 'built-in-meshy')
  assert.equal(config.deepseek.apiKey, 'built-in')
})

test('a user Meshy key enables Meshy on a deployment without one', async () => {
  const state = { canvases: [], sessions: [], turns: [], agentTraces: [], runs: [], accounts: [], creditLedger: [] }
  const base = { agentServiceUrl: '', deepseek: {}, createTripoProvider: null, createMeshyProvider: null, getMeshyTask: null, submitMeshyTask: null, getTripoTask: null, readAsset: null, uploadAsset: null }
  const handle = createApi({
    createContext: (request) => ({
      store: { state, persist: async () => {}, reload: async () => {}, removeCanvas: async () => {} },
      config: applyUserKeys(base, readUserKeys(request), (apiKey) => {
        const env = { MESHY_API_KEY: apiKey }
        return { createMeshyProvider: createMeshyRunner(env), submitMeshyTask: createMeshySubmitter(env), getMeshyTask: createMeshyTaskReader(env) }
      }),
      waitUntil: () => {},
      recoverAgentTurns: false,
    }),
  })

  const builtIn = await (await handle(withCookie(''))).json()
  assert.equal(builtIn.providers.meshy, false)
  const own = await (await handle(withCookie('forge3d_meshy_key=msy-mine'))).json()
  assert.equal(own.providers.meshy, true)
})

test('a task the visitor key cannot read falls back to the built-in reader', async () => {
  const builtInRead = async (taskId) => ({ id: taskId, via: 'built-in' })
  const config = { deepseek: {}, getMeshyTask: builtInRead }
  const next = applyUserKeys(config, { deepseek: '', meshy: 'mine' }, () => ({
    createMeshyProvider: () => {},
    submitMeshyTask: async () => 'task',
    getMeshyTask: async () => { throw new Error('404 from Meshy') },
  }))
  assert.deepEqual(await next.getMeshyTask('task-1'), { id: 'task-1', via: 'built-in' })
})

test('Meshy calls carry the visitor key when set, and the built-in key otherwise', async (t) => {
  const seen = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options = {}) => {
    if (new URL(url).hostname === 'meshy.test') seen.push(options.headers?.authorization)
    const reply = (body) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
    if (options.method === 'POST') return reply({ result: 'task_1' })
    return reply({ id: 'task_1', status: 'SUCCEEDED', progress: 100, thumbnail_url: 'https://cdn/p.png', model_urls: { glb: 'https://cdn/m.glb' } })
  }
  t.after(() => { globalThis.fetch = originalFetch })

  const meshyPorts = (apiKey) => {
    const env = { MESHY_API_KEY: apiKey, MESHY_BASE_URL: 'https://meshy.test' }
    return { createMeshyProvider: createMeshyRunner(env), submitMeshyTask: createMeshySubmitter(env), getMeshyTask: createMeshyTaskReader(env) }
  }
  const state = {
    canvases: [{ id: 'canvas-1', provider: 'meshy', revision: 1, nodes: [{ id: 'gen', type: 'generate-model', name: 'Gen', config: { prompt: 'a shark' } }], edges: [] }],
    sessions: [], turns: [], agentTraces: [], runs: [],
    accounts: [{ id: 'demo-user', name: 'Demo User', balance: 1000 }], creditLedger: [],
  }
  const base = { agentServiceUrl: '', deepseek: {}, createTripoProvider: null, getTripoTask: null, readAsset: null, uploadAsset: null, ...meshyPorts('built-in') }
  const background = []
  const handle = createApi({
    createContext: (request) => ({
      store: { state, persist: async () => {}, reload: async () => {}, removeCanvas: async () => {} },
      config: applyUserKeys(base, readUserKeys(request), meshyPorts),
      waitUntil: (promise) => background.push(promise),
      recoverAgentTurns: false,
    }),
  })
  const run = (cookie) => handle(new Request('https://forge.test/api/projects/canvas-1/executions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ entryNodeId: 'gen' }),
  }))

  assert.equal((await run('forge3d_meshy_key=msy-visitor')).status, 202)
  await Promise.all(background.splice(0))
  assert.ok(seen.length > 0)
  assert.ok(seen.every((header) => header === 'Bearer msy-visitor'), `expected only the visitor key, saw ${seen}`)

  seen.length = 0
  assert.equal((await run('')).status, 202)
  await Promise.all(background.splice(0))
  assert.ok(seen.length > 0)
  assert.ok(seen.every((header) => header === 'Bearer built-in'), `expected only the built-in key, saw ${seen}`)
})
