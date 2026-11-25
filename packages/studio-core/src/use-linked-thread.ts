import { useEffect, useEffectEvent, useState } from 'react'
import { RuntimeRequestError, type LinkedThreadPage, type LinkedThreadRead } from '@dovo/protocol'

export function useLinkedThread(
  target: Omit<LinkedThreadRead, 'before'>,
  connected: boolean,
  read: (input: LinkedThreadRead) => Promise<LinkedThreadPage>,
) {
  const [page, setPage] = useState<LinkedThreadPage>()
  const [query, setQuery] = useState<{ before?: string }>({})
  const [busy, setBusy] = useState(connected)
  const [error, setError] = useState('')
  const load = useEffectEvent(async (before: string | undefined, active: () => boolean) => {
    try {
      const latest = await read(before ? { ...target, before } : target)
      if (!active()) return
      if (before && page) {
        if (latest.history.historyRevision !== page.history.historyRevision) {
          setError('The linked history changed. Refresh to read its latest messages.')
          return
        }
        const existing = new Set(page.history.messages.map((message) => message.id))
        latest.history.messages = [
          ...latest.history.messages.filter((message) => !existing.has(message.id)),
          ...page.history.messages,
        ]
      }
      setPage(latest)
    } catch (cause) {
      if (active()) {
        if (cause instanceof RuntimeRequestError && (cause.status === 401 || cause.status === 403))
          setPage(undefined)
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      if (active()) setBusy(false)
    }
  })
  useEffect(() => {
    if (!connected) return
    let current = true
    setBusy(true)
    setError('')
    void load(query.before, () => current)
    return () => {
      current = false
    }
  }, [connected, query])
  return {
    page,
    busy: connected && busy,
    error,
    refresh: () => setQuery({}),
    older: () => setQuery({ before: page?.history.before }),
  }
}
