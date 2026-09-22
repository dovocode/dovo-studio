import { z } from 'zod'
import type { RuntimeConnection } from './runtime.js'
import { snapshotSchema } from './runtime.js'

export const runtimeSnapshotCacheSchema = z.object({
  snapshot: snapshotSchema,
  lastSeen: z.iso.datetime().nullable(),
  pulls: z
    .object({
      total: z.number(),
      needsAttention: z.number(),
      reviewRequested: z.number(),
      partial: z.boolean(),
    })
    .nullable(),
})

export interface CacheStorage {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<unknown>
  removeItem(key: string): Promise<unknown>
  removePrefix(prefix: string): Promise<void>
}
export type CachedRead<T> = { value: T; cachedAt: string }
export interface RuntimeReadCache {
  read<T extends z.ZodType>(key: string, schema: T): Promise<CachedRead<z.output<T>> | null>
  write(key: string, value: unknown): Promise<void>
  remove(key: string): Promise<void>
  clear(): Promise<void>
  close(): Promise<void>
}
const instances = new WeakMap<CacheStorage, Map<string, Set<{ close: () => Promise<void> }>>>()
const envelope = z.object({ version: z.literal(1), cachedAt: z.iso.datetime(), value: z.unknown() })

/** Disposable read replicas only. Credentials and pending mutations never belong here. */
export function createRuntimeReadCache(
  connection: RuntimeConnection,
  storage: CacheStorage,
  digest: (value: string) => Promise<string>,
): RuntimeReadCache {
  const origin = new URL(connection.address).origin
  let hosts = instances.get(storage)
  if (!hosts) {
    hosts = new Map()
    instances.set(storage, hosts)
  }
  let clients = hosts.get(origin)
  if (!clients) {
    clients = new Set()
    hosts.set(origin, clients)
  }
  const scope = Promise.all([
    digest(new URL(connection.address).origin),
    digest(connection.token),
  ]).then(([host, credential]) => ({
    host: `dovo.read-cache.v1.${host}.`,
    prefix: `dovo.read-cache.v1.${host}.${credential}.`,
  }))
  let closed = false
  let pending = Promise.resolve()
  const lifecycle = {
    close: () => {
      closed = true
      return pending.finally(() => clients.delete(lifecycle))
    },
  }
  clients.add(lifecycle)
  const enqueue = (operation: () => Promise<void>) => {
    const result = pending.then(operation)
    pending = result.catch(() => undefined)
    return result
  }
  return {
    async read(key, schema) {
      if (closed) return null
      const { prefix } = await scope
      const raw = await storage.getItem(prefix + key)
      if (!raw || closed) return null
      try {
        const cached = envelope.parse(JSON.parse(raw))
        return { value: schema.parse(cached.value), cachedAt: cached.cachedAt }
      } catch {
        await storage.removeItem(prefix + key)
        return null
      }
    },
    write(key, value) {
      return enqueue(async () => {
        if (closed) return
        const { prefix } = await scope
        await storage.setItem(
          prefix + key,
          JSON.stringify({ version: 1, cachedAt: new Date().toISOString(), value }),
        )
        // Keep the workspace plus the most recently written 100 read results per credential.
        if (key === 'snapshot') return
        const raw = await storage.getItem(prefix + '_index')
        let keys: string[] = []
        try {
          keys = z.array(z.string()).parse(JSON.parse(raw ?? '[]'))
        } catch {
          /* A disposable index can be rebuilt. */
        }
        keys = [...keys.filter((item) => item !== key), key]
        for (const old of keys.slice(0, -100)) await storage.removeItem(prefix + old)
        await storage.setItem(prefix + '_index', JSON.stringify(keys.slice(-100)))
      })
    },
    remove(key) {
      return enqueue(async () => {
        const { prefix } = await scope
        await storage.removeItem(prefix + key)
      })
    },
    clear() {
      const writers = [...clients].map((client) => client.close())
      return Promise.all(writers).then(async () => {
        const { host } = await scope
        await storage.removePrefix(host)
      })
    },
    close: lifecycle.close,
  }
}
