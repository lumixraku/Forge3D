// Tripo output URLs expire about five minutes after a task succeeds, so every
// produced file is copied to disk the moment the task completes and the canvas
// stores the local path instead. Files are named by content hash, which makes
// re-running an identical node a no-op.

import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
export const assetDirectory = path.join(root, 'data', 'assets')
export const assetUrlPrefix = '/api/assets/'

// Only these are ever served back, so a hashed name can never take an extension
// that would make the browser treat the file as something executable.
const EXTENSION_BY_CONTENT_TYPE = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'model/gltf-binary': 'glb',
  'application/octet-stream': 'glb',
}
const ALLOWED_EXTENSIONS = new Set(['png', 'jpg', 'webp', 'glb', 'gltf', 'fbx', 'usdz', 'obj', 'stl', '3mf'])
const CONTENT_TYPE_BY_EXTENSION = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  fbx: 'application/octet-stream',
  usdz: 'model/vnd.usdz+zip',
  obj: 'text/plain; charset=utf-8',
  stl: 'application/octet-stream',
  '3mf': 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml',
}

// A hashed name only. This is what keeps a crafted request from walking out of
// the asset directory.
const ASSET_FILE_PATTERN = /^[a-f0-9]{32}\.[a-z0-9]{2,4}$/

export function isAssetFileName(file) {
  return ASSET_FILE_PATTERN.test(file)
}

/** Picks the stored extension from the URL path, falling back to the content type. */
export function assetExtension(url, contentType = '') {
  const fromUrl = new URL(url, 'https://placeholder.invalid').pathname.split('.').pop()?.toLowerCase()
  if (fromUrl && ALLOWED_EXTENSIONS.has(fromUrl)) return fromUrl
  return EXTENSION_BY_CONTENT_TYPE[contentType.split(';')[0].trim().toLowerCase()] || 'bin'
}

export function assetContentType(file) {
  return CONTENT_TYPE_BY_EXTENSION[file.split('.').pop().toLowerCase()] || 'application/octet-stream'
}

/** Resolves a request path to a file on disk, or null when it is not a valid asset name. */
export function resolveAssetPath(file) {
  if (!isAssetFileName(file)) return null
  const resolved = path.join(assetDirectory, file)
  // Belt and braces: the pattern already excludes separators and dots.
  return resolved.startsWith(assetDirectory + path.sep) ? resolved : null
}

// The credits are already spent by the time the download runs, and the url is
// gone in five minutes, so a dropped connection here cannot be allowed to
// discard the mesh. Same backoff as the API client, well inside the expiry.
const DOWNLOAD_RETRIES = 4
const DOWNLOAD_BASE_MS = 500

async function downloadWithRetry(url, { fetchImpl, wait }) {
  let lastReason = ''
  for (let attempt = 0; attempt <= DOWNLOAD_RETRIES; attempt += 1) {
    let response
    try {
      response = await fetchImpl(url, { signal: AbortSignal.timeout(120000) })
    } catch (failure) {
      lastReason = failure?.cause?.message || failure?.message || 'the connection dropped'
      if (attempt === DOWNLOAD_RETRIES) break
      await wait(DOWNLOAD_BASE_MS * 2 ** attempt)
      continue
    }
    if (response.ok) {
      return { bytes: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get('content-type') || '' }
    }
    lastReason = `status ${response.status}`
    // A 403 here means the url expired; retrying cannot bring it back.
    if (response.status < 500 && response.status !== 429) break
    if (attempt === DOWNLOAD_RETRIES) break
    await wait(DOWNLOAD_BASE_MS * 2 ** attempt)
  }
  // The reason is kept: without it a download failure is undiagnosable.
  throw new Error(`Downloading the Tripo result failed before it expired: ${lastReason}.`)
}

/**
 * Downloads one Tripo output and returns the local URL to serve it from.
 * Returns null for a missing url so callers can pass optional outputs straight
 * through.
 */
export async function persistTripoAsset(url, {
  fetchImpl = fetch,
  directory = assetDirectory,
  wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration)),
} = {}) {
  if (!url) return null
  // An already-persisted asset (a re-run reading a prior output) is left alone.
  if (url.startsWith(assetUrlPrefix)) return url

  const { bytes, contentType } = await downloadWithRetry(url, { fetchImpl, wait })
  const extension = assetExtension(url, contentType)
  const file = `${createHash('md5').update(bytes).digest('hex')}.${extension}`
  const destination = path.join(directory, file)

  await mkdir(directory, { recursive: true })
  // Identical content is already on disk; writing again would only churn it.
  try {
    await stat(destination)
  } catch {
    const temporary = `${destination}.tmp`
    await writeFile(temporary, bytes)
    await rename(temporary, destination)
  }
  return `${assetUrlPrefix}${file}`
}

/** Stores a user upload in the same durable asset cache used by generated files. */
export async function persistUploadedAsset(bytes, contentType = '', filename = '', {
  directory = assetDirectory,
} = {}) {
  const extension = assetExtension(filename, contentType)
  const file = `${createHash('md5').update(bytes).digest('hex')}.${extension}`
  const destination = path.join(directory, file)

  await mkdir(directory, { recursive: true })
  try {
    await stat(destination)
  } catch {
    const temporary = `${destination}.tmp`
    await writeFile(temporary, bytes)
    await rename(temporary, destination)
  }
  return `${assetUrlPrefix}${file}`
}

/** Reads a persisted asset back, for the route that serves them. */
export async function readAsset(file) {
  const resolved = resolveAssetPath(file)
  if (!resolved) return null
  try {
    return { bytes: await readFile(resolved), contentType: assetContentType(file) }
  } catch {
    return null
  }
}
