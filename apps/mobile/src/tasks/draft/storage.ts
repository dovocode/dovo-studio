import { Effect, Schema } from 'effect'
import { decode, mutableStruct, mutableArray } from '@dovo/protocol'
import { runClientEffect } from '@dovo/client-runtime'
import { nativeEffect } from '../../runtime/state/native-effect'
import type { SendAttempt } from '../composer/send-attempts'
type Storage = {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
  removeItem: (key: string) => Promise<void>
}
const prefix = 'dovo-draft-record-v1:'
const recordSchema = mutableStruct({
  text: Schema.String,
  submission: Schema.optional(
    mutableStruct({
      attempt: mutableStruct({
        id: Schema.String,
        text: Schema.String,
        attachmentIds: mutableArray(Schema.String),
        mode: Schema.Literal('queue', 'steer'),
        title: Schema.optional(Schema.String),
        runId: Schema.optional(Schema.String),
      }),
      accepted: Schema.Boolean,
    }),
  ),
})
export type DraftRecord = Schema.Schema.Type<typeof recordSchema>
function decodeRecord(raw: string | null): DraftRecord | null {
  if (raw === null) return null
  return raw.startsWith(prefix)
    ? decode(recordSchema, JSON.parse(raw.slice(prefix.length)))
    : { text: raw }
}
const encodeRecord = (record: DraftRecord) =>
  record.submission ? prefix + JSON.stringify(record) : record.text

/** Draft text and its delivery identity share one durable record, scoped to computer/thread. */
export function createDraftStorage(storage: Storage) {
  const locks = new Map<string, { semaphore: Effect.Semaphore; users: number }>()
  const listeners = new Map<string, Set<(value: string) => void>>()
  const records = new Map<string, DraftRecord | null>()
  // Text already published to the composer may be ahead of serialized disk writes.
  const publishedText = new Map<string, string>()
  const dirty = new Set<string>()
  const serialize = <A, E>(key: string, operation: Effect.Effect<A, E>) =>
    Effect.suspend(() => {
      const lock = locks.get(key) ?? { semaphore: Effect.unsafeMakeSemaphore(1), users: 0 }
      locks.set(key, lock)
      lock.users++
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
  const load = (key: string, legacyKey?: string) =>
    Effect.gen(function* () {
      if (records.has(key)) return records.get(key) ?? null
      let raw = yield* nativeEffect(() => storage.getItem(key))
      if (raw === null && legacyKey) {
        raw = yield* nativeEffect(() => storage.getItem(legacyKey))
        if (raw !== null) {
          const legacy = raw
          yield* nativeEffect(() => storage.setItem(key, legacy))
          yield* nativeEffect(() => storage.removeItem(legacyKey))
        }
      }
      const record = yield* nativeEffect(() => decodeRecord(raw))
      records.set(key, record)
      return record
    })
  const save = (key: string, record: DraftRecord) =>
    Effect.gen(function* () {
      records.set(key, record)
      dirty.add(key)
      yield* nativeEffect(() => storage.setItem(key, encodeRecord(record)))
      dirty.delete(key)
    })
  const readRecordEffect = (
    key: string,
    legacyKey?: string,
    deliveredIds: readonly string[] | (() => readonly string[]) = [],
  ) =>
    serialize(
      key,
      Effect.gen(function* () {
        const record = yield* load(key, legacyKey)
        const submission = record?.submission
        if (
          !record ||
          !submission ||
          !(
            submission.accepted ||
            (typeof deliveredIds === 'function' ? deliveredIds() : deliveredIds).includes(
              submission.attempt.id,
            )
          )
        )
          return record
        const text = record.text.trim() === submission.attempt.text ? '' : record.text
        const next = { ...record, text, submission: { ...submission, accepted: true } }
        if (text !== record.text || !submission.accepted) {
          records.set(key, next)
          dirty.add(key)
        }
        return next
      }),
    )
  const readEffect = (key: string, legacyKey?: string) =>
    readRecordEffect(key, legacyKey).pipe(Effect.map((record) => record?.text ?? null))
  const writeEffect = (key: string, value: string, origin?: (value: string) => void) =>
    Effect.suspend(() => {
      publishedText.set(key, value)
      listeners.get(key)?.forEach((listener) => {
        if (listener !== origin) listener(value)
      })
      return serialize(
        key,
        Effect.gen(function* () {
          const previous = yield* load(key)
          yield* save(key, {
            ...previous,
            text: value,
            submission: previous?.submission?.accepted ? undefined : previous?.submission,
          })
        }),
      )
    })
  const stageEffect = (key: string, attempt: SendAttempt, initial: string) =>
    serialize(
      key,
      Effect.gen(function* () {
        const previous = yield* load(key)
        yield* save(key, {
          ...(previous ?? { text: initial }),
          submission: {
            attempt: { ...attempt, attachmentIds: [...attempt.attachmentIds] },
            accepted: false,
          },
        })
      }),
    )
  const confirmEffect = (key: string, attempt: SendAttempt, clear: boolean) =>
    serialize(
      key,
      Effect.gen(function* () {
        const previous = yield* load(key)
        if (!previous || previous.submission?.attempt.id !== attempt.id) return
        const current = publishedText.get(key) ?? previous.text
        const text = clear && current.trim() === attempt.text ? '' : current
        const next = { ...previous, text, submission: { ...previous.submission, accepted: true } }
        // Publish before awaiting storage, retaining the accepted record in memory if saving fails.
        if (text !== current) {
          publishedText.set(key, text)
          listeners.get(key)?.forEach((listener) => listener(text))
        }
        yield* save(key, next)
      }),
    )
  const flushEffect = () =>
    Effect.forEach(
      [...dirty],
      (key) =>
        serialize(
          key,
          Effect.gen(function* () {
            const record = records.get(key)
            if (record) yield* save(key, record)
          }),
        ),
      { discard: true },
    )
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
    readRecordEffect,
    readEffect,
    writeEffect,
    stageEffect,
    confirmEffect,
    flushEffect,
    read: (key: string, legacyKey?: string) => runClientEffect(readEffect(key, legacyKey)),
    write: (key: string, value: string) => runClientEffect(writeEffect(key, value)),
  }
}
