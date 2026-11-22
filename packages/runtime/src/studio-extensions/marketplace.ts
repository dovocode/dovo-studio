import { createHash } from 'node:crypto'
import { Schema } from 'effect'
import {
  decode,
  marketplaceReleaseSchema,
  type MarketplaceOrigin,
  type MarketplaceRelease,
} from '@dovo/protocol'
import releases from './marketplace-catalog.json' with { type: 'json' }
import { HttpError } from '../errors.js'

let catalog: Array<{ package: MarketplaceRelease; digest: string }> | undefined

export function marketplaceCatalog() {
  if (catalog) return catalog
  const packages = decode(Schema.Array(marketplaceReleaseSchema), releases)
  const keys = new Set<string>()
  const publishers = new Map<string, string>()
  catalog = packages.map((entry) => {
    const { id } = entry.manifest
    const key = `${id}@${entry.version}`
    const publisher = publishers.get(id)
    if (keys.has(key) || (publisher && publisher !== entry.publisher))
      throw new Error(`Conflicting marketplace release: ${key}`)
    keys.add(key)
    publishers.set(id, entry.publisher)
    return {
      package: entry,
      digest: createHash('sha256').update(JSON.stringify(entry)).digest('hex'),
    }
  })
  return catalog
}

export function exactMarketplaceRelease(id: string, digest: MarketplaceOrigin['digest']) {
  const found = marketplaceCatalog().find(
    (entry) => entry.package.manifest.id === id && entry.digest === digest,
  )
  if (!found)
    throw new HttpError(404, 'This marketplace release is unavailable. Reload the marketplace.')
  return found
}
