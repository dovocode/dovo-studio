import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect, useRef } from 'react'
import { ChevronDown, Plus, X } from 'lucide-react'
import { canChangeTaskCheckout, responses, useWorkspace } from '@dovo/studio-core'
import { Button, IconButton, ChoicePicker, cn } from '@dovo/studio-ui'
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
  const [layout, setLayout] = useApplicationState<'tabs' | 'columns' | 'rows'>('tabs')
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
          <div key={session.id} className="flex shrink-0 items-center rounded">
            <Button
              size="sm"
              variant="ghost"
              className={cn('h-6 px-2 text-[0.625rem]', session.id === active?.id && 'bg-accent')}
              onClick={() => setSelected(session.id)}
            >
              {session.title}
              {session.exited ? ' · exited' : ''}
            </Button>
            <IconButton
              label={`Close ${session.title}`}
              className="size-6"
              disabled={!connected || busy}
              onClick={() =>
                act(() => request('/api/terminals/close', { id: session.id }, responses.ok))
              }
            >
              <X size={12} />
            </IconButton>
          </div>
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
        <ChoicePicker
          aria-label="Terminal layout"
          className="h-6 shrink-0 rounded px-1 text-[0.625rem]"
          value={layout}
          onValueChange={(value) => {
            if (value === 'tabs' || value === 'columns' || value === 'rows') setLayout(value)
          }}
        >
          <option value="tabs">Tabs</option>
          <option value="columns">Side by side</option>
          <option value="rows">Stacked</option>
        </ChoicePicker>
        <IconButton label="Hide terminal pane" className="size-6" onClick={onClose}>
          <ChevronDown size={12} />
        </IconButton>
      </header>
      {!!sessions.length && (
        <div
          className={cn(
            'flex min-h-0 min-w-0 flex-1',
            layout === 'columns' ? 'flex-row' : 'flex-col',
          )}
        >
          {sessions.map((session) => (
            <div
              key={session.id}
              className={cn(
                'min-h-0 min-w-0 flex-1 flex flex-col',
                layout === 'tabs' && session.id !== active?.id && 'hidden',
                layout !== 'tabs' && 'border border-white/10',
              )}
            >
              {layout !== 'tabs' && (
                <div className="flex h-7 shrink-0 items-center justify-between px-2 text-[0.625rem] text-muted-foreground">
                  <span>{session.title}</span>
                  <IconButton
                    label={`Close ${session.title} pane`}
                    className="size-6"
                    disabled={!connected || busy}
                    onClick={() =>
                      act(() => request('/api/terminals/close', { id: session.id }, responses.ok))
                    }
                  >
                    <X size={12} />
                  </IconButton>
                </div>
              )}
              <TerminalSession
                id={session.id}
                active={visible && (layout !== 'tabs' || session.id === active?.id)}
              />
            </div>
          ))}
        </div>
      )}
      {!sessions.length && (
        <div className="p-4 text-xs text-muted-foreground">
          <p>
            {connected
              ? shellReady
                ? 'No terminal open. Open a shell in this task’s checkout.'
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
