import type { ModelCatalog } from '@dovo/protocol'

const ttl = 5 * 60_000
const limit = 64

export class ModelCatalogCache {
  private entries = new Map<string, { expires: number; value: ModelCatalog }>()
  private pending = new Map<string, Promise<ModelCatalog>>()

  get(key: string, load: () => Promise<ModelCatalog>, refresh = false): Promise<ModelCatalog> {
    const cached = this.entries.get(key)
    if (!refresh && cached && cached.expires > Date.now()) return Promise.resolve(cached.value)
    const running = this.pending.get(key)
    if (running) return running
    const request = load()
      .then((value) => {
        this.entries.delete(key)
        this.entries.set(key, { expires: Date.now() + ttl, value })
        if (this.entries.size > limit) {
          const oldest = this.entries.keys().next().value
          if (oldest !== undefined) this.entries.delete(oldest)
        }
        return value
      })
      .finally(() => this.pending.delete(key))
    this.pending.set(key, request)
    return request
  }
}
