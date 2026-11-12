import { useApplicationState } from '@dovo/studio-core/state'
import { useCallback, type Dispatch, type SetStateAction } from 'react'

// Retain text, never server data or request closures. Credentials and remote binding are part of the key.
const drafts = new Map<string, string>()
export function clearWorkDraft(key: string) {
  for (const field of drafts.keys()) if (field.startsWith(key + ':')) drafts.delete(field)
}
export function useWorkDraftText(key: string, field: string, initial: string) {
  const id = key + ':' + field
  const [state, setState] = useApplicationState(() => ({ id, value: drafts.get(id) ?? initial }))
  const value = state.id === id ? state.value : (drafts.get(id) ?? initial)
  const set = useCallback<Dispatch<SetStateAction<string>>>(
    (update) => {
      setState((state) => {
        const before = state.id === id ? state.value : (drafts.get(id) ?? initial)
        const value = typeof update === 'function' ? update(before) : update
        drafts.delete(id)
        // Only unsaved changes need retention. Never evict user text to bound this cache.
        // Successful form submission clears its fields through clearWorkDraft.
        if (value !== initial) drafts.set(id, value)
        return { id, value }
      })
    },
    [id, initial, setState],
  )
  return [value, set] as const
}
