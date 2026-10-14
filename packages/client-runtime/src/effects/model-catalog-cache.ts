export type ModelCatalogCacheScope = { key: string; presentationKey: string }
export type ModelCatalogCacheStorage = {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
}
type Options<T> = {
  storage: ModelCatalogCacheStorage
  hash: (key: string) => Promise<string>
  decode: (value: unknown) => T | null
  presentation: (value: T) => T
}
type Entry<T> = { value: T; expires: number; cacheable: boolean; bytes: number }
const limit = 64
const maxBytes = 2 * 1024 * 1024
const storageKey = 'dovo.model-catalogs.v2'
const bytes = (value: string) => value.length * 2

/** Last-good display metadata survives reloads; live settings never cross runtime instances. */
export class ModelCatalogCache<T extends { models: readonly unknown[] }> {
  private readonly entries = new Map<string, Entry<T>>()
  private readonly presentations = new Map<string, Entry<T>>()
  private readonly saved = new Map<string, Entry<T>>()
  private readonly pending = new Map<string, Promise<T>>()
  private readonly hydrating = new Map<string, Promise<string | undefined>>()
  private readonly latest = new Map<string, object>()
  private readonly listeners = new Set<() => void>()
  private ready: Promise<void> | undefined
  private writing: Promise<void> | undefined
  private dirty = false
  constructor(private readonly options: Options<T>) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  peek(scope: ModelCatalogCacheScope): T | null {
    const live = this.entries.get(scope.key)
    return live && live.expires > Date.now()
      ? live.value
      : (this.presentations.get(scope.presentationKey)?.value ?? null)
  }
  isFresh(scope: ModelCatalogCacheScope): boolean {
    const entry = this.entries.get(scope.key)
    return !!entry?.cacheable && entry.expires > Date.now()
  }
  private publish() {
    for (const listener of this.listeners) listener()
  }
  private put(map: Map<string, Entry<T>>, key: string, value: T, expires = 0, cacheable = true) {
    const size = bytes(JSON.stringify(value))
    if (size > maxBytes) return false
    map.delete(key)
    map.set(key, { value, expires, cacheable, bytes: size })
    let total = [...map.values()].reduce((sum, entry) => sum + entry.bytes, 0)
    while (map.size > limit || total > maxBytes) {
      const oldest = map.keys().next().value
      if (oldest === undefined) break
      total -= map.get(oldest)?.bytes ?? 0
      map.delete(oldest)
    }
    return true
  }
  private restore() {
    return (this.ready ??= Promise.resolve()
      .then(async () => {
        const raw = await this.options.storage.getItem(storageKey)
        if (!raw || bytes(raw) > maxBytes + 64 * 1024) return
        const data: unknown = JSON.parse(raw)
        if (!Array.isArray(data)) return
        for (const item of data.slice(-limit)) {
          if (
            !Array.isArray(item) ||
            item.length !== 2 ||
            typeof item[0] !== 'string' ||
            !/^[a-f0-9]{64}$/i.test(item[0])
          )
            continue
          const decoded = this.options.decode(item[1])
          if (!decoded?.models.length) continue
          this.put(this.saved, item[0], this.options.presentation(decoded))
        }
      })
      .catch((error: unknown) => console.warn('Could not restore model metadata', error)))
  }
  ensure(scope: ModelCatalogCacheScope): Promise<string | undefined> {
    const running = this.hydrating.get(scope.key)
    if (running) return running
    if (this.hydrating.size >= limit) return Promise.resolve(undefined)
    const promise = Promise.resolve()
      .then(async () => {
        const [digest] = await Promise.all([
          this.options.hash(scope.presentationKey),
          this.restore(),
        ])
        if (!/^[a-f0-9]{64}$/i.test(digest))
          throw new Error('Model catalog identity must be SHA256')
        const saved = this.saved.get(digest)
        if (!this.peek(scope) && saved) {
          this.put(this.presentations, scope.presentationKey, saved.value)
          this.publish()
        }
        return digest
      })
      .catch((error: unknown) => {
        console.warn('Could not restore model metadata identity', error)
        return undefined
      })
      .finally(() => this.hydrating.delete(scope.key))
    this.hydrating.set(scope.key, promise)
    return promise
  }
  private scheduleWrite() {
    this.dirty = true
    if (this.writing) return
    // One active write and one coalesced latest snapshot, never a queue of serialized catalogs.
    this.writing = Promise.resolve()
      .then(async () => {
        while (this.dirty) {
          this.dirty = false
          const raw = JSON.stringify([...this.saved].map(([key, entry]) => [key, entry.value]))
          try {
            await this.options.storage.setItem(storageKey, raw)
          } catch (error) {
            console.warn('Could not save model metadata', error)
          }
        }
      })
      .finally(() => {
        this.writing = undefined
        if (this.dirty) this.scheduleWrite()
      })
  }
  private remember(scope: ModelCatalogCacheScope, value: T, digest: string | undefined) {
    const safe = this.options.presentation(value)
    this.put(this.presentations, scope.presentationKey, safe)
    if (digest) {
      this.put(this.saved, digest, safe)
      this.scheduleWrite()
    }
  }
  load(
    scope: ModelCatalogCacheScope,
    request: () => Promise<T>,
    refresh = false,
    cachedRequest?: () => Promise<T | null>,
  ): Promise<T> {
    const running = this.pending.get(scope.key)
    if (running) return running
    const fresh = this.entries.get(scope.key)
    if (!refresh && fresh && this.isFresh(scope)) return Promise.resolve(fresh.value)
    if (this.pending.size >= limit)
      return Promise.reject(new Error('Too many model discoveries in progress'))
    const version = {}
    this.latest.delete(scope.presentationKey)
    this.latest.set(scope.presentationKey, version)
    if (this.latest.size > limit) {
      const oldest = this.latest.keys().next().value
      if (oldest !== undefined) this.latest.delete(oldest)
    }
    const current = () => this.latest.get(scope.presentationKey) === version
    const pending = Promise.resolve()
      .then(async () => {
        const digest = await this.ensure(scope)
        if (!this.peek(scope)?.models.length && cachedRequest) {
          let cached: T | null = null
          try {
            cached = await cachedRequest()
          } catch (error) {
            if (
              !(
                error &&
                typeof error === 'object' &&
                'status' in error &&
                (error.status === 404 || error.status === 405)
              )
            )
              throw error
          }
          if (cached?.models.length && current()) {
            this.remember(scope, cached, digest)
            this.publish()
          }
        }
        const value = await request()
        if (!current()) return value
        if (value.models.length) {
          if (!this.put(this.entries, scope.key, value, Date.now() + 5 * 60_000))
            this.entries.delete(scope.key)
          this.remember(scope, value, digest)
        } else {
          // Empty discovery can still supply live ACP controls. Keep names, with no success TTL.
          const previous = this.presentations.get(scope.presentationKey)?.value
          this.put(
            this.entries,
            scope.key,
            previous ? { ...previous, ...value, models: previous.models } : value,
            Date.now() + 5 * 60_000,
            false,
          )
        }
        this.publish()
        return this.peek(scope) ?? value
      })
      .catch((error: unknown) => {
        if (current()) {
          this.entries.delete(scope.key)
          this.publish()
        }
        throw error
      })
      .finally(() => this.pending.delete(scope.key))
    this.pending.set(scope.key, pending)
    return pending
  }
}
