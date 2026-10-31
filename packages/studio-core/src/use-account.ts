import { useEffect, useMemo, useSyncExternalStore } from 'react'
import {
  AccountClient,
  normalizeServiceUrls,
  type AccountStorage,
  type ServiceUrls,
} from '@dovo/protocol'
const clients = new WeakMap<AccountStorage, Map<string, { client: AccountClient; users: number }>>()
export function useAccount(
  storage: AccountStorage,
  open: (url: string) => Promise<unknown>,
  services?: Partial<ServiceUrls> & { ready?: boolean },
) {
  const { connectOrigin, artifactsOrigin } = normalizeServiceUrls({
    connectOrigin: services?.connectOrigin ?? '',
    artifactsOrigin: services?.artifactsOrigin ?? '',
  })
  const entry = useMemo(() => {
    let entries = clients.get(storage)
    if (!entries) {
      entries = new Map()
      clients.set(storage, entries)
    }
    const key = JSON.stringify([connectOrigin, artifactsOrigin])
    let entry = entries.get(key)
    if (!entry) {
      entry = { client: new AccountClient(storage, open, connectOrigin, artifactsOrigin), users: 0 }
      entries.set(key, entry)
    }
    return entry
  }, [storage, open, connectOrigin, artifactsOrigin])
  const client = entry.client
  const state = useSyncExternalStore(client.subscribe, client.snapshot, client.snapshot)
  const session = client.sessionId()
  useEffect(() => {
    if (services?.ready === false || !state.loaded || !state.directory || state.deletionPending)
      return
    const active = () => document.visibilityState === 'visible'
    const stop = client.sharing.startSync(active)
    const foreground = () => client.sharing.refreshSync()
    document.addEventListener('visibilitychange', foreground)
    return () => {
      document.removeEventListener('visibilitychange', foreground)
      stop()
    }
  }, [
    client,
    session,
    state.loaded,
    state.directory?.user.id,
    state.deletionPending,
    services?.ready,
  ])
  useEffect(() => {
    if (services?.ready === false) return
    entry.users++
    if (entry.users === 1) void client.load()
    return () => {
      if (--entry.users === 0) client.cancel()
    }
  }, [client, entry, services?.ready])
  useEffect(() => {
    if (services?.ready !== false && state.loaded && state.directory)
      void client.refreshPublications()
  }, [client, state.loaded, state.directory?.user.id, session, services?.ready])
  return { client, ...state }
}
