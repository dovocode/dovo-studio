import type { RuntimeReadCache } from '@dovo/protocol'

// The cache instance belongs to one computer and credential. Returning from a
// native detail route must refresh that computer's changed PR list, not another's.
const pending = new WeakMap<RuntimeReadCache, Map<string, symbol>>()

export function invalidatePullList(cache: RuntimeReadCache | null, repositoryId: string) {
  if (!cache) return
  let repositories = pending.get(cache)
  if (!repositories) {
    repositories = new Map()
    pending.set(cache, repositories)
  }
  repositories.set(repositoryId, Symbol())
}

export function pullListRevision(cache: RuntimeReadCache | null, repositoryId: string) {
  return cache ? pending.get(cache)?.get(repositoryId) : undefined
}

export function acknowledgePullList(
  cache: RuntimeReadCache | null,
  repositoryId: string,
  revision: symbol | undefined,
) {
  if (cache && revision && pending.get(cache)?.get(repositoryId) === revision)
    pending.get(cache)?.delete(repositoryId)
}
