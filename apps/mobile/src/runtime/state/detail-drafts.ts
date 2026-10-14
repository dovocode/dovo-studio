import { useRef, useState } from 'react'
import { clientScopeKey } from '@dovo/client-runtime'
import type { RuntimeConnection, RuntimeSnapshot } from '@dovo/protocol'

/** Small field snapshots only; never retain detail views or network results. */
export function createDetailDrafts<A>(limit = 40) {
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
      entries.delete(key)
      entries.set(key, value)
      while (entries.size > limit) {
        const oldest = entries.keys().next().value
        if (oldest === undefined) break
        entries.delete(oldest)
      }
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
    current.current = updated
    cache.write(key, updated)
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
    source,
    ...entity,
  )
}
