import { useEffect, useState, useSyncExternalStore } from 'react'
import type { AccountClient } from '@dovo/protocol'

export function useEncryptedPublication(client: AccountClient, sourceId: string, enabled: boolean) {
  const revision = useSyncExternalStore(
    client.sharing.subscribe,
    client.sharing.snapshot,
    client.sharing.snapshot,
  )
  const [state, setState] = useState<{ scope: string; shared: boolean; error: string }>({
    scope: '',
    shared: false,
    error: '',
  })
  const scope = JSON.stringify([client.sessionId(), sourceId])
  useEffect(() => {
    let stopped = false
    if (!enabled) return
    void (async () => {
      try {
        const key = await client.sharing.recoveryKey()
        if (!key) {
          if (!stopped) setState({ scope, shared: false, error: '' })
          return
        }
        const origin = await client.sharingService(),
          records = await client.sharing.list(origin)
        if (!stopped)
          setState({
            scope,
            shared: records.some(
              (record) => record.source === client.sharing.source('artifact', sourceId, key),
            ),
            error: '',
          })
      } catch {
        if (!stopped)
          setState({ scope, shared: false, error: 'Could not check encrypted sharing status' })
      }
    })()
    return () => {
      stopped = true
    }
  }, [client, scope, sourceId, enabled, revision])
  return state.scope === scope ? state : { shared: false, error: '' }
}
