import { useCallback, useEffect, useState } from 'react'

type Entry = { role: string; text: string }
type Session = {
  scope: string
  revision: string | number
  entries: string[]
  index: number
}

/** Browsing is a preview: the saved draft changes only when the user edits or sends it. */
export function useComposerHistory({
  scope,
  text,
  revision,
  messages,
  enabled,
}: {
  scope: string
  text: string
  revision: string | number
  messages: readonly Entry[]
  enabled: boolean
}) {
  const [session, setSession] = useState<Session | null>(null)
  const cancel = useCallback(() => setSession(null), [])
  const current =
    enabled && session?.scope === scope && session.revision === revision ? session : null
  useEffect(() => {
    if (session && !current) setSession(null)
  }, [session, current])
  const available =
    enabled && messages.some((message) => message.role === 'user' && message.text.trim())
  const begin = () => {
    if (!available || current) return
    // Snapshot the order so live replies and background history loading cannot move the selection.
    const entries = messages
      .filter((message) => message.role === 'user' && message.text.trim())
      .map((message) => message.text)
      .reverse()
    setSession({ scope, revision, entries, index: 0 })
  }
  return {
    active: !!current,
    available,
    text: current && current.index >= 0 ? current.entries[current.index] : text,
    index: current?.index,
    count: current?.entries.length ?? 0,
    begin,
    cancel,
    older: () => {
      if (current)
        setSession({ ...current, index: Math.min(current.index + 1, current.entries.length - 1) })
    },
    newer: () => {
      if (current) setSession({ ...current, index: Math.max(-1, current.index - 1) })
    },
  }
}
