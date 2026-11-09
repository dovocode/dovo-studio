import type { StateStorage } from './state.js'

/** Adapter for atomic string stores: localStorage, IndexedDB transactions, SQLite rows,
 * or a native file written through a temporary file and rename. I/O errors propagate.
 * Snapshots and their journal entries are immutable after they reach this adapter. */
export function jsonStateStorage(adapter: {
  read(): string | undefined | null | Promise<string | undefined | null>
  write(value: string): void | Promise<void>
  update?(change: (current: string | null) => string): Promise<string>
}): StateStorage {
  const atomicUpdate = adapter.update?.bind(adapter)
  const keys = new WeakMap<object, string>()
  // An update store appends to a retained journal array. Reuse the text of each retained
  // entry, so a changed write encodes only the new entries of a large archive.
  const entries = new WeakMap<object, string>()
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
  const entry = (value: unknown) => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
    let raw = entries.get(value)
    if (raw === undefined) {
      raw = JSON.stringify(value) ?? 'null'
      entries.set(value, raw)
    }
    return raw
  }
  const stringify = (value: unknown, retained: boolean) => {
    if (!retained || value === null || typeof value !== 'object' || !('journal' in value))
      return JSON.stringify(value)
    const { journal, ...rest } = value
    if (!Array.isArray(journal) || 'toJSON' in value) return JSON.stringify(value)
    const head = JSON.stringify(rest)
    return `${head.slice(0, -1)}${head.length > 2 ? ',' : ''}"journal":[${journal.map(entry).join(',')}]}`
  }
  const encode = (value: unknown, retained = false) => {
    const raw = stringify(value, retained)
    if (value && typeof value === 'object') {
      keys.set(value, raw)
      // The store returns this text after a commit. Do not parse the archive again.
      cachedRaw = raw
      cached = value
    }
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
              return next === value && raw !== null ? raw : encode(next, true)
            })
            return parse(committed)
          },
        }
      : {}),
  }
}
