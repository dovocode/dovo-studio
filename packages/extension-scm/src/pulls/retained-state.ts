import { useApplicationState } from '@dovo/studio-core/state'
import { useWorkspace } from '@dovo/studio-core'
import { useCallback, type Dispatch, type SetStateAction } from 'react'

/** Small navigation fields and drafts only; never retain mounted views or request closures. */
export function createPullStateCache<T>(limit: number) {
  const entries = new Map<string, T>()
  return {
    read(key: string) {
      const value = entries.get(key)
      if (value !== undefined) {
        entries.delete(key)
        entries.set(key, value)
      }
      return value
    },
    write(key: string, value: T) {
      entries.delete(key)
      entries.set(key, value)
      while (entries.size > limit) {
        const oldest = entries.keys().next().value
        if (oldest === undefined) break
        entries.delete(oldest)
      }
    },
  }
}

export function useRetainedPullState<T>(
  cache: ReturnType<typeof createPullStateCache<T>>,
  key: string,
  initial: T,
): readonly [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useApplicationState(() => ({
    key,
    value: cache.read(key) ?? initial,
  }))
  const value = state.key === key ? state.value : (cache.read(key) ?? initial)
  const set = useCallback<Dispatch<SetStateAction<T>>>(
    (update) => {
      setState((current) => {
        const previous = current.key === key ? current.value : (cache.read(key) ?? initial)
        const next = typeof update === 'function' ? (update as (value: T) => T)(previous) : update
        cache.write(key, next)
        return { key, value: next }
      })
    },
    [cache, key, initial, setState],
  )
  return [value, set]
}

/** The scoped owner and account binding are part of every PR draft's identity. */
export function usePullStateKey(
  repositoryId: string,
  number: number,
  account?: string,
  url?: string,
) {
  const { activeRuntimeId, connection, workspace } = useWorkspace()
  const repository = workspace.repositories.find((repo) => repo.id === repositoryId)
  return JSON.stringify([
    activeRuntimeId,
    connection?.address,
    repositoryId,
    repository?.path,
    repository?.forge,
    account,
    url,
    number,
  ])
}
