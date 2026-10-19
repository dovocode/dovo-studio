import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { AccountClient, type AccountStorage } from '@dovo/protocol'
export function useAccount(storage: AccountStorage, open: (url: string) => Promise<unknown>) {
  const client = useMemo(() => new AccountClient(storage, open), [storage, open])
  const state = useSyncExternalStore(client.subscribe, client.snapshot, client.snapshot)
  useEffect(() => {
    void client.load()
    return () => client.cancel()
  }, [client])
  return { client, ...state }
}
