import { decode, pullChangedFileSchema, pullCommentSubmissionSchema } from '@dovo/protocol'
import { Schema } from 'effect'
import { useEffect, useSyncExternalStore } from 'react'

const selectionSchema = Schema.Struct({
  file: pullChangedFileSchema,
  start: Schema.Int.check(Schema.isGreaterThan(0)),
  end: Schema.Int.check(Schema.isGreaterThan(0)),
  side: Schema.Literals(['additions', 'deletions']),
  headSha: Schema.String,
  baseSha: Schema.String,
  expectedDestination: Schema.optional(Schema.String),
})
const draftSchema = Schema.Struct({
  selection: Schema.NullOr(selectionSchema),
  destination: Schema.Literals(['github', 'agent']),
  body: Schema.String,
  suggesting: Schema.Boolean,
  replacement: Schema.String,
  submissionId: Schema.optional(pullCommentSubmissionSchema.fields.submissionId),
})
export type PullLineSelection = typeof selectionSchema.Type
export type PullLineDraft = typeof draftSchema.Type
export const emptyPullLineDraft: PullLineDraft = {
  selection: null,
  destination: 'agent',
  body: '',
  suggesting: false,
  replacement: '',
}

const draftsSchema = Schema.Array(Schema.Tuple([Schema.String, draftSchema]))
const empty = { drafts: new Map<string, PullLineDraft>(), error: '' }
const stores = new Map<string, ReturnType<typeof createStore>>()
const hasDraft = (draft: PullLineDraft) => !!(draft.body || draft.suggesting || draft.submissionId)
const forStorage = (draft: PullLineDraft) => {
  const selection = draft.selection
  if (!selection?.file.patch || selection.file.patch.length <= 64_000) return draft
  return { ...draft, selection: { ...selection, file: { ...selection.file, patch: undefined } } }
}

function createStore(storageKey: string | undefined) {
  const listeners = new Set<() => void>()
  let state: { drafts: ReadonlyMap<string, PullLineDraft>; error: string } = empty
  const emit = () => listeners.forEach((listener) => listener())
  const fromStorage = () => {
    const raw = storageKey && localStorage.getItem(storageKey)
    return new Map(raw ? decode(draftsSchema, JSON.parse(raw)) : [])
  }
  const load = () => {
    if (!storageKey) return
    try {
      state = { drafts: fromStorage(), error: '' }
    } catch {
      state = { ...state, error: 'Saved line comments could not be read.' }
    }
    emit()
  }
  if (typeof window !== 'undefined') load()
  return {
    load,
    canRemove: () => !listeners.size && !state.error && (storageKey || !state.drafts.size),
    subscribe(this: void, listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    read: () => state,
    update(
      this: void,
      path: string,
      edit: (draft: PullLineDraft) => PullLineDraft,
      required = false,
    ) {
      const before = state.drafts.get(path) ?? emptyPullLineDraft
      const draft = edit(before)
      if (draft === before) return
      const next = new Map(state.drafts)
      if (draft.selection || hasDraft(draft)) next.set(path, draft)
      else next.delete(path)
      let error = ''
      try {
        if (storageKey) {
          const saved = fromStorage()
          const receipt = saved.get(path)?.submissionId
          if (receipt && receipt !== before.submissionId)
            throw new Error('This draft has a posting record from another window.')
          if (hasDraft(draft)) saved.set(path, forStorage(draft))
          else saved.delete(path)
          if (saved.size) localStorage.setItem(storageKey, JSON.stringify([...saved]))
          else localStorage.removeItem(storageKey)
        } else if (required) throw new Error('Missing draft storage scope')
      } catch {
        error = 'Line comments could not be saved on this device.'
        if (required) {
          state = { ...state, error }
          emit()
          throw new Error('Save the comment’s posting record before trying to post again.')
        }
      }
      state = { drafts: next, error }
      emit()
    },
  }
}

export function usePullLineDrafts(prKey: string, credentialScope: string | undefined) {
  const key = JSON.stringify([credentialScope, prKey])
  const storageKey = credentialScope ? `dovo.pull-line-drafts.v1.${key}` : undefined
  let store = stores.get(key)
  if (!store) {
    if (stores.size >= 30) {
      for (const [oldKey, oldStore] of stores) {
        if (oldStore.canRemove()) stores.delete(oldKey)
        if (stores.size < 30) break
      }
    }
    store = createStore(storageKey)
    stores.set(key, store)
  }
  const current = store
  const state = useSyncExternalStore(current.subscribe, current.read, () => empty)
  useEffect(() => {
    if (!storageKey) return
    const changed = (event: StorageEvent) => {
      if (event.key === storageKey && !current.read().error) current.load()
    }
    window.addEventListener('storage', changed)
    return () => window.removeEventListener('storage', changed)
  }, [current, storageKey])
  return { ...state, update: current.update }
}
