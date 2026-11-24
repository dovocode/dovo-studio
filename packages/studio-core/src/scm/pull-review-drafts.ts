import { decode, pullCodeReviewDraftSchema, type RuntimeConnection } from '@dovo/protocol'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { Schema } from 'effect'

const entrySchema = Schema.Struct({
  value: pullCodeReviewDraftSchema,
  version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
})

type Entry = typeof entrySchema.Type
type Awaitable<A> = A | Promise<A>
type Storage = {
  getItem(key: string): Awaitable<string | null>
  setItem(key: string, value: string): Awaitable<void>
  removeItem(key: string): Awaitable<void>
}

export function pullReviewDraftScope(connection: RuntimeConnection | null) {
  return connection
    ? bytesToHex(
        sha256(
          utf8ToBytes(
            JSON.stringify([connection.runtimeId ?? connection.address, connection.token]),
          ),
        ),
      )
    : undefined
}

export function createPullReviewDraftStorage(storage: Storage) {
  const writes = new Map<string, Promise<void>>()
  const storageKey = (key: string) => 'dovo.pull-review-draft.v1.' + key
  const write = (key: string, run: () => Awaitable<void>) => {
    const previous = writes.get(key)
    try {
      const result = previous ? previous.catch(() => {}).then(run) : run()
      if (!result) return Promise.resolve()
      const pending = result.finally(() => {
        if (writes.get(key) === pending) writes.delete(key)
      })
      writes.set(key, pending)
      return pending
    } catch (error) {
      return Promise.reject(error)
    }
  }
  return {
    async read(key: string): Promise<Entry | undefined> {
      await writes.get(key)?.catch(() => {})
      const raw = await storage.getItem(storageKey(key))
      if (raw === null) return
      if (raw.length > 512_000) throw new Error('Invalid review draft length')
      return decode(entrySchema, JSON.parse(raw))
    },
    save(key: string, entry: Entry) {
      return write(key, () => {
        const raw = JSON.stringify(entry)
        if (raw.length > 512_000) throw new Error('Invalid review draft length')
        return storage.setItem(storageKey(key), raw)
      })
    },
    remove(key: string) {
      return write(key, () => storage.removeItem(storageKey(key)))
    },
  }
}

export type PullReviewDraftStorage = ReturnType<typeof createPullReviewDraftStorage>

export const browserPullReviewDraftStorage = createPullReviewDraftStorage({
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
  removeItem: (key) => localStorage.removeItem(key),
})
