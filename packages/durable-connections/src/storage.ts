import type { StateStorage } from './state.js'

/** Adapter for atomic string stores: localStorage, IndexedDB transactions, SQLite rows,
 * or a native file written through a temporary file and rename. I/O errors propagate. */
export function jsonStateStorage(adapter: {
  read(): string | undefined | null | Promise<string | undefined | null>
  write(value: string): void | Promise<void>
  update?(change: (current: string | null) => string): Promise<string>
}): StateStorage {
  const atomicUpdate = adapter.update?.bind(adapter)
  const keys = new WeakMap<object, string>()
  let cachedRaw: string | null | undefined
  let cached: unknown
  const parse = (raw: string | null | undefined): unknown => {
    if (raw === null || raw === undefined) return undefined
    if (raw === cachedRaw) return cached
    const value: unknown = JSON.parse(raw)
    if (value && typeof value === 'object') keys.set(value, raw)
    cachedRaw = raw
    cached = value
    return value
  }
  const encode = (value: unknown) => {
    const raw = JSON.stringify(value)
    if (value && typeof value === 'object') keys.set(value, raw)
    return raw
  }
  return {
    load: async () => parse(await adapter.read()),
    save: (snapshot) => adapter.write(encode(snapshot)),
    contentKey: (value) => (value && typeof value === 'object' ? keys.get(value) : undefined),
    ...(atomicUpdate
      ? {
          update: async (change: (current: unknown) => unknown) => {
            const committed = await atomicUpdate((raw) => {
              const value = parse(raw)
              const next = change(value)
              return next === value && raw !== null ? raw : encode(next)
            })
            return parse(committed)
          },
        }
      : {}),
  }
}
