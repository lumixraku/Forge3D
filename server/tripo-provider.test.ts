import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { executeTripoNode } from './tripo-provider.js'
import { assetDirectory } from './tripo-assets.js'

// A client that records what it was asked to do, so input resolution can be
// asserted without touching the network.
function stubClient({ uploadToken = 'file_uploaded' } = {}) {
  const calls = { uploads: [], tasks: [] }
  return {
    calls,
    async uploadFile(bytes, filename, contentType) {
      calls.uploads.push({ size: bytes.length, filename, contentType })
      return uploadToken
    },
    async createTask(endpoint, body) {
      calls.tasks.push({ endpoint, body })
      return 'task_new'
    },
    async awaitTask() {
      return { task_id: 'task_new', status: 'success', credits_consumed: 30, output: { model_url: 'https://cdn/m.glb', rendered_image_url: 'https://cdn/p.webp' } }
    },
  }
}

// Assets are never really downloaded; the persisted path is asserted instead.
const noopFetch = async () => new Response(Buffer.from('bytes'), { status: 200, headers: { 'content-type': 'model/gltf-binary' } })

// Upstream meshes are addressed by the hashed names the asset store actually
// serves, so these fixtures have to exist on disk to be read back.
const MESH_FILE = `${'c'.repeat(32)}.fbx`
const MESH_ASSET = `/api/assets/${MESH_FILE}`
const meshPath = path.join(assetDirectory, MESH_FILE)

test.before(async () => {
  await mkdir(assetDirectory, { recursive: true })
  await writeFile(meshPath, 'fbx-fixture-bytes')
})
test.after(async () => {
  await rm(meshPath, { force: true })
})

function canvasOf(nodes, edges) {
  return {
    id: 'canvas-1',
    revision: 1,
    nodes,
    edges: edges.map(([from, to]) => ({ id: `e-${from}-${to}`, source: { nodeId: from, port: 'output' }, target: { nodeId: to, port: 'input' } })),
  }
}

const REFERENCE = { id: 'ref', type: 'reference-image', name: 'Ref', config: { preview: '/shark-reference.png' } }
const MODEL = { id: 'model', type: 'generate-model', name: 'Model', config: { modelVersion: 'v3.0-20250812', faceCount: 10000 } }
const RETOPO = { id: 'retopo', type: 'retopology', name: 'Retopo', config: { smartPoly: true, faceLimit: 8000, topology: 'quad' } }
const TEXTURE = { id: 'tex', type: 'texture', name: 'Texture', config: { inputMode: 'imageGenerate', textureQuality: 'standard' } }

test('a node type Tripo does not back is left to the mock producer', async () => {
  const canvas = canvasOf([{ id: 'bake', type: 'bake', name: 'Bake', config: {} }], [])
  const client = stubClient()
  assert.equal(await executeTripoNode(canvas.nodes[0], canvas, { client, fetchImpl: noopFetch }), null)
  assert.equal(client.calls.tasks.length, 0)
})

test('generate-model uploads the reference image and reconstructs from it', async () => {
  const canvas = canvasOf([REFERENCE, MODEL], [['ref', 'model']])
  const client = stubClient()

  const result = await executeTripoNode(MODEL, canvas, { client, fetchImpl: noopFetch })

  assert.equal(result.status, 'succeeded')
  assert.equal(client.calls.tasks[0].endpoint, '/generation/image-to-model')
  assert.equal(client.calls.tasks[0].body.input, 'file_uploaded')
  // The bundled demo file is read off disk, not handed to Tripo as a local path.
  assert.equal(client.calls.uploads[0].filename, 'shark-reference.png')
  assert.equal(client.calls.uploads[0].contentType, 'image/png')
})

test('an upstream generation task is passed by id, with no re-upload', async () => {
  const canvas = canvasOf([REFERENCE, MODEL, RETOPO], [['ref', 'model'], ['model', 'retopo']])
  const client = stubClient()
  const context = new Map([['model', { tripoTaskId: 'task_gen', modelUrl: '/api/assets/aa.glb', preview: '/api/assets/bb.webp' }]])

  await executeTripoNode(RETOPO, canvas, { client, context, fetchImpl: noopFetch })

  assert.equal(client.calls.tasks[0].endpoint, '/mesh/decimate')
  assert.equal(client.calls.tasks[0].body.input, 'task_gen')
  assert.equal(client.calls.uploads.length, 0)
})

test('an upstream processing task is uploaded rather than passed by id', async () => {
  // Only a generation task id is passed through; a retopology upstream is
  // uploaded, which is why the mime lookup has to know the mesh extensions.
  const canvas = canvasOf([REFERENCE, MODEL, RETOPO, TEXTURE], [['ref', 'model'], ['model', 'retopo'], ['retopo', 'tex']])
  const client = stubClient()
  const context = new Map([
    ['model', { tripoTaskId: 'task_gen', modelUrl: '/api/assets/aa.glb' }],
    ['retopo', { tripoTaskId: 'task_retopo', modelUrl: MESH_ASSET }],
  ])

  await executeTripoNode(TEXTURE, canvas, { client, context, fetchImpl: noopFetch })

  const task = client.calls.tasks[0]
  assert.equal(task.endpoint, '/models/texture')
  assert.notEqual(task.body.input, 'task_retopo')
  assert.equal(task.body.input, 'file_uploaded')
  // Retopology emits FBX, so the upload must not assume a GLB.
  assert.ok(client.calls.uploads.some((upload) => upload.filename.endsWith('.fbx')))
})

test('texture finds the reference image several hops upstream', async () => {
  // The direct input is a mesh, so a search that stops at model-producing nodes
  // sends no texture_prompt and Tripo fails with reference_image_path not found.
  const canvas = canvasOf([REFERENCE, MODEL, RETOPO, TEXTURE], [['ref', 'model'], ['model', 'retopo'], ['retopo', 'tex']])
  const client = stubClient()
  const context = new Map([['retopo', { modelUrl: MESH_ASSET }]])

  await executeTripoNode(TEXTURE, canvas, { client, context, fetchImpl: noopFetch })

  assert.deepEqual(client.calls.tasks[0].body.texture_prompt, { image: 'file_uploaded' })
})

test('texture guided by text sends the prompt instead of an image', async () => {
  const textured = { ...TEXTURE, config: { inputMode: 'textGenerate', textureQuality: 'standard', prompt: 'worn brass' } }
  const canvas = canvasOf([REFERENCE, MODEL, textured], [['ref', 'model'], ['model', 'tex']])
  const client = stubClient()
  const context = new Map([['model', { tripoTaskId: 'task_gen' }]])

  await executeTripoNode(textured, canvas, { client, context, fetchImpl: noopFetch })

  assert.deepEqual(client.calls.tasks[0].body.texture_prompt, { text: 'worn brass' })
})

test('the same reference feeding two nodes is uploaded once per run', async () => {
  const second = { id: 'model2', type: 'generate-model', name: 'Model 2', config: { modelVersion: 'v3.0-20250812' } }
  const canvas = canvasOf([REFERENCE, MODEL, second], [['ref', 'model'], ['ref', 'model2']])
  const client = stubClient()
  const uploads = new Map()

  await executeTripoNode(MODEL, canvas, { client, uploads, fetchImpl: noopFetch })
  await executeTripoNode(second, canvas, { client, uploads, fetchImpl: noopFetch })

  assert.equal(client.calls.uploads.length, 1)
  assert.equal(client.calls.tasks[1].body.input, 'file_uploaded')
})

test('a mesh transform with nothing upstream is refused before spending credits', async () => {
  const canvas = canvasOf([RETOPO], [])
  const client = stubClient()

  await assert.rejects(executeTripoNode(RETOPO, canvas, { client, fetchImpl: noopFetch }), /needs an upstream 3D model/)
  assert.equal(client.calls.tasks.length, 0)
})

test('progress is reported while the task runs and the result is persisted', async () => {
  const canvas = canvasOf([REFERENCE, MODEL], [['ref', 'model']])
  const seen = []
  const client = {
    ...stubClient(),
    async awaitTask(taskId, { onProgress }) {
      await onProgress({ status: 'running', progress: 40 })
      return { task_id: taskId, status: 'success', credits_consumed: 30, output: { model_url: 'https://cdn/m.glb', rendered_image_url: 'https://cdn/p.webp' } }
    },
  }

  const result = await executeTripoNode(MODEL, canvas, {
    client,
    fetchImpl: noopFetch,
    onProgress: async (event) => { seen.push(event.progress) },
  })

  assert.deepEqual(seen, [0, 40])
  assert.equal(result.creditsConsumed, 30)
  // The expiring Tripo urls are replaced by local asset paths.
  assert.match(result.output.modelUrl, /^\/api\/assets\//)
  assert.match(result.output.preview, /^\/api\/assets\//)
})

test('an export shows the upstream thumbnail when its own task renders none', async () => {
  const exportNode = { id: 'exp', type: 'export-model', name: 'Export', config: { modelFormat: 'gltf', fileName: 'shark' } }
  const canvas = canvasOf([REFERENCE, MODEL, exportNode], [['ref', 'model'], ['model', 'exp']])
  const client = {
    ...stubClient(),
    // A convert task returns a model only, which is what left the node with a
    // broken thumbnail.
    async awaitTask() { return { task_id: 'task_new', status: 'success', credits_consumed: 10, output: { model_url: 'https://cdn/out.glb' } } },
  }
  const context = new Map([['model', { tripoTaskId: 'task_gen', preview: '/api/assets/aa.webp' }]])

  const result = await executeTripoNode(exportNode, canvas, { client, context, fetchImpl: noopFetch })

  assert.equal(result.output.preview, '/api/assets/aa.webp')
  assert.equal(result.output.outputs[0].filename, 'shark.glb')
  assert.match(result.output.outputs[0].downloadUrl, /^\/api\/assets\//)
})
