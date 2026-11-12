import { Schema } from 'effect'
import { randomUUID } from '../../random-uuid.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { decode, mutableStruct } from '../../shared/schema.js'
import { attachmentSchema } from '../../shared/attachments.js'
import {
  pendingQuestionSchema,
  type PendingQuestion,
  type QuestionDraft,
  type QuestionAttachments,
} from './questions.js'

export function runtimeRecoveryScope(
  connection: { address: string; token: string; runtimeId?: string } | null | undefined,
) {
  return connection
    ? bytesToHex(
        sha256(
          utf8ToBytes(
            JSON.stringify([
              connection.runtimeId ?? new URL(connection.address).origin,
              connection.token,
            ]),
          ),
        ),
      )
    : 'local'
}
const entrySchema = mutableStruct({
  request: pendingQuestionSchema,
  drafts: Schema.Record(
    Schema.String,
    Schema.mutableKey(
      mutableStruct({ selected: Schema.mutable(Schema.Array(Schema.String)), text: Schema.String }),
    ),
  ),
  files: Schema.Record(
    Schema.String,
    Schema.mutableKey(Schema.mutable(Schema.Array(attachmentSchema))),
  ),
})
export type QuestionRecovery = {
  request: PendingQuestion
  drafts: Record<string, QuestionDraft>
  files: QuestionAttachments
}
type Storage = {
  getAllKeys(): readonly string[] | Promise<readonly string[]>
  getItem(key: string): string | null | Promise<string | null>
  setItem(key: string, value: string): void | Promise<void>
}

/** Ordinary answers only. Memory remains available when device storage fails. */
export function createQuestionRecovery(storage: Storage) {
  const scopes = new Map<
    string,
    {
      entries: QuestionRecovery[]
      loaded: boolean
      error: string
      version: number
      removed: Set<string>
      dirty: Map<
        string,
        { taskId: string; requestId: string; revision: string; answeredRevision?: string }
      >
      loading?: Promise<void>
    }
  >()
  const listeners = new Set<() => void>()
  const versions = new WeakMap<QuestionRecovery, string>()
  const legacyRevision = (entry: QuestionRecovery) =>
    `legacy:${bytesToHex(sha256(utf8ToBytes(JSON.stringify(entry))))}`
  const state = (scope: string) => {
    let value = scopes.get(scope)
    if (!value) {
      value = {
        entries: [],
        loaded: false,
        error: '',
        version: 0,
        removed: new Set(),
        dirty: new Map(),
      }
      scopes.set(scope, value)
    }
    return value
  }
  const publish = (scope: string) => {
    state(scope).version++
    listeners.forEach((listener) => listener())
  }
  const legacyKey = (scope: string) => `dovo.question-recovery.v1.${scope}`
  const prefix = (scope: string) => `dovo.question-recovery.v2.${scope}.`
  const identity = (taskId: string, requestId: string) => JSON.stringify([taskId, requestId])
  const key = (scope: string, taskId: string, requestId: string) =>
    prefix(scope) + encodeURIComponent(identity(taskId, requestId))
  const recordSchema = mutableStruct({
    taskId: Schema.String,
    requestId: Schema.String,
    entry: Schema.NullOr(entrySchema),
    revision: Schema.optional(Schema.String),
    answeredRevision: Schema.optional(Schema.String),
  })
  let saving: Promise<void> | undefined
  const mark = (scope: string, taskId: string, requestId: string, answeredRevision?: string) => {
    const change = { taskId, requestId, revision: randomUUID(), answeredRevision }
    state(scope).dirty.set(identity(taskId, requestId), change)
    return change
  }
  const answerKey = (scope: string, taskId: string, requestId: string, revision: string) =>
    `${key(scope, taskId, requestId)}.answered.${encodeURIComponent(revision)}`
  const save = (scope: string) => {
    const value = state(scope)
    if (!value.loaded) return
    // Write only explicit edits/removals. Loading or editing another request never rewrites
    // stale entries observed by this window. Independent windows have independent keys.
    for (const [id, change] of value.dirty) {
      const entry = change.answeredRevision
        ? null
        : (value.entries.find(
            (entry) =>
              entry.request.taskId === change.taskId && entry.request.id === change.requestId,
          ) ?? null)
      const encoded = JSON.stringify({ ...change, entry })
      const success = () => {
        if (value.dirty.get(id) === change) value.dirty.delete(id)
        if (!value.dirty.size && value.error) {
          value.error = ''
          publish(scope)
        }
      }
      const failure = (cause: unknown) => {
        value.error = `Could not save question answers. Keep this screen open. ${String(cause)}`
        publish(scope)
      }
      try {
        const write = () =>
          storage.setItem(
            change.answeredRevision
              ? answerKey(scope, change.taskId, change.requestId, change.answeredRevision)
              : key(scope, change.taskId, change.requestId),
            encoded,
          )
        const result = saving ? saving.then(write) : write()
        if (result) {
          const work = Promise.resolve(result).then(success, failure)
          saving = work
          void work.then(() => {
            if (saving === work) saving = undefined
          })
        } else success()
      } catch (cause) {
        failure(cause)
      }
    }
  }
  const load = (scope: string) => {
    const value = state(scope)
    if (value.loading) return value.loading
    value.loading = Promise.resolve()
      .then(async () => {
        const raw = await storage.getItem(legacyKey(scope))
        const legacy = raw === null ? [] : decode(Schema.Array(entrySchema), JSON.parse(raw))
        const records = new Map(
          legacy.map((entry) => [identity(entry.request.taskId, entry.request.id), entry]),
        )
        for (const entry of legacy) versions.set(entry, legacyRevision(entry))
        const answered = new Map<string, Set<string>>()
        const keys = (await storage.getAllKeys()).filter((name) => name.startsWith(prefix(scope)))
        for (const name of keys) {
          const raw = await storage.getItem(name)
          if (raw === null) continue
          const record = decode(recordSchema, JSON.parse(raw))
          if (
            (record.answeredRevision
              ? answerKey(scope, record.taskId, record.requestId, record.answeredRevision)
              : key(scope, record.taskId, record.requestId)) !== name ||
            (record.answeredRevision !== undefined && record.entry !== null) ||
            (record.entry &&
              (record.entry.request.taskId !== record.taskId ||
                record.entry.request.id !== record.requestId))
          )
            throw new Error('Saved question recovery identity is invalid')
          const id = identity(record.taskId, record.requestId)
          if (record.answeredRevision) {
            const revisions = answered.get(id) ?? new Set<string>()
            revisions.add(record.answeredRevision)
            answered.set(id, revisions)
          } else if (record.entry) {
            versions.set(record.entry, record.revision ?? legacyRevision(record.entry))
            records.set(id, record.entry)
          } else records.delete(id)
        }
        return [...records.entries()]
          .filter(
            ([id, entry]) => !answered.get(id)?.has(versions.get(entry) ?? legacyRevision(entry)),
          )
          .map(([, entry]) => entry)
      })
      .then((saved) => {
        // Edits made during asynchronous loading always win.
        value.entries = [
          ...value.entries.map((entry) => {
            const previous = saved.find(
              (item) =>
                item.request.id === entry.request.id &&
                item.request.taskId === entry.request.taskId,
            )
            if (!previous) return entry
            const ordinary = new Set(
              entry.request.prompt.questions.filter((q) => !q.secret).map((q) => q.id),
            )
            const merged = {
              ...entry,
              drafts: Object.fromEntries(
                Object.entries({ ...previous.drafts, ...entry.drafts }).filter(([id]) =>
                  ordinary.has(id),
                ),
              ),
              files: Object.fromEntries(
                Object.entries({ ...previous.files, ...entry.files }).filter(([id]) =>
                  ordinary.has(id),
                ),
              ),
            }
            const revision = versions.get(entry)
            if (revision) versions.set(merged, revision)
            return merged
          }),
          ...saved.filter(
            (item) =>
              !value.removed.has(JSON.stringify([item.request.taskId, item.request.id])) &&
              !value.entries.some(
                (entry) =>
                  entry.request.id === item.request.id &&
                  entry.request.taskId === item.request.taskId,
              ),
          ),
        ]
        value.loaded = true
        value.error = ''
        publish(scope)
        save(scope)
      })
      .catch((cause: unknown) => {
        // Permit another read without overwriting data that has not been read yet.
        value.loading = undefined
        value.error = `Could not restore question answers. Saved data was preserved. ${String(cause)}`
        publish(scope)
      })
    return value.loading
  }
  return {
    subscribe(this: void, listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    version: (scope: string) => state(scope).version,
    entries: (scope: string) => state(scope).entries,
    error: (scope: string) => state(scope).error,
    load,
    retry(scope: string) {
      if (state(scope).loaded) save(scope)
      else return load(scope)
    },
    update(
      scope: string,
      request: PendingQuestion,
      drafts?: Record<string, QuestionDraft>,
      files?: QuestionAttachments,
    ) {
      const value = state(scope)
      const old = value.entries.find(
        (entry) => entry.request.id === request.id && entry.request.taskId === request.taskId,
      )
      const ordinary = request.prompt.questions.filter((q) => !q.secret)
      const entry: QuestionRecovery = {
        request,
        drafts: Object.fromEntries(
          ordinary
            .filter((q) => {
              const draft = (drafts ?? old?.drafts)?.[q.id]
              return (
                draft &&
                (value.loaded ||
                  draft.text ||
                  draft.selected.length ||
                  Object.hasOwn(old?.drafts ?? {}, q.id))
              )
            })
            .map((q) => [q.id, (drafts ?? old?.drafts ?? {})[q.id]]),
        ),
        files: Object.fromEntries(
          ordinary
            .filter((q) => {
              const attachments = (files ?? old?.files)?.[q.id]
              return (
                attachments &&
                (value.loaded || attachments.length || Object.hasOwn(old?.files ?? {}, q.id))
              )
            })
            .map((q) => [q.id, (files ?? old?.files ?? {})[q.id]]),
        ),
      }
      value.entries = [...value.entries.filter((item) => item !== old), entry]
      versions.set(entry, mark(scope, request.taskId, request.id).revision)
      publish(scope)
      save(scope)
    },
    remove(scope: string, taskId: string, requestId: string, submitted?: QuestionRecovery | null) {
      const value = state(scope)
      if (
        submitted &&
        value.entries.find(
          (entry) => entry.request.taskId === taskId && entry.request.id === requestId,
        ) !== submitted
      )
        return
      value.removed.add(identity(taskId, requestId))
      // A confirmed answer consumes only the revision it submitted. A separate marker
      // cannot overwrite a newer record, even if another window writes during this callback.
      if (submitted === undefined) mark(scope, taskId, requestId)
      else if (submitted)
        mark(scope, taskId, requestId, versions.get(submitted) ?? legacyRevision(submitted))
      value.entries = value.entries.filter(
        (entry) => entry.request.id !== requestId || entry.request.taskId !== taskId,
      )
      publish(scope)
      save(scope)
    },
  }
}
