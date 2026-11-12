import { useEffect, useRef, useState } from 'react'
import { Alert } from 'react-native'
import { jiraDestination } from '../../scm/source-key'
import { clientScopeKey } from '@dovo/client-runtime'
import type { RuntimeConnection, RuntimeSnapshot } from '@dovo/protocol'

export const detailDraftPressureMessage =
  'Your existing drafts are kept. Save or discard an existing draft of this type before editing another item.'

/** Bounded field snapshots. Only explicitly clean entries may be evicted. */
export function createDetailDrafts<A>({
  limit = 40,
  isClean = () => false,
}: {
  limit?: number
  isClean?: (value: A) => boolean
} = {}) {
  const entries = new Map<string, A>()
  const listeners = new Map<string, Set<() => void>>()
  const notify = (key: string) => listeners.get(key)?.forEach((listener) => listener())
  return {
    subscribe(key: string, listener: () => void) {
      const entry = listeners.get(key) ?? new Set<() => void>()
      entry.add(listener)
      listeners.set(key, entry)
      return () => {
        entry.delete(listener)
        if (!entry.size) listeners.delete(key)
      }
    },
    read(key: string) {
      const value = entries.get(key)
      if (value !== undefined) {
        entries.delete(key)
        entries.set(key, value)
      }
      return value
    },
    write(key: string, value: A) {
      if (!entries.has(key) && entries.size >= limit) {
        const clean = [...entries].find(([, entry]) => isClean(entry))
        if (clean) entries.delete(clean[0])
        // An empty new editor does not need to displace retained user text.
        else return isClean(value)
      }
      entries.delete(key)
      entries.set(key, value)
      notify(key)
      return true
    },
    remove(key: string) {
      entries.delete(key)
      notify(key)
    },
  }
}

export function detailDraftKey(connection: RuntimeConnection | null, ...entity: unknown[]) {
  return JSON.stringify([clientScopeKey(connection), ...entity])
}

export function useDetailDraft<A>(
  cache: ReturnType<typeof createDetailDrafts<A>>,
  key: string,
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
  const setField = <K extends keyof A>(field: K, next: A[K]) => {
    const previous =
      cache.read(key) ?? (current.current.key === key ? current.current.value : value)
    const updated = { ...previous, [field]: next }
    if (!cache.write(key, updated)) {
      setState({ key, value: previous })
      Alert.alert('Draft limit reached', detailDraftPressureMessage)
      return
    }
    if (current.current.key === key) {
      current.current = { key, value: updated }
      setState({ key, value: updated })
    }
  }
  return { draft: value, setField, clear: () => cache.remove(key) }
}

/** Integration binding revisions keep drafts separate when an account/source is replaced. */
export function integrationDraftKey(
  connection: RuntimeConnection | null,
  snapshot: RuntimeSnapshot | null,
  repositoryId: string | undefined,
  jiraSourceId: string | undefined,
  ...entity: unknown[]
) {
  const repository = snapshot?.workspace.repositories.find((item) => item.id === repositoryId)
  const source = snapshot?.workspace.jiraSources?.find((item) => item.id === jiraSourceId)
  return detailDraftKey(
    connection,
    repositoryId,
    repository?.path,
    repository?.forge,
    repository?.gitIdentity,
    jiraSourceId,
    jiraDestination(source),
    ...entity,
  )
}
