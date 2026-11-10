import { Effect, Schema, Semaphore } from 'effect'
import { turnSettingsSchema, decode, mutableStruct, mutableArray } from '@dovo/protocol'
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
  restored: Schema.optional(Schema.String),
  forked: Schema.optional(Schema.String),
  handoffReceipts: Schema.optional(mutableArray(Schema.String)),
  sideThreadCreation: Schema.optional(
    mutableStruct({ id: Schema.String, objective: Schema.String }),
  ),
  fork: Schema.optional(
    mutableStruct({
      id: Schema.String,
      sourceTaskId: Schema.String,
      text: Schema.String,
      draftText: Schema.String,
      attachmentIds: mutableArray(Schema.String),
      connection: Schema.String,
      accepted: Schema.Boolean,
    }),
  ),
  restore: Schema.optional(
    mutableStruct({
      requestId: Schema.String,
      messageId: Schema.String,
      text: Schema.String,
      attachmentIds: mutableArray(Schema.String),
      turnSettings: Schema.NullOr(turnSettingsSchema),
      draftTurnSettings: Schema.NullOr(turnSettingsSchema),
      connection: Schema.String,
    }),
  ),
  submission: Schema.optional(
    mutableStruct({
      attempt: mutableStruct({
        id: Schema.String,
        text: Schema.String,
        attachmentIds: mutableArray(Schema.String),
        mode: Schema.Literals(['queue', 'steer', 'stage', 'direct']),
        title: Schema.optional(Schema.String),
        runId: Schema.optional(Schema.String),
        turnSettings: Schema.optional(turnSettingsSchema),
        plan: Schema.optional(Schema.Boolean),
        preserveQueuePause: Schema.optional(Schema.Boolean),
      }),
      accepted: Schema.Boolean,
    }),
  ),
})
export type PendingFork = NonNullable<Schema.Schema.Type<typeof recordSchema>['fork']>
export type PendingQueueRestore = NonNullable<Schema.Schema.Type<typeof recordSchema>['restore']>
export type DraftRecord = Schema.Schema.Type<typeof recordSchema>
function decodeRecord(raw: string | null): DraftRecord | null {
  if (raw === null) return null
  return raw.startsWith(prefix)
    ? decode(recordSchema, JSON.parse(raw.slice(prefix.length)))
    : { text: raw }
}
const encodeRecord = (record: DraftRecord) =>
  record.submission ||
  record.restore ||
  record.restored ||
  record.fork ||
  record.forked ||
  record.handoffReceipts?.length ||
  record.sideThreadCreation
    ? prefix + JSON.stringify(record)
    : record.text

/** Draft text and its delivery identity share one durable record, scoped to computer/thread. */
export function createDraftStorage(storage: Storage) {
  const locks = new Map<string, { semaphore: Semaphore.Semaphore; users: number }>()
  const listeners = new Map<string, Set<(value: string) => void>>()
  const records = new Map<string, DraftRecord | null>()
  // Text already published to the composer may be ahead of serialized disk writes.
  const publishedText = new Map<string, string>()
  const pendingWrites = new Map<string, { text: string; revision: number; done?: Promise<void> }>()
  let revision = 0
  const appendedAt = new Map<string, number>()
  const dirty = new Set<string>()
  const serialize = <A, E>(key: string, operation: Effect.Effect<A, E>, coalescing = false) =>
    Effect.suspend(() => {
      // Reads, appends and delivery records separate text batches. Later typing must
      // never move across one of these operations when old keystrokes are combined.
      if (!coalescing) pendingWrites.delete(key)
      const lock = locks.get(key) ?? { semaphore: Semaphore.makeUnsafe(1), users: 0 }
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
          if (!publishedText.has(key) || publishedText.get(key) === record.text)
            publishedText.set(key, text)
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
      const writing = ++revision
      publishedText.set(key, value)
      listeners.get(key)?.forEach((listener) => {
        if (listener !== origin) listener(value)
      })
      const pending = pendingWrites.get(key)
      const pendingDone = pending?.done
      if (pending && pendingDone) {
        pending.text = value
        pending.revision = writing
        return nativeEffect(() => pendingDone)
      }
      const batch: { text: string; revision: number; done?: Promise<void> } = {
        text: value,
        revision: writing,
      }
      pendingWrites.set(key, batch)
      const done = Effect.runPromise(
        serialize(
          key,
          Effect.gen(function* () {
            const previous = yield* load(key)
            if (pendingWrites.get(key) === batch) pendingWrites.delete(key)
            if (batch.revision < (appendedAt.get(key) ?? 0)) return
            yield* save(key, {
              ...previous,
              text: batch.text,
              submission: previous?.submission?.accepted ? undefined : previous?.submission,
            })
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                if (pendingWrites.get(key) === batch) pendingWrites.delete(key)
              }),
            ),
          ),
          true,
        ),
      )
      batch.done = done
      return nativeEffect(() => done)
    })
  const appendEffect = (
    key: string,
    text: string,
    initial: string,
    receiptId?: string,
    legacyKey?: string,
  ) =>
    serialize(
      key,
      Effect.gen(function* () {
        const previous = yield* load(key, legacyKey)
        const current = publishedText.get(key) ?? previous?.text ?? initial
        if (receiptId && previous?.handoffReceipts?.includes(receiptId)) {
          if (dirty.has(key)) yield* save(key, previous)
          return
        }
        // A fresh device can hydrate the server draft after this handoff was persisted there.
        const value =
          receiptId && !previous && !publishedText.has(key) && current.includes(text)
            ? current
            : [current, text].filter(Boolean).join('\n\n')
        appendedAt.set(key, ++revision)
        publishedText.set(key, value)
        listeners.get(key)?.forEach((listener) => listener(value))
        yield* save(key, {
          ...previous,
          text: value,
          ...(receiptId
            ? { handoffReceipts: [...(previous?.handoffReceipts ?? []), receiptId] }
            : {}),
          submission: previous?.submission?.accepted ? undefined : previous?.submission,
        })
      }),
    )
  const stageForkEffect = (key: string, fork: PendingFork, initial: string) =>
    serialize(
      key,
      Effect.gen(function* () {
        const previous = yield* load(key)
        if (previous?.restore)
          return yield* Effect.fail(new Error('Resolve the pending queued-message restore first'))
        if (previous?.submission && !previous.submission.accepted)
          return yield* Effect.fail(
            new Error('Resolve the pending message delivery before starting a fork'),
          )
        if (previous?.fork && previous.fork.id !== fork.id)
          return yield* Effect.fail(new Error('Resolve the pending fork first'))
        // Retry uses the original payload, including attachment ids and acceptance state.
        const pending = previous?.fork ?? {
          ...fork,
          accepted: fork.accepted || previous?.forked === fork.id,
        }
        yield* save(key, {
          ...previous,
          text: publishedText.get(key) ?? previous?.text ?? initial,
          fork: pending,
        })
        return pending
      }),
    )
  const confirmForkEffect = (key: string, id: string) =>
    serialize(
      key,
      Effect.gen(function* () {
        const previous = yield* load(key)
        if (!previous?.fork || previous.fork.id !== id) return
        const fork = { ...previous.fork, accepted: true }
        const current = publishedText.get(key) ?? previous.text
        const text = !previous.fork.accepted && current === fork.draftText ? '' : current
        // Acceptance and its conditional clear share a record. Subsequent retries never
        // clear a follow-up, even if the user deliberately types the same text again.
        appendedAt.set(key, ++revision)
        if (text !== current) {
          publishedText.set(key, text)
          listeners.get(key)?.forEach((listener) => listener(text))
        }
        yield* save(key, { ...previous, text, fork })
        return fork
      }),
    )
  const finishForkEffect = (key: string, id: string) =>
    serialize(
      key,
      Effect.gen(function* () {
        const previous = yield* load(key)
        if (previous?.fork?.id === id || (!previous?.fork && previous?.forked === id))
          yield* save(key, { ...previous, fork: undefined, forked: id })
      }),
    )
  const discardForkEffect = (key: string, id: string) =>
    serialize(
      key,
      Effect.gen(function* () {
        const previous = yield* load(key)
        if (previous && (!previous.fork || previous.fork.id === id))
          yield* save(key, { ...previous, fork: undefined })
      }),
    )
  const stageRestoreEffect = (key: string, restore: PendingQueueRestore, initial: string) =>
    serialize(
      key,
      Effect.gen(function* () {
        const previous = yield* load(key)
        if (previous?.fork) return yield* Effect.fail(new Error('Resolve the pending fork first'))
        if (previous?.restored === restore.requestId) {
          yield* save(key, previous)
          return
        }
        if (previous?.restore && previous.restore.requestId !== restore.requestId)
          return yield* Effect.fail(new Error('Resolve the pending queued-message restore first'))
        yield* save(key, {
          ...previous,
          text: publishedText.get(key) ?? previous?.text ?? initial,
          restore,
        })
      }),
    )
  const confirmRestoreEffect = (key: string, requestId: string) =>
    serialize(
      key,
      Effect.gen(function* () {
        const previous = yield* load(key)
        if (previous?.restored === requestId) {
          yield* save(key, previous)
          return
        }
        if (!previous?.restore || previous.restore.requestId !== requestId) return
        const current = publishedText.get(key) ?? previous.text
        const text = [current, previous.restore.text].filter(Boolean).join('\n\n')
        // The append and clearing its intent share one durable write. A restart either
        // retries the old intent or sees the complete append, never both.
        appendedAt.set(key, ++revision)
        publishedText.set(key, text)
        listeners.get(key)?.forEach((listener) => listener(text))
        yield* save(key, {
          ...previous,
          text,
          restore: undefined,
          restored: requestId,
          submission: previous.submission?.accepted ? undefined : previous.submission,
        })
      }),
    )
  const discardRestoreEffect = (key: string, requestId: string) =>
    serialize(
      key,
      Effect.gen(function* () {
        const previous = yield* load(key)
        if (previous?.restore?.requestId === requestId)
          yield* save(key, { ...previous, restore: undefined })
      }),
    )
  const stageEffect = (key: string, attempt: SendAttempt, initial: string) =>
    serialize(
      key,
      Effect.gen(function* () {
        const previous = yield* load(key)
        if (previous?.fork) return yield* Effect.fail(new Error('Resolve the pending fork first'))
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
        if (previous.submission.accepted && previous.text === text && !dirty.has(key)) return
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
    prepareSideThreadEffect: (
      key: string,
      id: string,
      objective: string,
      initial: string,
      legacyKey?: string,
    ) =>
      serialize(
        key,
        Effect.gen(function* () {
          const previous = yield* load(key, legacyKey)
          if (previous?.sideThreadCreation?.objective === objective) {
            if (dirty.has(key)) yield* save(key, previous)
            return previous.sideThreadCreation.id
          }
          yield* save(key, {
            ...previous,
            text: publishedText.get(key) ?? previous?.text ?? initial,
            sideThreadCreation: { id, objective },
          })
          return id
        }),
      ),
    finishSideThreadEffect: (key: string, id: string) =>
      serialize(
        key,
        Effect.gen(function* () {
          const previous = yield* load(key)
          if (previous?.sideThreadCreation?.id !== id) return
          yield* save(key, {
            ...previous,
            text: publishedText.get(key) ?? previous.text,
            sideThreadCreation: undefined,
          }).pipe(
            Effect.catch((error) => {
              records.set(key, previous)
              return Effect.fail(error)
            }),
          )
        }),
      ),
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
    appendEffect,
    stageForkEffect,
    confirmForkEffect,
    finishForkEffect,
    discardForkEffect,
    stageRestoreEffect,
    confirmRestoreEffect,
    discardRestoreEffect,
    stageEffect,
    confirmEffect,
    flushEffect,
    read: (key: string, legacyKey?: string) => runClientEffect(readEffect(key, legacyKey)),
    write: (key: string, value: string) => runClientEffect(writeEffect(key, value)),
  }
}
