import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { assetContentType, assetExtension, assetUrlPrefix, persistTripoAsset, persistUploadedAsset, resolveAssetPath } from './tripo-assets.js'

function fileResponse(bytes, contentType = 'model/gltf-binary') {
  return new Response(bytes, { status: 200, headers: { 'content-type': contentType } })
}

async function directory() {
  return mkdtemp(path.join(tmpdir(), 'tripo-assets-'))
}

test('names the stored file from the url extension', () => {
  assert.equal(assetExtension('https://cdn.tripo3d.ai/output/model_pbr.glb'), 'glb')
  assert.equal(assetExtension('https://cdn.tripo3d.ai/output/preview.png'), 'png')
  assert.equal(assetExtension('https://cdn.tripo3d.ai/o/a.fbx?token=x&expires=1'), 'fbx')
})

test('falls back to the content type when the url has no usable extension', () => {
  assert.equal(assetExtension('https://cdn.tripo3d.ai/output/8fa2c1', 'image/png'), 'png')
  assert.equal(assetExtension('https://cdn.tripo3d.ai/output/8fa2c1', 'model/gltf-binary'), 'glb')
  assert.equal(assetExtension('https://cdn.tripo3d.ai/o/x.exe', 'image/webp'), 'webp')
  assert.equal(assetExtension('https://cdn.tripo3d.ai/output/8fa2c1', 'text/html'), 'bin')
})

test('serves each stored extension with a matching content type', () => {
  assert.equal(assetContentType('aa.glb'), 'model/gltf-binary')
  assert.equal(assetContentType('aa.png'), 'image/png')
  assert.equal(assetContentType('aa.jpg'), 'image/jpeg')
  assert.equal(assetContentType('aa.bin'), 'application/octet-stream')
})

test('only resolves hashed asset names', () => {
  const valid = `${'a'.repeat(32)}.glb`
  assert.ok(resolveAssetPath(valid))
  for (const attempt of [
    '../../.env',
    `../${'a'.repeat(32)}.glb`,
    `${'a'.repeat(32)}.glb/../../.env`,
    'canvases/wf-1.json',
    `${'A'.repeat(32)}.glb`,
    `${'a'.repeat(31)}.glb`,
    `${'z'.repeat(32)}.glb`,
    '.env',
    '',
  ]) {
    assert.equal(resolveAssetPath(attempt), null, attempt)
  }
})

test('downloads a result and returns a local url', async () => {
  const target = await directory()
  const url = await persistTripoAsset('https://cdn.tripo3d.ai/output/model.glb', {
    fetchImpl: async () => fileResponse(Buffer.from('glb-bytes')),
    directory: target,
  })

  assert.ok(url.startsWith(assetUrlPrefix))
  const file = url.slice(assetUrlPrefix.length)
  assert.match(file, /^[a-f0-9]{32}\.glb$/)
  assert.equal(await readFile(path.join(target, file), 'utf8'), 'glb-bytes')
})

test('stores an uploaded image in the local asset cache', async () => {
  const target = await directory()
  const url = await persistUploadedAsset(new Uint8Array([137, 80, 78, 71]), 'image/png', 'reference.png', { directory: target })

  assert.match(url, /^\/api\/assets\/[a-f0-9]{32}\.png$/)
  assert.deepEqual([...await readFile(path.join(target, url.slice(assetUrlPrefix.length)))], [137, 80, 78, 71])
})

test('stores an uploaded model with its supported extension', async () => {
  const target = await directory()
  const url = await persistUploadedAsset(new Uint8Array([103, 108, 84, 70]), 'model/gltf-binary', 'reference.glb', { directory: target })

  assert.match(url, /^\/api\/assets\/[a-f0-9]{32}\.glb$/)
})

test('identical content is stored once and fetched once per call', async () => {
  const target = await directory()
  let downloads = 0
  const fetchImpl = async () => {
    downloads += 1
    return fileResponse(Buffer.from('same-bytes'))
  }

  const first = await persistTripoAsset('https://cdn.tripo3d.ai/a.glb', { fetchImpl, directory: target })
  const second = await persistTripoAsset('https://cdn.tripo3d.ai/b.glb', { fetchImpl, directory: target })

  assert.equal(first, second)
  assert.equal(downloads, 2)
  assert.deepEqual((await readdir(target)).filter((entry) => !entry.endsWith('.tmp')), [first.slice(assetUrlPrefix.length)])
})

test('an already-persisted url is passed straight through', async () => {
  const persisted = `${assetUrlPrefix}${'a'.repeat(32)}.glb`
  const url = await persistTripoAsset(persisted, {
    fetchImpl: async () => assert.fail('should not re-download a local asset'),
  })
  assert.equal(url, persisted)
})

test('a missing url is not an error', async () => {
  assert.equal(await persistTripoAsset(null, { fetchImpl: async () => assert.fail('nothing to fetch') }), null)
  assert.equal(await persistTripoAsset('', { fetchImpl: async () => assert.fail('nothing to fetch') }), null)
})

test('a failed download is reported, not silently skipped', async () => {
  const target = await directory()
  await assert.rejects(
    persistTripoAsset('https://cdn.tripo3d.ai/expired.glb', {
      fetchImpl: async () => new Response('gone', { status: 403 }),
      directory: target,
    }),
    /status 403/,
  )
  await assert.rejects(
    persistTripoAsset('https://cdn.tripo3d.ai/expired.glb', {
      fetchImpl: async () => { throw new TypeError('socket hang up') },
      directory: target,
      wait: async () => {},
    }),
    // The reason has to survive: without it the failure is undiagnosable.
    /before it expired: socket hang up/,
  )
})

test('a dropped connection is retried rather than losing paid-for output', async () => {
  const target = await directory()
  const waited = []
  let attempts = 0

  const url = await persistTripoAsset('https://cdn.tripo3d.ai/model.glb', {
    fetchImpl: async () => {
      attempts += 1
      if (attempts <= 2) throw new TypeError('fetch failed')
      return new Response(Buffer.from('glb-bytes'), { status: 200, headers: { 'content-type': 'model/gltf-binary' } })
    },
    directory: target,
    wait: async (duration) => { waited.push(duration) },
  })

  assert.match(url, /^\/api\/assets\/[a-f0-9]{32}\.glb$/)
  assert.equal(attempts, 3)
  assert.deepEqual(waited, [500, 1000])
})

test('an expired url is not retried, but a 5xx is', async () => {
  const target = await directory()
  let expired = 0
  await assert.rejects(
    persistTripoAsset('https://cdn.tripo3d.ai/expired.glb', {
      fetchImpl: async () => { expired += 1; return new Response('gone', { status: 403 }) },
      directory: target,
      wait: async () => {},
    }),
    /status 403/,
  )
  // Retrying an expired url cannot bring it back, so it must not burn attempts.
  assert.equal(expired, 1)

  let flaky = 0
  const url = await persistTripoAsset('https://cdn.tripo3d.ai/model.glb', {
    fetchImpl: async () => {
      flaky += 1
      return flaky === 1
        ? new Response('busy', { status: 503 })
        : new Response(Buffer.from('glb-bytes'), { status: 200, headers: { 'content-type': 'model/gltf-binary' } })
    },
    directory: target,
    wait: async () => {},
  })
  assert.match(url, /^\/api\/assets\//)
  assert.equal(flaky, 2)
})

test('a leftover temp file does not become a served asset', async () => {
  const target = await directory()
  await writeFile(path.join(target, `${'a'.repeat(32)}.glb.tmp`), 'partial')
  assert.equal(resolveAssetPath(`${'a'.repeat(32)}.glb.tmp`), null)
})
