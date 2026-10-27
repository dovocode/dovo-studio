import { mutableStruct, mutableArray } from '../../shared/schema.js'
import { isoDateTime, decode } from '../../shared/schema.js'
import { Data, Effect, Result, Schema, Semaphore } from 'effect'
import type { RuntimeConnection } from '../connection/runtime.js'
import { snapshotSchema } from '../connection/runtime.js'
export const runtimeSnapshotCacheSchema = mutableStruct({
  cacheId: Schema.optional(Schema.String),
  snapshot: snapshotSchema,
  lastSeen: Schema.NullOr(isoDateTime(Schema.String)),
  pulls: Schema.NullOr(
    mutableStruct({
      total: Schema.Number.pipe(Schema.check(Schema.isFinite())),
      needsAttention: Schema.Number.pipe(Schema.check(Schema.isFinite())),
      reviewRequested: Schema.Number.pipe(Schema.check(Schema.isFinite())),
      partial: Schema.Boolean,
    }),
  ),
})
const snapshotFreshnessSchema = mutableStruct({
  cacheId: Schema.String,
  lastSeen: Schema.NullOr(isoDateTime(Schema.String)),
})
/** Durable storage-specific fence; contains only digests, never a connection token. */
export type ReadCacheGeneration = {
  key: string
  generation: string | null
  credential: string
  valid: boolean
}
export interface CacheStorage {
  captureGeneration?(connection: RuntimeConnection): ReadCacheGeneration
  generationCurrent?(generation: ReadCacheGeneration): boolean

  getItem(key: string, generation?: ReadCacheGeneration): Promise<string | null>
  setItem(key: string, value: string, generation?: ReadCacheGeneration): Promise<unknown>
  removeItem(key: string, generation?: ReadCacheGeneration): Promise<unknown>
  removePrefix(prefix: string, generation?: ReadCacheGeneration): Promise<void>
  /** Cross-context storage can commit an entry, eviction and index in one transaction. */
  writeIndexedItem?(
    prefix: string,
    key: string,
    value: string,
    limit: number,
    maxBytes: number,
    generation?: ReadCacheGeneration,
  ): Promise<void>
}
export const READ_CACHE_MAX_BYTES = 32 * 1024 * 1024
const byteEncoder = new TextEncoder()
const byteBuffer = new Uint8Array(16 * 1024)
/** Count large cached payloads without allocating a second full UTF-8 copy. */
export function readCacheBytes(value: string) {
  let bytes = 0
  for (let start = 0; start < value.length;) {
    let end = Math.min(start + 4096, value.length)
    // Keep a surrogate pair in one chunk; native TextEncoder handles malformed text.
    const last = value.charCodeAt(end - 1),
      next = value.charCodeAt(end)
    if (end < value.length && last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff)
      end--
    const chunk = value.slice(start, end)
    bytes +=
      typeof byteEncoder.encodeInto === 'function'
        ? byteEncoder.encodeInto(chunk, byteBuffer).written
        : byteEncoder.encode(chunk).byteLength
    start = end
  }
  return bytes
}

const indexEntry = mutableStruct({
  key: Schema.String,
  bytes: Schema.Number.pipe(
    Schema.check(Schema.isInt()),
    Schema.check(Schema.isGreaterThanOrEqualTo(0)),
  ),
})
export function readCacheIndex(raw: string | null) {
  try {
    return decode(mutableArray(Schema.Union([Schema.String, indexEntry])), JSON.parse(raw ?? '[]'))
  } catch {
    // Old string indexes are migrated; a malformed disposable index is replaced.
    return []
  }
}
export function boundReadCacheIndex(
  entries: Array<typeof indexEntry.Type>,
  limit: number,
  maxBytes: number,
) {
  let bytes = entries.reduce((total, entry) => total + entry.bytes, 0)
  let start = 0
  while (start < entries.length && (entries.length - start > limit || bytes > maxBytes))
    bytes -= entries[start++]!.bytes
  return entries.slice(start)
}
export type CachedRead<T> = {
  value: T
  cachedAt: string
}
export class ReadCacheError extends Data.TaggedError('ReadCacheError')<{
  readonly cause: unknown
}> {
  get message() {
    return this.cause instanceof Error ? this.cause.message : String(this.cause)
  }
}
export interface RuntimeReadCache {
  readonly closed: boolean
  readEffect<T extends Schema.Codec<unknown, unknown>>(
    key: string,
    schema: T,
  ): Effect.Effect<CachedRead<T['Type']> | null, ReadCacheError>
  writeEffect(key: string, value: unknown): Effect.Effect<void, ReadCacheError>
  removeEffect(key: string): Effect.Effect<void, ReadCacheError>
  clearEffect(): Effect.Effect<void, ReadCacheError>
  closeEffect(): Effect.Effect<void, ReadCacheError>
  read<T extends Schema.Codec<unknown, unknown>>(
    key: string,
    schema: T,
  ): Promise<CachedRead<T['Type']> | null>
  write(key: string, value: unknown): Promise<void>
  remove(key: string): Promise<void>
  clear(): Promise<void>
  close(): Promise<void>
}
const instances = new WeakMap<
  CacheStorage,
  Map<
    string,
    Set<{
      generation?: ReadCacheGeneration
      closeEffect: () => Effect.Effect<void, ReadCacheError>
    }>
  >
>()
const writers = new WeakMap<CacheStorage, Semaphore.Semaphore>()
const storageEffect = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => new ReadCacheError({ cause }) })
const runCache = async <A>(effect: Effect.Effect<A, ReadCacheError>): Promise<A> => {
  const result = await Effect.runPromise(Effect.result(effect))
  if (Result.isFailure(result)) throw result.failure
  return result.success
}
const envelope = mutableStruct({
  version: Schema.Literal(1),
  cachedAt: isoDateTime(Schema.String),
  value: Schema.Unknown,
})

/** Disposable read replicas only. Credentials and pending mutations never belong here. */
export function createRuntimeReadCache(
  connection: RuntimeConnection,
  storage: CacheStorage,
  digest: (value: string) => Promise<string>,
): RuntimeReadCache {
  const origin = new URL(connection.address).origin
  // Capture the nonsecret invalidation marker now, before a late network response.
  // Authoritative storage verifies the generation and credential inside each transaction.
  const captured = storage.captureGeneration?.(connection)
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
  // Memoize only successful initialization. A cancelled reader must not poison
  // every subsequent read/write with a cached interrupted Exit.
  let namespace: { host: string; prefix: string; generation?: ReadCacheGeneration } | undefined
  const scope = Effect.suspend(() =>
    namespace
      ? Effect.succeed(namespace)
      : Effect.all(
          [
            storageEffect(() => digest(origin)),
            storageEffect(() => digest(connection.token)),
            Effect.succeed(captured),
          ],
          { concurrency: 2 },
        ).pipe(
          Effect.map(([host, credential, generation]) => {
            namespace = {
              host: `dovo.read-cache.v1.${host}.`,
              prefix: `dovo.read-cache.v1.${host}.${credential}.`,
              generation,
            }
            return namespace
          }),
        ),
  )
  let closed = false
  const isClosed = () =>
    closed ||
    (captured !== undefined && (!captured.valid || storage.generationCurrent?.(captured) === false))
  let writer = writers.get(storage)
  if (!writer) {
    writer = Effect.runSync(Semaphore.make(1))
    writers.set(storage, writer)
  }
  const sharedWriter = writer
  const lifecycle = {
    generation: captured,
    closeEffect: (): Effect.Effect<void, ReadCacheError> =>
      Effect.suspend(() => {
        closed = true
        return sharedWriter.withPermits(1)(
          Effect.sync(() => {
            clients.delete(lifecycle)
          }),
        )
      }).pipe(Effect.uninterruptible),
  }
  clients.add(lifecycle)
  const readEffect: RuntimeReadCache['readEffect'] = (key, schema) =>
    Effect.gen(function* () {
      if (isClosed()) return null
      const { prefix, generation } = yield* scope
      const raw = yield* storageEffect(() => storage.getItem(prefix + key, generation))
      if (!raw || isClosed()) return null
      const freshness =
        key === 'snapshot'
          ? yield* storageEffect(() => storage.getItem(prefix + 'snapshot-freshness', generation))
          : null
      const stamp = freshness
        ? yield* Effect.result(
            Effect.try(() => {
              const stored = decode(envelope, JSON.parse(freshness))
              return { ...decode(snapshotFreshnessSchema, stored.value), cachedAt: stored.cachedAt }
            }),
          )
        : undefined
      const parsed = yield* Effect.result(
        Effect.try(() => {
          const cached = decode(envelope, JSON.parse(raw))
          let value = cached.value
          let cachedAt = cached.cachedAt
          if (
            stamp &&
            Result.isSuccess(stamp) &&
            value &&
            typeof value === 'object' &&
            'cacheId' in value &&
            value.cacheId === stamp.success.cacheId
          ) {
            value = { ...value, lastSeen: stamp.success.lastSeen }
            cachedAt = stamp.success.cachedAt
          }
          return { value: decode(schema, value), cachedAt }
        }),
      )
      if (Result.isSuccess(parsed)) return isClosed() ? null : parsed.success
      yield* sharedWriter
        .withPermits(1)(
          Effect.gen(function* () {
            // A newer write may have replaced the corrupt value while this read was decoding.
            const current = yield* storageEffect(() => storage.getItem(prefix + key, generation))
            if (current === raw)
              yield* storageEffect(() => storage.removeItem(prefix + key, generation))
          }),
        )
        .pipe(Effect.uninterruptible)
      return null
    })
  const writeEffect = (key: string, value: unknown) =>
    sharedWriter
      .withPermits(1)(
        Effect.gen(function* () {
          if (isClosed()) return
          const { prefix, generation } = yield* scope
          const encoded = yield* Effect.try({
            try: () => JSON.stringify({ version: 1, cachedAt: new Date().toISOString(), value }),
            catch: (cause) => new ReadCacheError({ cause }),
          })
          if (key === 'snapshot') {
            // Snapshots are pinned for offline startup, but must still have a byte ceiling.
            if (readCacheBytes(encoded) > READ_CACHE_MAX_BYTES) {
              yield* storageEffect(() => storage.removeItem(prefix + key, generation))
              return
            }
            yield* storageEffect(() => storage.setItem(prefix + key, encoded, generation))
            return
          }
          const writeIndexedItem = storage.writeIndexedItem?.bind(storage)
          if (writeIndexedItem) {
            yield* storageEffect(() =>
              writeIndexedItem(prefix, key, encoded, 100, READ_CACHE_MAX_BYTES, generation),
            )
            return
          }
          yield* storageEffect(() => storage.setItem(prefix + key, encoded, generation))
          const raw = yield* storageEffect(() => storage.getItem(prefix + '_index', generation))
          const previous = yield* Effect.forEach(readCacheIndex(raw), (item) =>
            typeof item === 'string'
              ? storageEffect(() => storage.getItem(prefix + item, generation)).pipe(
                  Effect.map((value) => ({
                    key: item,
                    bytes: value === null ? 0 : readCacheBytes(value),
                  })),
                )
              : Effect.succeed(item),
          )
          const entries = [
            ...previous.filter((item) => item.key !== key),
            { key, bytes: readCacheBytes(encoded) },
          ]
          const kept = boundReadCacheIndex(entries, 100, READ_CACHE_MAX_BYTES)
          yield* Effect.forEach(
            entries.slice(0, entries.length - kept.length),
            (old) => storageEffect(() => storage.removeItem(prefix + old.key, generation)),
            { discard: true },
          )
          yield* storageEffect(() =>
            storage.setItem(prefix + '_index', JSON.stringify(kept), generation),
          )
        }),
      )
      .pipe(Effect.uninterruptible)
  const removeEffect = (key: string) =>
    sharedWriter
      .withPermits(1)(
        Effect.gen(function* () {
          const { prefix, generation } = yield* scope
          yield* storageEffect(() => storage.removeItem(prefix + key, generation))
        }),
      )
      .pipe(Effect.uninterruptible)
  const clearEffect = () =>
    Effect.gen(function* () {
      const { host, prefix, generation } = yield* scope
      // Verify permission before propagating close locally: a newly constructed stale
      // credential can capture the current generation, but is absent from its allowlist.
      if (generation) {
        yield* storageEffect(() => storage.getItem(prefix + '_index', generation))
        if (!generation.valid) {
          yield* lifecycle.closeEffect()
          return
        }
      }
      // A delayed clear from an old registry must not close handles made by a later pairing.
      yield* Effect.forEach(
        [...clients].filter(
          (client) => !generation || client.generation?.generation === generation.generation,
        ),
        (client) => client.closeEffect(),
        {
          concurrency: 'unbounded',
          discard: true,
        },
      )
      yield* storageEffect(() => storage.removePrefix(host, generation))
    }).pipe(Effect.uninterruptible)
  return {
    get closed() {
      return isClosed()
    },
    readEffect,
    writeEffect,
    removeEffect,
    clearEffect,
    closeEffect: lifecycle.closeEffect,
    read: (key, schema) => runCache(readEffect(key, schema)),
    write: (key, value) => runCache(writeEffect(key, value)),
    remove: (key) => runCache(removeEffect(key)),
    clear: () => runCache(clearEffect()),
    close: () => runCache(lifecycle.closeEffect()),
  }
}
