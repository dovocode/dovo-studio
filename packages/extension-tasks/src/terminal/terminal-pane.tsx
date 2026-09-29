import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect, useRef } from 'react'
import { ChevronDown, Plus, Trash2 } from 'lucide-react'
import { canChangeTaskCheckout, responses, useWorkspace } from '@dovo/studio-core'
import { Button, IconButton, cn } from '@dovo/studio-ui'
import { TerminalSession } from './terminal-session'
export function TerminalPane({
  taskId,
  onClose,
  focusId = '',
  visible = true,
}: {
  taskId: string
  onClose: () => void
  /** Select this session, for example after a chat command ran in it. */
  focusId?: string
  visible?: boolean
}) {
  const { snapshot, workspace, connected, request } = useWorkspace(),
    [selected, setSelected] = useApplicationState(focusId),
    [error, setError] = useApplicationState(''),
    [busy, setBusy] = useApplicationState(false)
  const pending = useRef(false)
  const autoTried = useRef(false)
  useEffect(() => {
    if (focusId) setSelected(focusId)
  }, [focusId])
  const sessions = snapshot?.terminals.filter((session) => session.taskId === taskId) ?? [],
    active = sessions.find((session) => session.id === selected) ?? sessions[0]
  const task = workspace.tasks.find((item) => item.id === taskId)
  const shellReady =
    !!task &&
    (task.execution !== 'worktree' || !!task.existingWorktreePath || !canChangeTaskCheckout(task))
  const act = (operation: () => Promise<unknown>) => {
    if (!connected || !shellReady || pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    void operation()
      .catch((error) => setError(String(error)))
      .finally(() => {
        pending.current = false
        setBusy(false)
      })
  }
  const create = () =>
    act(() =>
      request(
        '/api/terminals',
        {
          taskId,
        },
        responses.terminal,
      ).then((session) => setSelected(session.id)),
    )
  useEffect(() => {
    if (!visible) {
      autoTried.current = false
      return
    }
    if (autoTried.current || !connected || !shellReady || !!focusId) return
    autoTried.current = true
    act(() =>
      request('/api/terminals/ensure', { taskId }, responses.terminal).then((session) =>
        setSelected(session.id),
      ),
    )
  }, [connected, shellReady, taskId, sessions, focusId, visible])
  return (
    <section className="flex h-full min-h-0 flex-col bg-[#0d0e10]" aria-label="Terminal">
      <header className="flex h-8 shrink-0 items-center gap-1 overflow-x-auto border-b px-2">
        {sessions.map((session) => (
          <Button
            key={session.id}
            size="sm"
            variant="ghost"
            className={cn('h-6 px-2 text-[0.625rem]', session.id === active?.id && 'bg-accent')}
            onClick={() => setSelected(session.id)}
          >
            {session.title}
            {session.exited ? ' · exited' : ''}
          </Button>
        ))}
        <IconButton
          label="New terminal session"
          className="size-6"
          disabled={!connected || !shellReady || busy}
          onClick={create}
        >
          <Plus size={12} />
        </IconButton>
        <span className="flex-1" />
        <IconButton
          label="Close terminal session"
          className="size-6"
          disabled={!connected || !active || busy}
          onClick={() => {
            if (active)
              act(() =>
                request(
                  '/api/terminals/close',
                  {
                    id: active.id,
                  },
                  responses.ok,
                ),
              )
          }}
        >
          <Trash2 size={12} />
        </IconButton>
        <IconButton label="Hide terminal pane" className="size-6" onClick={onClose}>
          <ChevronDown size={12} />
        </IconButton>
      </header>
      {sessions.map((session) => (
        <TerminalSession key={session.id} id={session.id} active={session.id === active?.id} />
      ))}
      {!sessions.length && (
        <div className="p-4 text-xs text-muted-foreground">
          <p>
            {connected
              ? shellReady
                ? 'Opening a shell in this task’s checkout…'
                : 'Send the first message to create this worktree before opening a shell.'
              : 'Connect a runtime to use terminals.'}
          </p>
          <Button
            size="sm"
            className="mt-3"
            disabled={!connected || !shellReady || busy}
            onClick={create}
          >
            Open terminal
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="break-words p-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}
