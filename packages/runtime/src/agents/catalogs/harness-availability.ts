import { modelDiscoveryInput, type Agent } from '@dovo/protocol'
import type { AgentRegistry } from '../configuration/registry.js'

/** Cache actual provider probes, not bundled SDK presence. Configuration changes bypass the cache. */
export class HarnessAvailabilityCache {
  private entries = new Map<string, { expires: number; value: boolean }>()
  private pending = new Map<string, Promise<boolean>>()

  check(
    agent: Agent,
    registry: Pick<AgentRegistry, 'configure' | 'launch' | 'get'>,
    refresh = false,
  ) {
    let key: string
    try {
      key = JSON.stringify([modelDiscoveryInput(registry.configure(agent)), registry.launch(agent)])
    } catch {
      return Promise.resolve(false)
    }
    const cached = this.entries.get(key)
    if (!refresh && cached && cached.expires > Date.now()) return Promise.resolve(cached.value)
    const running = this.pending.get(key)
    if (running) return running
    const request = Promise.resolve()
      .then(async () => (await (await registry.get(agent.provider)).probe(agent)).available)
      .catch(() => false)
      .then((value) => {
        this.entries.delete(key)
        this.entries.set(key, { value, expires: Date.now() + 30_000 })
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
