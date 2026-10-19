// Node-only reference reader. The Worker supplies its own and never imports this.

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assetUrlPrefix, resolveAssetPath } from './tripo-assets.js'

const root = path.dirname(fileURLToPath(import.meta.url))
const publicDirectory = path.join(root, '..', 'public')

export function createMeshyLocalReader(readAsset) {
  return async function readLocal(reference) {
    if (reference.startsWith(assetUrlPrefix)) {
      const assetId = reference.slice(assetUrlPrefix.length)
      if (readAsset) {
        const asset = await readAsset(assetId)
        if (!asset) throw new Error('The upstream asset could not be read.')
        return { bytes: asset.bytes, filename: assetId }
      }
      const resolved = resolveAssetPath(assetId)
      if (!resolved) throw new Error('The upstream asset could not be read.')
      return { bytes: await readFile(resolved), filename: path.basename(resolved) }
    }
    if (reference.startsWith('/')) {
      const resolved = path.join(publicDirectory, reference)
      if (!resolved.startsWith(publicDirectory + path.sep)) throw new Error('The reference image path is not allowed.')
      const bytes = await readFile(resolved).catch(() => { throw new Error(`The reference file ${reference} is missing.`) })
      return { bytes, filename: path.basename(resolved) }
    }
    throw new Error(`The reference "${reference}" is not a supported image source.`)
  }
}
