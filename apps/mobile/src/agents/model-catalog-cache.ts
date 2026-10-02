import {
  decodeResult,
  modelCatalogSchema,
  modelDiscoveryInput,
  type AgentDiscovery,
  type RuntimeProfile,
  type ModelCatalog,
} from '@dovo/protocol'

type Storage = {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
}
export function mobileModelCatalogKey(profile: RuntimeProfile | undefined, agent: AgentDiscovery) {
  return JSON.stringify([
    profile?.id,
    profile?.connection.address,
    profile?.connection.token,
    modelDiscoveryInput(agent),
  ])
}
const storageKey = 'dovo.model-catalogs.v1'
const ttl = 5 * 60_000
const limit = 64

/** Only hashed scope identities and provider presentation metadata are persisted. */
export class MobileModelCatalogCache {
  private entries = new Map<string, { value: ModelCatalog; expires: number }>()
  private saved = new Map<string, ModelCatalog>()
  private identities = new Map<string, Promise<string>>()
  private pending = new Map<string, Promise<ModelCatalog>>()
  private listeners = new Set<() => void>()
  private ready: Promise<void> | undefined
  private writing = Promise.resolve()
  constructor(
    private storage: Storage,
    private hash: (key: string) => Promise<string>,
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  peek(key: string) {
    return this.entries.get(key)?.value ?? null
  }
  isFresh(key: string) {
    return (this.entries.get(key)?.expires ?? 0) > Date.now()
  }
  private publish() {
    for (const listener of this.listeners) listener()
  }
  private trim() {
    while (this.entries.size > limit) {
      const oldest = this.entries.keys().next().value
      if (oldest !== undefined) {
        this.entries.delete(oldest)
        this.identities.delete(oldest)
      }
    }
    while (this.identities.size > limit * 2) {
      const oldest = this.identities.keys().next().value
      if (oldest !== undefined) this.identities.delete(oldest)
    }
  }
  private restore() {
    return (this.ready ??= this.storage
      .getItem(storageKey)
      .then((value) => {
        const data: unknown = JSON.parse(value ?? '[]')
        if (!Array.isArray(data)) return
        for (const entry of data.slice(-limit)) {
          if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string') continue
          const result = decodeResult(modelCatalogSchema, entry[1])
          if (result.success) this.saved.set(entry[0], result.data)
        }
      })
      .catch((error: unknown) => console.warn('Could not restore model names', error)))
  }
  async ensure(key: string) {
    let identity = this.identities.get(key)
    if (!identity) {
      identity = this.hash(key)
      this.identities.set(key, identity)
      this.trim()
    }
    const [digest] = await Promise.all([identity, this.restore()])
    const value = this.saved.get(digest)
    if (!this.entries.has(key) && value) {
      this.entries.set(key, { value, expires: 0 })
      this.trim()
      this.publish()
    }
    return digest
  }
  async load(key: string, request: () => Promise<ModelCatalog>, refresh = false) {
    const digest = await this.ensure(key)
    const cached = this.entries.get(key)
    if (!refresh && cached && cached.expires > Date.now()) return cached.value
    const running = this.pending.get(key)
    if (running) return running
    const pending = Promise.resolve()
      .then(request)
      .then((value) => {
        this.entries.delete(key)
        this.entries.set(key, { value, expires: Date.now() + ttl })
        this.saved.delete(digest)
        // ACP config values can contain private settings; rediscover them on the host.
        this.saved.set(digest, {
          models: value.models,
          reasoning: value.reasoning,
          harness: value.harness,
          codex: value.codex,
        })
        this.trim()
        while (this.saved.size > limit) {
          const oldest = this.saved.keys().next().value
          if (oldest !== undefined) this.saved.delete(oldest)
        }
        this.publish()
        const persisted = JSON.stringify([...this.saved])
        this.writing = this.writing
          .then(() => this.storage.setItem(storageKey, persisted))
          .catch((error: unknown) => console.warn('Could not save model names', error))
        return value
      })
      .finally(() => this.pending.delete(key))
    this.pending.set(key, pending)
    return pending
  }
}
