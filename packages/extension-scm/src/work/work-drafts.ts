import { useCallback, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react'

// Keep only the edited text. Verified source identity scopes persistent comments.
const drafts = new Map<string, { text: string }>()
const listeners = new Map<string, Set<() => void>>()
const notify = (id: string) => listeners.get(id)?.forEach((listener) => listener())
const commentStorageKey = (key: string) => `dovo.work.comment-draft.${key}`

function readComment(key: string): string | null | undefined {
  try {
    return globalThis.localStorage?.getItem(commentStorageKey(key))
  } catch {
    return undefined
  }
}

function writeComment(key: string, text?: string) {
  try {
    const storage = globalThis.localStorage
    if (!storage) return false
    if (text === undefined) storage.removeItem(commentStorageKey(key))
    else storage.setItem(commentStorageKey(key), text)
    return true
  } catch {
    return false
  }
}

export function clearWorkDraft(key: string, comment?: { submitted: string }) {
  if (comment && readComment(key) === comment.submitted) writeComment(key)
  for (const field of drafts.keys())
    if (field.startsWith(key + ':')) {
      drafts.delete(field)
      notify(field)
    }
  if (comment) notify(key + ':body')
}
export function useWorkDraftText(key: string, field: string, initial: string, persistent = false) {
  const id = key + ':' + field
  const subscribe = useCallback(
    (listener: () => void) => {
      const entry = listeners.get(id) ?? new Set<() => void>()
      entry.add(listener)
      listeners.set(id, entry)
      const storageChanged = (event: StorageEvent) => {
        if (event.key === commentStorageKey(key) || event.key === null) listener()
      }
      if (persistent) globalThis.addEventListener?.('storage', storageChanged)
      return () => {
        if (persistent) globalThis.removeEventListener?.('storage', storageChanged)
        entry.delete(listener)
        if (!entry.size) listeners.delete(id)
      }
    },
    [id, key, persistent],
  )
  const read = useCallback(
    () => drafts.get(id)?.text ?? (persistent ? readComment(key) : undefined) ?? initial,
    [id, initial, key, persistent],
  )
  const value = useSyncExternalStore(subscribe, read, read)
  const set = useCallback<Dispatch<SetStateAction<string>>>(
    (update) => {
      const before = read()
      const value = typeof update === 'function' ? update(before) : update
      drafts.delete(id)
      // Only unsaved changes need retention. Never evict user text to bound this cache.
      // Successful form submission clears its fields through clearWorkDraft.
      const saved = persistent && writeComment(key, value === initial ? undefined : value)
      // Keep a local override when the browser rejects a storage write.
      if (!saved && (value !== initial || persistent)) drafts.set(id, { text: value })
      notify(id)
    },
    [id, initial, key, persistent, read],
  )
  // Entry identity distinguishes a new edit with the same text after a delayed acknowledgement.
  const snapshot = useCallback(() => drafts.get(id), [id])
  return [value, set, snapshot] as const
}
