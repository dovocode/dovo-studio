import { mutableStruct, mutableArray } from './schema.js'
import { isoDateTime, decode } from './schema.js'
import { Data, Effect, Either, Schema } from 'effect'
import type { RuntimeConnection } from './runtime.js'
import { snapshotSchema } from './runtime.js'
export const runtimeSnapshotCacheSchema = mutableStruct({
  snapshot: snapshotSchema,
  lastSeen: Schema.NullOr(isoDateTime(Schema.String)),
  pulls: Schema.NullOr(
    mutableStruct({
      total: Schema.Number.pipe(Schema.finite()),
      needsAttention: Schema.Number.pipe(Schema.finite()),
      reviewRequested: Schema.Number.pipe(Schema.finite()),
      partial: Schema.Boolean,
    }),
  ),
})
export interface CacheStorage {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<unknown>
  removeItem(key: string): Promise<unknown>
  removePrefix(prefix: string): Promise<void>
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
  readEffect<T extends Schema.Schema.AnyNoContext>(
    key: string,
    schema: T,
  ): Effect.Effect<CachedRead<Schema.Schema.Type<T>> | null, ReadCacheError>
  writeEffect(key: string, value: unknown): Effect.Effect<void, ReadCacheError>
  removeEffect(key: string): Effect.Effect<void, ReadCacheError>
  clearEffect(): Effect.Effect<void, ReadCacheError>
  closeEffect(): Effect.Effect<void, ReadCacheError>
  read<T extends Schema.Schema.AnyNoContext>(
    key: string,
    schema: T,
  ): Promise<CachedRead<Schema.Schema.Type<T>> | null>
  write(key: string, value: unknown): Promise<void>
  remove(key: string): Promise<void>
  clear(): Promise<void>
  close(): Promise<void>
}
const instances = new WeakMap<
  CacheStorage,
  Map<string, Set<{ closeEffect: () => Effect.Effect<void, ReadCacheError> }>>
>()
const storageEffect = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => new ReadCacheError({ cause }) })
const runCache = async <A>(effect: Effect.Effect<A, ReadCacheError>): Promise<A> => {
  const result = await Effect.runPromise(Effect.either(effect))
  if (Either.isLeft(result)) throw result.left
  return result.right
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
  let namespace: { host: string; prefix: string } | undefined
  const scope = Effect.suspend(() =>
    namespace
      ? Effect.succeed(namespace)
      : Effect.all(
          [storageEffect(() => digest(origin)), storageEffect(() => digest(connection.token))],
          { concurrency: 2 },
        ).pipe(
          Effect.map(([host, credential]) => {
            namespace = {
              host: `dovo.read-cache.v1.${host}.`,
              prefix: `dovo.read-cache.v1.${host}.${credential}.`,
            }
            return namespace
          }),
        ),
  )
  let closed = false
  const writer = Effect.runSync(Effect.makeSemaphore(1))
  const lifecycle = {
    closeEffect: (): Effect.Effect<void, ReadCacheError> =>
      Effect.suspend(() => {
        closed = true
        return writer.withPermits(1)(
          Effect.sync(() => {
            clients.delete(lifecycle)
          }),
        )
      }).pipe(Effect.uninterruptible),
  }
  clients.add(lifecycle)
  const readEffect: RuntimeReadCache['readEffect'] = (key, schema) =>
    Effect.gen(function* () {
      if (closed) return null
      const { prefix } = yield* scope
      const raw = yield* storageEffect(() => storage.getItem(prefix + key))
      if (!raw || closed) return null
      const parsed = yield* Effect.either(
        Effect.try(() => {
          const cached = decode(envelope, JSON.parse(raw))
          return { value: decode(schema, cached.value), cachedAt: cached.cachedAt }
        }),
      )
      if (Either.isRight(parsed)) return parsed.right
      yield* writer
        .withPermits(1)(
          Effect.gen(function* () {
            // A newer write may have replaced the corrupt value while this read was decoding.
            const current = yield* storageEffect(() => storage.getItem(prefix + key))
            if (current === raw) yield* storageEffect(() => storage.removeItem(prefix + key))
          }),
        )
        .pipe(Effect.uninterruptible)
      return null
    })
  const writeEffect = (key: string, value: unknown) =>
    writer
      .withPermits(1)(
        Effect.gen(function* () {
          if (closed) return
          const { prefix } = yield* scope
          const encoded = yield* Effect.try({
            try: () => JSON.stringify({ version: 1, cachedAt: new Date().toISOString(), value }),
            catch: (cause) => new ReadCacheError({ cause }),
          })
          yield* storageEffect(() => storage.setItem(prefix + key, encoded))
          if (key === 'snapshot') return
          const raw = yield* storageEffect(() => storage.getItem(prefix + '_index'))
          const parsed = yield* Effect.either(
            Effect.try(() => decode(mutableArray(Schema.String), JSON.parse(raw ?? '[]'))),
          )
          const previous = Either.isRight(parsed) ? parsed.right : []
          const keys = [...previous.filter((item) => item !== key), key]
          yield* Effect.forEach(
            keys.slice(0, -100),
            (old) => storageEffect(() => storage.removeItem(prefix + old)),
            { discard: true },
          )
          yield* storageEffect(() =>
            storage.setItem(prefix + '_index', JSON.stringify(keys.slice(-100))),
          )
        }),
      )
      .pipe(Effect.uninterruptible)
  const removeEffect = (key: string) =>
    writer
      .withPermits(1)(
        Effect.gen(function* () {
          const { prefix } = yield* scope
          yield* storageEffect(() => storage.removeItem(prefix + key))
        }),
      )
      .pipe(Effect.uninterruptible)
  const clearEffect = () =>
    Effect.gen(function* () {
      yield* Effect.forEach([...clients], (client) => client.closeEffect(), {
        concurrency: 'unbounded',
        discard: true,
      })
      const { host } = yield* scope
      yield* storageEffect(() => storage.removePrefix(host))
    }).pipe(Effect.uninterruptible)
  return {
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
