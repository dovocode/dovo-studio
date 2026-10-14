import { useEffect, useState } from 'react'
import {
  nativeThreadPageSchema,
  subagentMetadata,
  type NativeThreadPage,
  type Subagent,
} from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import {
  Button,
  HeaderContent,
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  Message,
  MessageContent,
  MessageResponse,
} from '@dovo/studio-ui'

export function NativeAgentThread({
  taskId,
  agent,
  onClose,
  parentTitle,
  projectName,
  windowRightEdge = true,
}: {
  taskId: string
  agent: Subagent
  onClose: () => void
  parentTitle?: string
  projectName?: string
  windowRightEdge?: boolean
}) {
  const { request, connected } = useWorkspace()
  const [page, setPage] = useState<NativeThreadPage>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [load, setLoad] = useState<{ before?: string; revision: number }>({ revision: 0 })
  useEffect(() => {
    let active = true
    if (!connected) {
      setBusy(false)
      return
    }
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
    <section
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col"
      data-native-thread-main
      aria-label="Native agent thread"
    >
      <HeaderContent>
        <header
          className="studio-task-thread-header"
          data-window-edge
          data-window-right-edge={windowRightEdge || undefined}
        >
          <Button variant="ghost" size="sm" onClick={onClose}>
            Back to agents
          </Button>
          <h1
            className="studio-titlebar-heading min-w-0 flex-1"
            title={`${parentTitle ?? projectName ?? 'Native thread'} / ${agent.name}`}
          >
            <span className="studio-titlebar-project">
              {projectName ?? parentTitle ?? 'Native thread'}
            </span>
            <span className="studio-titlebar-divider">/</span>
            <span className="studio-titlebar-task min-w-0">{agent.name}</span>
          </h1>
          <Button
            variant="ghost"
            size="sm"
            disabled={!connected || busy}
            onClick={() => setLoad(({ revision }) => ({ revision: revision + 1 }))}
          >
            Refresh thread
          </Button>
        </header>
      </HeaderContent>
      <Conversation className="min-h-0" aria-label="Native conversation">
        <ConversationContent className="mx-auto w-full max-w-[var(--chat-max)] gap-5 px-4 py-4 md:pl-16 md:pr-5">
          {!connected && (
            <p className="p-4 text-xs text-muted-foreground">
              Reconnect to load this native thread.
            </p>
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
          {page?.entries.map((entry) =>
            entry.role === 'tool' || entry.role === 'reasoning' ? (
              <details key={entry.id} className="min-w-0 text-xs text-muted-foreground">
                <summary className="cursor-pointer">
                  {entry.label || (entry.role === 'reasoning' ? 'Reasoning' : 'Tool')}
                </summary>
                <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">
                  {entry.text}
                </pre>
              </details>
            ) : (
              <Message key={entry.id} from={entry.role}>
                <MessageContent>
                  <MessageResponse>{entry.text}</MessageResponse>
                </MessageContent>
              </Message>
            ),
          )}
          {page && !page.entries.length && (
            <p className="text-xs text-muted-foreground">No conversation messages are available.</p>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      <footer className="border-t px-4 py-3 text-xs text-muted-foreground">
        {parentTitle && <span>{parentTitle} · </span>}
        {subagentMetadata(agent) || agent.provider} · {agent.status} · Read only
      </footer>
    </section>
  )
}
