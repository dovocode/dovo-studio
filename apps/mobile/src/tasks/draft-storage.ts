import { Effect } from 'effect'
import { runClientEffect } from '@dovo/client-runtime'
import { nativeEffect } from '../runtime/native-effect'
type Storage = {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
  removeItem: (key: string) => Promise<void>
}

/** A reopened thread must wait for saves owned by its previous screen. */
export function createDraftStorage(storage: Storage) {
  const locks = new Map<string, { semaphore: Effect.Semaphore; users: number }>()
  const listeners = new Map<string, Set<(value: string) => void>>()
  const serialize = <A, E>(key: string, operation: Effect.Effect<A, E>) =>
    Effect.suspend(() => {
      const lock = locks.get(key) ?? { semaphore: Effect.unsafeMakeSemaphore(1), users: 0 }
      locks.set(key, lock)
      lock.users++
      // Native storage cannot be cancelled. Keep its permit until it really settles.
      return lock.semaphore
        .withPermits(1)(operation)
        .pipe(
          Effect.uninterruptible,
          Effect.ensuring(
            Effect.sync(() => {
              if (--lock.users === 0) locks.delete(key)
            }),
          ),
        )
    })
  const readEffect = (key: string, legacyKey?: string) =>
    serialize(
      key,
      Effect.gen(function* () {
        const value = yield* nativeEffect(() => storage.getItem(key))
        if (value !== null || !legacyKey) return value
        const legacy = yield* nativeEffect(() => storage.getItem(legacyKey))
        if (legacy !== null) {
          yield* nativeEffect(() => storage.setItem(key, legacy))
          yield* nativeEffect(() => storage.removeItem(legacyKey))
        }
        return legacy
      }),
    )
  const writeEffect = (key: string, value: string) =>
    Effect.suspend(() => {
      listeners.get(key)?.forEach((listener) => listener(value))
      return serialize(
        key,
        nativeEffect(() => storage.setItem(key, value)),
      )
    })
  return {
    subscribe(key: string, listener: (value: string) => void) {
      const subscribers = listeners.get(key) ?? new Set<(value: string) => void>()
      subscribers.add(listener)
      listeners.set(key, subscribers)
      return () => {
        subscribers.delete(listener)
        if (!subscribers.size) listeners.delete(key)
      }
    },
    readEffect,
    writeEffect,
    read: (key: string, legacyKey?: string) => runClientEffect(readEffect(key, legacyKey)),
    write: (key: string, value: string) => runClientEffect(writeEffect(key, value)),
  }
}
