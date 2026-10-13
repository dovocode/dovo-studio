import { useEffect, useState } from 'react'
import {
  nativeThreadPageSchema,
  subagentMetadata,
  type NativeThreadPage,
  type Subagent,
} from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import { Button, MessageResponse } from '@dovo/studio-ui'

export function NativeAgentThread({
  taskId,
  agent,
  onClose,
}: {
  taskId: string
  agent: Subagent
  onClose: () => void
}) {
  const { request, connected } = useWorkspace()
  const [page, setPage] = useState<NativeThreadPage>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [load, setLoad] = useState<{ before?: string; revision: number }>({ revision: 0 })
  useEffect(() => {
    let active = true
    if (!connected) return
    setBusy(true)
    setError('')
    void request(
      '/api/tasks/native-thread',
      {
        taskId,
        id: agent.id,
        provider: agent.provider,
        sessionId: agent.sessionId,
        before: load.before,
      },
      nativeThreadPageSchema,
    ).then(
      (next) => {
        if (!active) return
        setPage((previous) => {
          if (!load.before || !previous) return next
          const ids = new Set(next.entries.map((entry) => entry.id))
          return {
            ...next,
            entries: [...next.entries, ...previous.entries.filter((entry) => !ids.has(entry.id))],
          }
        })
        setBusy(false)
      },
      (error: unknown) => {
        if (!active) return
        setError(error instanceof Error ? error.message : String(error))
        setBusy(false)
      },
    )
    return () => {
      active = false
    }
  }, [request, connected, taskId, agent.id, agent.provider, agent.sessionId, load])
  return (
    <section className="flex min-h-full flex-col" aria-label="Native agent thread">
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b bg-background p-4">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Back to agents
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-medium">{agent.name}</h2>
          <p className="text-xs text-muted-foreground">
            {subagentMetadata(agent) || agent.provider} · {agent.status} · Read only
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={!connected || busy}
          onClick={() => setLoad(({ revision }) => ({ revision: revision + 1 }))}
        >
          Refresh thread
        </Button>
      </header>
      {!connected && (
        <p className="p-4 text-xs text-muted-foreground">Reconnect to load this native thread.</p>
      )}
      {error && (
        <p role="alert" className="p-4 text-xs text-destructive">
          {error}
        </p>
      )}
      {page?.notice && <p className="p-4 text-xs text-muted-foreground">{page.notice}</p>}
      {page?.before && (
        <Button
          className="m-4"
          variant="outline"
          size="sm"
          disabled={!connected || busy}
          onClick={() =>
            setLoad(({ revision }) => ({ before: page.before, revision: revision + 1 }))
          }
        >
          Load older messages
        </Button>
      )}
      {busy && (
        <p role="status" className="px-4 py-2 text-xs text-muted-foreground">
          Loading thread…
        </p>
      )}
      <div className="space-y-4 p-4">
        {page?.entries.map((entry) => (
          <article key={entry.id} className="min-w-0 rounded-lg border p-3">
            <p className="mb-2 text-[0.625rem] font-medium uppercase tracking-wide text-muted-foreground">
              {entry.label ||
                (entry.role === 'user'
                  ? 'Prompt'
                  : entry.role === 'assistant'
                    ? 'Assistant'
                    : entry.role === 'reasoning'
                      ? 'Reasoning'
                      : 'Tool')}
            </p>
            {entry.role === 'assistant' ? (
              <MessageResponse>{entry.text}</MessageResponse>
            ) : (
              <p className="whitespace-pre-wrap break-words text-xs">{entry.text}</p>
            )}
          </article>
        ))}
        {page && !page.entries.length && (
          <p className="text-xs text-muted-foreground">No conversation messages are available.</p>
        )}
      </div>
    </section>
  )
}
