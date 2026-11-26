import { useEffect, useRef, useState } from 'react'
import { Alert } from 'react-native'
import { Result, Schema } from 'effect'
import { jiraDestination } from '../../scm/source-key'
import { clientScopeKey } from '@dovo/client-runtime'
import type { RuntimeConnection, RuntimeProfile, RuntimeSnapshot } from '@dovo/protocol'

export const detailDraftPressureMessage =
  'Your existing drafts are kept. Save or discard an existing draft of this type before editing another item.'

/** A key that stays the same after an app restart. It holds no pairing credentials. */
export type SavedDraftKey = string & { readonly computerDraftKey: unique symbol }
export type DetailDraftStorage = {
  getAllKeys(): Promise<readonly string[]>
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}
type DetailDraftPersistence<A> = {
  /** Stable storage name for this editor type. */
  name: string
  /** Fields to save. Encoding drops other fields, such as send receipts, so they stay in memory. */
  schema: Schema.Codec<A, unknown>
  storage: DetailDraftStorage
}
/** Why the phone does not hold the latest copy of a draft. The draft stays in memory. */
export type DraftStorageStatus =
  | 'read-failed'
  | 'write-failed'
  | 'too-large'
  | 'credential'
  | 'unreadable'
export type DraftPersistence = { status: DraftStorageStatus | undefined; retry: () => void }
export type DetailDrafts<A, K extends string = string> = {
  subscribe(key: K, listener: () => void): () => void
  read(key: K): A | undefined
  /** `fields` names the fields that this edit changed. Before the saved drafts load, other fields
   * of a saved draft still load. Without `fields`, the edit replaces the whole draft. */
  write(key: K, value: A, fields?: readonly (keyof A)[]): boolean
  /** Sets automatic defaults in memory. Unlike `write`, this is not a user edit: a saved draft
   * that loads later replaces it, and it starts no storage write by itself. */
  initialize(key: K, value: A): void
  /** Deletes the draft. A saved copy that loads later does not come back. */
  remove(key: K): void
  /** Present only for saved drafts. */
  storageStatus?(key: K): DraftStorageStatus | undefined
  retryStorage?(): void
  /** Resolves when the device holds this key's latest change, or cannot. Present only for saved
   * drafts. The result is the key's storage status, so `undefined` means the write succeeded. */
  settled?(key: K): Promise<DraftStorageStatus | undefined>
}
const storagePrefix = 'dovo.detail-drafts.v1.'
/** Android AsyncStorage cannot read a row larger than about 2 MB. */
export const detailDraftStorageLimit = 512_000
// The runtime projects saved MCP credentials as references. Any other value is a typed credential.
const storedSecretPrefix = 'dovo-stored-secret:'
function hasLiteralCredential(value: unknown, sensitive = false): boolean {
  if (typeof value === 'string')
    return sensitive && !!value && !value.startsWith(storedSecretPrefix)
  if (Array.isArray(value)) return value.some((entry) => hasLiteralCredential(entry, sensitive))
  if (value && typeof value === 'object')
    return Object.entries(value).some(([key, entry]) =>
      hasLiteralCredential(entry, sensitive || key === 'envValues' || key === 'headerValues'),
    )
  return false
}

/** Saves unsent text on the device, so an app restart keeps it. Only computer keys are accepted,
 * because a connection key is valid only in this app process. */
export function createDetailDrafts<A>(options: {
  limit?: number
  isClean?: (value: A) => boolean
  persist: DetailDraftPersistence<A>
}): DetailDrafts<A, SavedDraftKey>
/** Bounded field snapshots. Only explicitly clean entries may be evicted. */
export function createDetailDrafts<A>(options?: {
  limit?: number
  isClean?: (value: A) => boolean
}): DetailDrafts<A>
export function createDetailDrafts<A>({
  limit = 40,
  isClean = () => false,
  persist,
}: {
  limit?: number
  isClean?: (value: A) => boolean
  persist?: DetailDraftPersistence<A>
} = {}): DetailDrafts<A, string> {
  const entries = new Map<string, A>()
  const listeners = new Map<string, Set<() => void>>()
  const notify = (key: string) => listeners.get(key)?.forEach((listener) => listener())
  const notifyAll = () => [...listeners.keys()].forEach(notify)
  const durable = persist && createDurableEntries(persist, entries, isClean, notify, notifyAll)
  return {
    subscribe(key: string, listener: () => void) {
      durable?.load(true)
      const entry = listeners.get(key) ?? new Set<() => void>()
      entry.add(listener)
      listeners.set(key, entry)
      return () => {
        entry.delete(listener)
        if (!entry.size) listeners.delete(key)
      }
    },
    read(key: string) {
      durable?.load(false)
      const value = entries.get(key)
      if (value !== undefined) {
        entries.delete(key)
        entries.set(key, value)
      }
      return value
    },
    write(key: string, value: A, fields?: readonly (keyof A)[]) {
      if (!entries.has(key) && entries.size >= limit) {
        const clean = [...entries].find(([, entry]) => isClean(entry))
        if (clean) entries.delete(clean[0])
        // An empty new editor does not need to displace retained user text.
        else return isClean(value)
      }
      entries.delete(key)
      entries.set(key, value)
      durable?.changed(key, fields)
      notify(key)
      return true
    },
    initialize(key: string, value: A) {
      // A default never displaces a retained draft. The editor still shows it.
      if (!entries.has(key) && entries.size >= limit) return
      entries.delete(key)
      entries.set(key, value)
      durable?.initialized(key)
      notify(key)
    },
    remove(key: string) {
      entries.delete(key)
      durable?.changed(key)
      notify(key)
    },
    ...(durable && {
      storageStatus: (key: string) => durable.status(key),
      retryStorage: () => durable.retry(),
      settled: (key: string) => durable.settled(key),
    }),
  }
}

/** Saves each dirty entry as its own storage record, one write at a time. A large or unreadable
 * record therefore cannot block other drafts. An edit made before the saved records load is
 * newer, so loading never replaces the fields it changed. */
function createDurableEntries<A>(
  { name, schema, storage }: DetailDraftPersistence<A>,
  entries: Map<string, A>,
  isClean: (value: A) => boolean,
  notify: (key: string) => void,
  notifyAll: () => void,
) {
  const prefix = `${storagePrefix}${name}:`
  const decodeEntry = Schema.decodeUnknownResult(schema)
  const encodeEntry = Schema.encodeSync(schema)
  const issues = new Map<string, Exclude<DraftStorageStatus, 'read-failed'>>()
  /** Fields edited before the saved records load. `all` means the edit replaced the whole draft. */
  const editedBeforeLoad = new Map<string, ReadonlySet<keyof A> | 'all'>()
  const dirty = new Set<string>()
  let state: 'idle' | 'loading' | 'loaded' | 'failed' = 'idle'
  let writing = false
  let saving: string | undefined
  const waiters = new Map<string, Set<(status: DraftStorageStatus | undefined) => void>>()
  const status = (key: string): DraftStorageStatus | undefined =>
    state === 'failed' ? 'read-failed' : issues.get(key)
  /** A failed read cannot save anything until a retry. Otherwise a key settles after its save. */
  const isSettled = (key: string) =>
    state === 'failed' || (state === 'loaded' && !dirty.has(key) && saving !== key)
  const wake = () => {
    for (const [key, listeners] of waiters)
      if (isSettled(key)) {
        waiters.delete(key)
        listeners.forEach((resolve) => resolve(status(key)))
      }
  }
  const setIssue = (key: string, issue: DraftStorageStatus | undefined) => {
    if (issues.get(key) === issue) return
    if (issue && issue !== 'read-failed') issues.set(key, issue)
    else issues.delete(key)
    notify(key)
  }
  const load = async () => {
    state = 'loading'
    try {
      const keys = (await storage.getAllKeys()).filter((key) => key.startsWith(prefix))
      const records = await Promise.all(
        keys.map(async (key) => [key.slice(prefix.length), await storage.getItem(key)] as const),
      )
      // Apply nothing until every record is read, so a retry starts from the same state.
      for (const [key, raw] of records) {
        const edited = editedBeforeLoad.get(key)
        if (raw === null || edited === 'all') continue
        let parsed: unknown
        try {
          parsed = JSON.parse(raw)
        } catch {
          parsed = undefined
        }
        const result = decodeEntry(parsed)
        if (Result.isFailure(result)) setIssue(key, 'unreadable')
        else {
          const current = entries.get(key)
          entries.set(
            key,
            edited && current !== undefined
              ? withEdits(current, result.success, edited)
              : result.success,
          )
          notify(key)
        }
      }
      state = 'loaded'
      editedBeforeLoad.clear()
      void flush()
    } catch (error) {
      console.warn(`Could not read saved ${name} drafts:`, error)
      state = 'failed'
    }
    notifyAll()
    wake()
  }
  const save = async (key: string) => {
    const value = entries.get(key)
    try {
      if (value === undefined || isClean(value)) {
        await storage.removeItem(prefix + key)
        setIssue(key, undefined)
        return
      }
      const encoded = encodeEntry(value)
      const raw = JSON.stringify(encoded)
      const excluded = hasLiteralCredential(encoded)
        ? 'credential'
        : raw.length > detailDraftStorageLimit
          ? 'too-large'
          : undefined
      // An older saved copy must not come back in place of the text kept in memory.
      if (excluded) await storage.removeItem(prefix + key)
      else await storage.setItem(prefix + key, raw)
      setIssue(key, excluded)
    } catch (error) {
      console.warn(`Could not save a ${name} draft on this device:`, error)
      setIssue(key, 'write-failed')
    }
  }
  const flush = async () => {
    // Edits wait in memory until every saved record is read. A write before then could replace a
    // record that no read has seen, and a read that fails must leave saved records untouched.
    if (writing || state !== 'loaded') return
    writing = true
    try {
      for (let key = dirty.values().next(); !key.done; key = dirty.values().next()) {
        dirty.delete(key.value)
        saving = key.value
        try {
          await save(key.value)
        } finally {
          saving = undefined
        }
        wake()
      }
    } finally {
      writing = false
    }
  }
  return {
    /** An editor that opens again retries a failed read. A render never does. */
    load(retryFailed: boolean) {
      if (state === 'idle' || (retryFailed && state === 'failed')) void load()
    },
    changed(key: string, fields?: readonly (keyof A)[]) {
      if (state !== 'loaded') {
        const edited = editedBeforeLoad.get(key)
        editedBeforeLoad.set(
          key,
          !fields || edited === 'all' ? 'all' : new Set([...(edited ?? []), ...fields]),
        )
      }
      dirty.add(key)
      // A change can come before any editor reads. Its save needs a completed read first.
      if (state === 'idle') void load()
      else void flush()
    },
    initialized(key: string) {
      if (state === 'idle') void load()
      // A default is saved with the user's text, never alone. After a read it can join text that
      // loaded or was typed. Before that, a saved draft replaces a default, and an edit made during
      // startup is saved after the read with the default in it. Removing a record for a clean form could delete a saved
      // record that this device could not read.
      const value = entries.get(key)
      if (state === 'loaded' && value !== undefined && !isClean(value)) {
        dirty.add(key)
        void flush()
      }
    },
    status,
    settled(key: string) {
      if (state === 'idle') void load()
      if (isSettled(key)) return Promise.resolve(status(key))
      return new Promise<DraftStorageStatus | undefined>((resolve) => {
        const listeners = waiters.get(key) ?? new Set()
        listeners.add(resolve)
        waiters.set(key, listeners)
      })
    },
    retry() {
      for (const [key, issue] of issues) if (issue === 'write-failed') dirty.add(key)
      // A successful read flushes the dirty entries. Until then, flush writes nothing.
      if (state === 'idle' || state === 'failed') void load()
      else void flush()
    },
  }
}

/** A saved draft with the fields edited before it loaded. Fields kept only in memory, such as
 * send receipts and automatic defaults the saved draft does not hold, stay as they are. */
function withEdits<A>(current: A, saved: A, edited: ReadonlySet<keyof A>): A {
  const merged = { ...current, ...saved }
  for (const field of edited) merged[field] = current[field]
  return merged
}

export function detailDraftKey(connection: RuntimeConnection | null, ...entity: unknown[]) {
  return JSON.stringify([clientScopeKey(connection), ...entity])
}

/** The same verified computer keeps its profile ID and runtime ID after a renewed pairing.
 * Another computer later paired at the same address has another runtime ID. */
export function computerDraftKey(
  profile: Pick<RuntimeProfile, 'id' | 'connection'> | null,
  ...entity: unknown[]
) {
  return JSON.stringify([
    'computer',
    profile?.id ?? null,
    profile?.connection.runtimeId ?? null,
    ...entity,
  ]) as SavedDraftKey
}

/** For text that belongs to the person using this phone, not to one computer. */
export function deviceDraftKey(...entity: unknown[]) {
  return JSON.stringify(['device', ...entity]) as SavedDraftKey
}

export function useDetailDraft<A, Key extends string>(
  cache: DetailDrafts<A, Key>,
  key: Key,
  initial: () => NoInfer<A>,
) {
  const [state, setState] = useState(() => ({ key, value: cache.read(key) ?? initial() }))
  // A changed pairing or entity must never reuse another owner's draft.
  const value = state.key === key ? state.value : (cache.read(key) ?? initial())
  const current = useRef({ key, value })
  current.current = { key, value }
  if (state.key !== key) setState({ key, value })
  const initialize = useRef(initial)
  initialize.current = initial
  useEffect(() => {
    const refresh = () => {
      if (current.current.key !== key) return
      const value = cache.read(key) ?? initialize.current()
      current.current = { key, value }
      setState({ key, value })
    }
    const unsubscribe = cache.subscribe(key, refresh)
    // A delayed result can arrive between render and subscription.
    refresh()
    return unsubscribe
  }, [cache, key])
  const latest = () =>
    cache.read(key) ?? (current.current.key === key ? current.current.value : value)
  const show = (updated: A) => {
    if (current.current.key === key) {
      current.current = { key, value: updated }
      setState({ key, value: updated })
    }
  }
  const setField = <K extends keyof A>(field: K, next: A[K]) => {
    const previous = latest()
    // An effect that sets the value it already holds makes no edit. Saved text must still load.
    if (Object.is(previous[field], next)) return
    const updated = { ...previous, [field]: next }
    if (!cache.write(key, updated, [field])) {
      setState({ key, value: previous })
      Alert.alert('Draft limit reached', detailDraftPressureMessage)
      return
    }
    show(updated)
  }
  /** Fills an empty field (undefined or '') with an automatic default. It never replaces a value.
   * Use it in effects, not for user input: saved text that loads later replaces the default. */
  const initializeField = <K extends keyof A>(field: K, next: A[K]) => {
    const previous = latest()
    if (previous[field] !== undefined && previous[field] !== '') return
    if (Object.is(previous[field], next)) return
    const updated = { ...previous, [field]: next }
    cache.initialize(key, updated)
    show(updated)
  }
  const persistence: DraftPersistence | undefined = cache.storageStatus && {
    status: cache.storageStatus(key),
    retry: () => cache.retryStorage?.(),
  }
  /** Waits until the device holds the latest change to this draft, including a removal. */
  const settle = () => cache.settled?.(key) ?? Promise.resolve(undefined)
  return {
    draft: value,
    read: latest,
    setField,
    initializeField,
    clear: () => cache.remove(key),
    persistence,
    settle,
  }
}

function integrationScope(
  snapshot: RuntimeSnapshot | null,
  repositoryId: string | undefined,
  jiraSourceId: string | undefined,
) {
  const repository = snapshot?.workspace.repositories.find((item) => item.id === repositoryId)
  const source = snapshot?.workspace.jiraSources?.find((item) => item.id === jiraSourceId)
  return [
    repositoryId,
    repository?.path,
    repository?.forge,
    repository?.gitIdentity,
    jiraSourceId,
    jiraDestination(source),
  ]
}

/** Integration binding revisions keep drafts separate when an account/source is replaced. */
export function integrationDraftKey(
  connection: RuntimeConnection | null,
  snapshot: RuntimeSnapshot | null,
  repositoryId: string | undefined,
  jiraSourceId: string | undefined,
  ...entity: unknown[]
) {
  return detailDraftKey(
    connection,
    ...integrationScope(snapshot, repositoryId, jiraSourceId),
    ...entity,
  )
}

/** The saved form of `integrationDraftKey`, for editors that keep text after an app restart. */
export function computerIntegrationDraftKey(
  profile: Pick<RuntimeProfile, 'id' | 'connection'> | null,
  snapshot: RuntimeSnapshot | null,
  repositoryId: string | undefined,
  jiraSourceId: string | undefined,
  ...entity: unknown[]
) {
  return computerDraftKey(
    profile,
    ...integrationScope(snapshot, repositoryId, jiraSourceId),
    ...entity,
  )
}
