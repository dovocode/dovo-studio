import type { Agent } from '@dovo/protocol'
import type { AgentRegistry } from '../configuration/registry.js'
import { configuredModelCatalogKey } from './model-cache.js'

/** Cache actual provider probes, not bundled SDK presence. Configuration changes bypass the cache. */
export class HarnessAvailabilityCache {
  private entries = new Map<string, { expires: number; value: boolean }>()
  private pending = new Map<string, Promise<boolean>>()
  private active = 0
  private waiting: Array<() => void> = []

  /** One shared bounded queue prevents several clients from spawning a probe per choice. */
  private async probe(load: () => Promise<boolean>) {
    if (this.active < 4) this.active++
    else await new Promise<void>((resolve) => this.waiting.push(resolve))
    try {
      return await load()
    } finally {
      const next = this.waiting.shift()
      if (next) next()
      else this.active--
    }
  }

  check(
    agent: Agent,
    registry: Pick<AgentRegistry, 'configure' | 'launch' | 'get'>,
    refresh = false,
  ) {
    let key: string
    try {
      key = configuredModelCatalogKey(agent, registry)
    } catch {
      return Promise.resolve(false)
    }
    const running = this.pending.get(key)
    if (running) return running
    const cached = this.entries.get(key)
    if (!refresh && cached && cached.expires > Date.now()) return Promise.resolve(cached.value)
    if (this.pending.size >= 128) return Promise.resolve(false)
    this.entries.delete(key)
    const request = Promise.resolve()
      .then(() =>
        this.probe(async () => {
          if (key !== configuredModelCatalogKey(agent, registry)) return false
          const adapter = await registry.get(agent.provider)
          if (key !== configuredModelCatalogKey(agent, registry)) return false
          const value = (await adapter.probe(agent)).available
          return key === configuredModelCatalogKey(agent, registry) && value
        }),
      )
      .catch(() => false)
      .then((value) => {
        if (value) this.entries.set(key, { value, expires: Date.now() + 30_000 })
        if (this.entries.size > 128) {
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
