import type Database from 'better-sqlite3'
import type { AgentRegistry } from '../configuration/registry.js'
import { HarnessAvailabilityCache } from './harness-availability.js'
import { ModelCatalogCache } from './model-cache.js'

const caches = new WeakMap<
  AgentRegistry,
  {
    availability: HarnessAvailabilityCache
    catalogs: ModelCatalogCache
  }
>()

/** Pickers and first-turn selection share live discovery for this runtime/account only. */
export function agentDiscoveryCache(db: Database.Database, registry: AgentRegistry) {
  let cache = caches.get(registry)
  if (!cache) {
    cache = { availability: new HarnessAvailabilityCache(), catalogs: new ModelCatalogCache(db) }
    caches.set(registry, cache)
  }
  return cache
}
