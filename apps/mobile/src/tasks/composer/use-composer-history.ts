import { useCallback, useEffect, useRef, useState } from 'react'

type Entry = { role: string; text: string }
type Page = { messages: readonly Entry[]; before?: string; historyRevision?: number }
type Session = {
  scope: string
  revision: string | number
  entries: string[]
  index: number
  before?: string
  historyRevision?: number
}

/** Browsing is a preview: the saved draft changes only when the user edits or sends it. */
export function useComposerHistory({
  scope,
  text,
  revision,
  messages,
  enabled,
  loadHistory,
}: {
  scope: string
  text: string
  revision: string | number
  messages: readonly Entry[]
  enabled: boolean
  loadHistory?: (signal: AbortSignal, before?: string) => Promise<Page>
}) {
  const [session, setSession] = useState<Session | null>(null)
  const pending = useRef<AbortController | null>(null)
  const latest = useRef({ scope, revision, enabled })
  latest.current = { scope, revision, enabled }
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const cancelLoad = useCallback(() => {
    pending.current?.abort()
    pending.current = null
    setLoading(false)
    setError('')
  }, [])
  const cancel = useCallback(() => {
    cancelLoad()
    setSession(null)
  }, [cancelLoad])
  useEffect(() => {
    cancel()
    return () => {
      pending.current?.abort()
      pending.current = null
    }
  }, [scope, revision, enabled, cancel])
  const current =
    enabled && session?.scope === scope && session.revision === revision ? session : null
  useEffect(() => {
    if (session && !current) setSession(null)
  }, [session, current])
  const available =
    enabled &&
    (!!loadHistory || messages.some((message) => message.role === 'user' && message.text.trim()))
  const read = (previous?: Session) => {
    if (pending.current) return
    const show = (page: Page) => {
      if (previous && (page.historyRevision ?? 0) !== (previous.historyRevision ?? 0))
        throw new Error('Conversation changed. Cancel history and try again.')
      if (previous?.before && page.before === previous.before)
        throw new Error('Could not load older messages. Try again.')
      const entries = page.messages
        .filter((message) => message.role === 'user' && message.text.trim())
        .slice(-50)
        .map((message) => message.text)
        .reverse()
      if (previous)
        setSession({
          ...previous,
          entries: [...previous.entries, ...entries],
          before: page.before,
          index: entries.length ? previous.index + 1 : previous.index,
        })
      else if (entries.length)
        setSession({
          scope,
          revision,
          entries,
          index: 0,
          before: page.before,
          historyRevision: page.historyRevision,
        })
    }
    if (!loadHistory) {
      show({ messages })
      return
    }
    const operation = new AbortController()
    pending.current = operation
    setLoading(true)
    setError('')
    const valid = () =>
      !operation.signal.aborted &&
      latest.current.scope === scope &&
      latest.current.revision === revision &&
      latest.current.enabled
    void loadHistory(operation.signal, previous?.before)
      .then((page) => {
        if (valid()) show(page)
      })
      .catch((error) => {
        if (valid()) setError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (pending.current === operation) {
          pending.current = null
          setLoading(false)
        }
      })
  }
  return {
    active: !!current,
    loading,
    error,
    available,
    text: current && current.index >= 0 ? current.entries[current.index] : text,
    index: current?.index,
    count: current?.entries.length ?? 0,
    begin: () => {
      if (available && !current) read()
    },
    cancel,
    cancelLoad,
    older: () => {
      if (current && !pending.current) {
        if (current.index === current.entries.length - 1 && current.before) {
          read(current)
          return
        }
        setSession({ ...current, index: Math.min(current.index + 1, current.entries.length - 1) })
      }
    },
    newer: () => {
      cancelLoad()
      if (current) setSession({ ...current, index: Math.max(-1, current.index - 1) })
    },
  }
}
