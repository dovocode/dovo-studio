import { useCallback, useEffect, useSyncExternalStore } from 'react'
import {
  browserProfilesResultSchema,
  type BrowserProfile,
  type RuntimeProfile,
  resolveRuntimeTarget,
} from '@dovo/protocol'
import { useWorkspace } from './workspace/context'
type State = {
  profiles?: BrowserProfile[]
  error: string
  loading: boolean
  applyError?: string
  applying?: boolean
}
type Catalog = { state: State; pending?: Promise<void>; listeners: Set<() => void> }
const catalogs = new Map<string, Catalog>()
function catalog(scope: string) {
  let entry = catalogs.get(scope)
  if (!entry) {
    entry = { state: { error: '', loading: false }, listeners: new Set() }
    catalogs.set(scope, entry)
  }
  return entry
}
function publish(entry: Catalog, state: State) {
  entry.state = state
  for (const listener of entry.listeners) listener()
}
/** Profile names sync between settings and open tabs; website data stays on the runtime. */
export function useRemoteBrowserProfiles(profile?: RuntimeProfile, active = true) {
  const { connection, request, readRuntime, connected, runtimes } = useWorkspace()
  const owner = profile?.connection ?? connection
  const scope = owner ? JSON.stringify([owner.address, owner.token, owner.runtimeId]) : ''
  const available = profile
    ? runtimes.some(
        (runtime) => resolveRuntimeTarget([runtime.profile], profile) && runtime.connected,
      )
    : connected
  const enabled = active && available
  const entry = catalog(scope)
  const subscribe = useCallback(
    (listener: () => void) => {
      entry.listeners.add(listener)
      return () => {
        entry.listeners.delete(listener)
      }
    },
    [entry],
  )
  const getSnapshot = useCallback(() => entry.state, [entry])
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const call = useCallback(
    (path: string, input: unknown) =>
      profile
        ? readRuntime(profile, path, input, browserProfilesResultSchema)
        : request(path, input, browserProfilesResultSchema),
    [profile, readRuntime, request],
  )
  const refresh = useCallback(async () => {
    if (!scope || !enabled) return
    if (entry.pending) {
      // A save publishes its result. Do not launch an overlapping read or propagate a
      // form-owned save error into the effect that requests a refresh.
      await entry.pending.catch(() => undefined)
      return
    }
    publish(entry, { ...entry.state, loading: !entry.state.profiles, error: '' })
    const pending = call('/api/previews/browser/profiles/read', {})
      .then(
        ({ profiles, applyError }) =>
          publish(entry, { profiles, applyError, error: '', loading: false }),
        (error: unknown) =>
          publish(entry, {
            ...entry.state,
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          }),
      )
      .finally(() => {
        if (entry.pending === pending) entry.pending = undefined
      })
    entry.pending = pending
    return pending
  }, [entry, scope, enabled, call])
  useEffect(() => {
    void refresh()
  }, [refresh])
  const save = useCallback(
    async (profiles: BrowserProfile[]) => {
      const expected = state.profiles
      if (!enabled || !expected)
        throw new Error('Connect this computer and load its profiles first.')
      const pending = (entry.pending ?? Promise.resolve())
        .catch(() => undefined)
        .then(async () => {
          if (JSON.stringify(entry.state.profiles) !== JSON.stringify(expected))
            throw new Error('Browser profiles changed. Review the profiles and save again.')
          const result = await call('/api/previews/browser/profiles/save', { profiles, expected })
          publish(entry, { ...result, error: '', loading: false })
        })
        .finally(() => {
          if (entry.pending === pending) entry.pending = undefined
        })
      entry.pending = pending
      await pending
    },
    [entry, call, enabled, state.profiles],
  )
  const retryApply = useCallback(async () => {
    if (!enabled) return
    const pending = (entry.pending ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        publish(entry, { ...entry.state, applying: true, error: '' })
        try {
          const result = await call('/api/previews/browser/profiles/apply', {})
          publish(entry, { ...result, error: '', loading: false, applying: false })
        } catch (cause) {
          publish(entry, {
            ...entry.state,
            applying: false,
            error: cause instanceof Error ? cause.message : String(cause),
          })
        }
      })
      .finally(() => {
        if (entry.pending === pending) entry.pending = undefined
      })
    entry.pending = pending
    await pending
  }, [entry, call, enabled])
  return { ...state, refresh, save, retryApply, connected: enabled }
}
