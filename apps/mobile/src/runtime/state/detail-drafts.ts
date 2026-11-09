import { useRef, useState } from 'react'
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
  return {
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
      return true
    },
    remove(key: string) {
      entries.delete(key)
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
  const current = useRef(value)
  current.current = value
  if (state.key !== key) setState({ key, value })
  const setField = <K extends keyof A>(field: K, next: A[K]) => {
    const previous = current.current
    const updated = { ...previous, [field]: next }
    if (!cache.write(key, updated)) {
      setState({ key, value: previous })
      Alert.alert('Draft limit reached', detailDraftPressureMessage)
      return
    }
    current.current = updated
    setState({ key, value: updated })
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
