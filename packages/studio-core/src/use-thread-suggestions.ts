import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { AccountClient } from '@dovo/protocol'

type Inbox = Awaited<ReturnType<AccountClient['sharing']['suggestionInbox']>>
export function useThreadSuggestions(client: AccountClient, sourceId: string, active = true) {
  const revision = useSyncExternalStore(
    client.sharing.subscribe,
    client.sharing.snapshot,
    client.sharing.snapshot,
  )
  const scope = JSON.stringify([client.origin, client.sessionId(), sourceId])
  const current = useRef(scope)
  current.current = scope
  const [state, setState] = useState<{
    scope: string
    origin: string
    inbox: Inbox
    error: string
  }>({ scope: '', origin: '', inbox: null, error: '' })
  const [busy, setBusy] = useState<string | null>(null)
  const dismissing = useRef(false)
  useEffect(() => {
    if (!active || !client.snapshot().directory) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const refresh = async () => {
      try {
        const origin = await client.sharingService()
        const inbox = await client.sharing.suggestionInbox(origin, sourceId)
        if (!stopped) setState({ scope, origin, inbox, error: '' })
      } catch {
        // Background suggestions are optional; retain the last inbox and retry quietly.
      } finally {
        if (!stopped) timer = setTimeout(() => void refresh(), 30000)
      }
    }
    void refresh()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [client, sourceId, scope, active, revision])
  const shown = active && client.snapshot().directory && state.scope === scope ? state : null
  return {
    suggestions: shown?.inbox?.suggestions ?? [],
    error: shown?.error ?? '',
    busy,
    dismiss: async (id: string) => {
      if (!shown?.inbox || dismissing.current) return
      dismissing.current = true
      setBusy(id)
      try {
        await client.sharing.dismiss(shown.origin, shown.inbox.id, id)
        if (current.current === scope)
          setState((previous) =>
            previous.scope === scope && previous.inbox
              ? {
                  ...previous,
                  error: '',
                  inbox: {
                    ...previous.inbox,
                    suggestions: previous.inbox.suggestions.filter((item) => item.id !== id),
                  },
                }
              : previous,
          )
      } catch {
        if (current.current === scope)
          setState((previous) => ({
            ...previous,
            error: 'Could not dismiss this suggestion. Try again.',
          }))
      } finally {
        dismissing.current = false
        setBusy(null)
      }
    },
  }
}
