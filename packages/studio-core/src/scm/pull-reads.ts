import { Effect } from 'effect'
import { ConditionalReadCache, runClientEffect } from '@dovo/client-runtime'
import type { PullDetail, PullPage, pullDetailReadSchema, pullPageReadSchema } from '@dovo/protocol'

type DetailReply = typeof pullDetailReadSchema.Type
type PageReply = typeof pullPageReadSchema.Type
const details = new WeakMap<object, ConditionalReadCache<PullDetail>>()
const pages = new WeakMap<object, ConditionalReadCache<PullPage>>()

function read<T, E>(
  caches: WeakMap<object, ConditionalReadCache<T>>,
  owner: object,
  key: string,
  request: (
    version?: string,
  ) => Effect.Effect<({ readVersion?: string } & T) | { unchanged: true; readVersion: string }, E>,
  refresh: boolean,
) {
  let cache = caches.get(owner)
  if (!cache) {
    cache = new ConditionalReadCache<T>()
    caches.set(owner, cache)
  }
  return Effect.tryPromise({
    try: () =>
      cache.read(
        key,
        (version) =>
          runClientEffect(request(version)).then((reply) => {
            if ('unchanged' in reply) return { unchanged: true, version: reply.readVersion }
            return { value: reply, version: reply.readVersion }
          }),
        refresh,
      ),
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  })
}
export const readPullDetail = <E>(
  owner: object,
  key: string,
  request: (version?: string) => Effect.Effect<DetailReply, E>,
  refresh = false,
) => read(details, owner, key, request, refresh)
export const readPullPage = <E>(
  owner: object,
  key: string,
  request: (version?: string) => Effect.Effect<PageReply, E>,
  refresh = false,
) => read(pages, owner, key, request, refresh)
