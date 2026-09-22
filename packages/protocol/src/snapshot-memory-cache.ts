import type { RuntimeConnection } from './runtime.js'

type Entry = {
  origin: string
  token: string
  tag: string
  body: string
  expires: number
}
const entries = new Map<string, Entry>()
const lifetime = 5 * 60 * 1000
const maximumBytes = 32 * 1024 * 1024
let expiryTimer: ReturnType<typeof setTimeout> | undefined
let generation = 0
const keyFor = (origin: string, token: string) => JSON.stringify([origin, token])

function expire() {
  const now = Date.now()
  for (const [key, entry] of entries) if (entry.expires <= now) entries.delete(key)
}
function scheduleExpiry() {
  clearTimeout(expiryTimer)
  if (!entries.size) return
  const next = Math.min(...[...entries.values()].map((entry) => entry.expires))
  expiryTimer = setTimeout(
    () => {
      expire()
      scheduleExpiry()
    },
    Math.max(0, next - Date.now()),
  )
  // Do not keep a CLI process alive solely for a disposable response cache.
  const timer: unknown = expiryTimer
  if (timer && typeof timer === 'object' && 'unref' in timer && typeof timer.unref === 'function')
    timer.unref()
}

export function clearRuntimeRequestCache(connection?: RuntimeConnection) {
  generation++
  if (connection) {
    const origin = new URL(connection.address).origin
    for (const [key, entry] of entries)
      if (entry.origin === origin && entry.token === connection.token) entries.delete(key)
  } else entries.clear()
  scheduleExpiry()
}

export function snapshotResponseCache(origin: string, token: string) {
  expire()
  const key = keyFor(origin, token)
  const currentGeneration = generation
  const cached = entries.get(key)
  if (cached) {
    entries.delete(key)
    cached.expires = Date.now() + lifetime
    entries.set(key, cached)
    scheduleExpiry()
  }
  return {
    tag: cached?.tag,
    body() {
      return cached && currentGeneration === generation && entries.get(key) === cached
        ? cached.body
        : undefined
    },
    remove() {
      if (currentGeneration !== generation) return
      entries.delete(key)
      scheduleExpiry()
    },
    save(tag: string | null, body: string) {
      if (currentGeneration !== generation) return
      entries.delete(key)
      // Count UTF-16 string storage, not the compressed Content-Length on the wire.
      if (tag && tag.length <= 200 && body.length * 2 <= maximumBytes) {
        entries.set(key, { origin, token, tag, body, expires: Date.now() + lifetime })
        let bytes = [...entries.values()].reduce((size, entry) => size + entry.body.length * 2, 0)
        for (const [oldKey, entry] of entries) {
          if (entries.size <= 8 && bytes <= maximumBytes) break
          entries.delete(oldKey)
          bytes -= entry.body.length * 2
        }
      }
      scheduleExpiry()
    },
  }
}
