import { useCallback, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react'

// Retain text, never server data or request closures. Credentials and remote binding are part of the key.
const drafts = new Map<string, { text: string }>()
const listeners = new Map<string, Set<() => void>>()
const notify = (id: string) => listeners.get(id)?.forEach((listener) => listener())
export function clearWorkDraft(key: string) {
  for (const field of drafts.keys())
    if (field.startsWith(key + ':')) {
      drafts.delete(field)
      notify(field)
    }
}
export function useWorkDraftText(key: string, field: string, initial: string) {
  const id = key + ':' + field
  const subscribe = useCallback(
    (listener: () => void) => {
      const entry = listeners.get(id) ?? new Set<() => void>()
      entry.add(listener)
      listeners.set(id, entry)
      return () => {
        entry.delete(listener)
        if (!entry.size) listeners.delete(id)
      }
    },
    [id],
  )
  const read = useCallback(() => drafts.get(id)?.text ?? initial, [id, initial])
  const value = useSyncExternalStore(subscribe, read, read)
  const set = useCallback<Dispatch<SetStateAction<string>>>(
    (update) => {
      const before = drafts.get(id)?.text ?? initial
      const value = typeof update === 'function' ? update(before) : update
      drafts.delete(id)
      // Only unsaved changes need retention. Never evict user text to bound this cache.
      // Successful form submission clears its fields through clearWorkDraft.
      if (value !== initial) drafts.set(id, { text: value })
      notify(id)
    },
    [id, initial],
  )
  // Entry identity lets delayed acknowledgements distinguish a new edit with the same text.
  const snapshot = useCallback(() => drafts.get(id), [id])
  return [value, set, snapshot] as const
}
