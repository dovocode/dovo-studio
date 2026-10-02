import { useCallback, useEffect, useSyncExternalStore } from 'react'
import {
  browserProfilesResultSchema,
  type BrowserProfile,
  type RuntimeProfile,
} from '@dovo/protocol'
import { useWorkspace } from './workspace/context'
type State = { profiles?: BrowserProfile[]; error: string; loading: boolean }
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
  const scope = profile?.connection.address ?? connection?.address ?? ''
  const available = profile
    ? runtimes.some((runtime) => runtime.profile.id === profile.id && runtime.connected)
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
    if (entry.pending) return entry.pending
    publish(entry, { ...entry.state, loading: !entry.state.profiles, error: '' })
    const pending = call('/api/previews/browser/profiles/read', {})
      .then(
        ({ profiles }) => publish(entry, { profiles, error: '', loading: false }),
        (error: unknown) =>
          publish(entry, {
            ...entry.state,
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          }),
      )
      .finally(() => {
        entry.pending = undefined
      })
    entry.pending = pending
    return pending
  }, [entry, scope, enabled, call])
  useEffect(() => {
    void refresh()
  }, [refresh])
  const save = useCallback(
    async (profiles: BrowserProfile[]) => {
      await entry.pending
      const result = await call('/api/previews/browser/profiles/save', { profiles })
      publish(entry, { profiles: result.profiles, error: '', loading: false })
    },
    [entry, call],
  )
  return { ...state, refresh, save, connected: enabled }
}
