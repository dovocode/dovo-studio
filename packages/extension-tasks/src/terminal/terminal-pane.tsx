import {
  readTerminalLayout,
  saveTerminalLayout,
  MAX_TERMINAL_PANES,
  nextTerminalPane,
} from './terminal-layout-state'
import { Schema } from 'effect'
import { mutableStruct } from '@dovo/protocol'
import type { TerminalFileLink } from './terminal-file-links'
import { terminalGroups, splitTerminal, type TerminalGroup } from '@dovo/protocol'
import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect, useRef } from 'react'
import { ChevronDown, Plus, X, Columns2, Rows2 } from 'lucide-react'
import { canChangeTaskCheckout, responses, useWorkspace } from '@dovo/studio-core'
import { Button, IconButton, cn, ChoicePicker } from '@dovo/studio-ui'
import { TerminalCloseDialog } from './terminal-close-dialog'
import { TerminalSession } from './terminal-session'
const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
export function TerminalPane({
  taskId,
  onClose,
  focusId = '',
  visible = true,
  onAddSelection,
  onOpenFile,
}: {
  taskId: string
  onClose: () => void
  /** Select this session, for example after a chat command ran in it. */
  focusId?: string
  visible?: boolean
  onAddSelection?: (taskId: string, text: string) => void
  onOpenFile?: (file: TerminalFileLink & { checkoutId?: string }) => void
}) {
  const { snapshot, workspace, connected, request, connection } = useWorkspace()
  const scope = JSON.stringify([connection?.runtimeId ?? connection?.address, taskId])
  const ownerScope = JSON.stringify([scope, connection?.address, connection?.token])
  const initialLayout = useRef(readTerminalLayout(scope))
  const currentScope = useRef({ scope: ownerScope, request, generation: 0 })
  if (currentScope.current.scope !== ownerScope || currentScope.current.request !== request) {
    currentScope.current = {
      scope: ownerScope,
      request,
      generation: currentScope.current.generation + 1,
    }
  }
  useEffect(
    () => () => {
      currentScope.current.generation++
    },
    [scope, request, ownerScope],
  )
  const previousScope = useRef(scope)
  const [layoutOwner, setLayoutOwner] = useApplicationState(scope)
  const [selected, setSelected] = useApplicationState(focusId || initialLayout.current.selected),
    [error, setError] = useApplicationState(''),
    [busy, setBusy] = useApplicationState(false)
  const [savedGroups, setGroups] = useApplicationState<TerminalGroup[]>(
    initialLayout.current.groups,
  )
  useEffect(() => {
    closeTarget.current = null
    setClosing(null)
    pending.current = false
    setBusy(false)
    setError('')
    if (previousScope.current === scope) return
    previousScope.current = scope
    const saved = readTerminalLayout(scope)
    setGroups(saved.groups)
    setLayoutOwner(scope)
    setSelected(focusId || saved.selected)
    autoTried.current = false
    setFocusRequest({ id: '', count: 0 })
  }, [scope, request, ownerScope])
  const [checkoutId, setCheckoutId] = useApplicationState('')
  type CloseTarget = {
    ids: string[]
    labels: string[]
    next?: string
    restore?: string
    generation: number
    request: typeof request
  }
  const closeFocus = useRef<string | undefined>(undefined)
  const closeTarget = useRef<CloseTarget | null>(null)
  const [closing, setClosing] = useApplicationState<CloseTarget | null>(null)
  useEffect(() => {
    if (!visible || !connected) {
      closeTarget.current = null
      setClosing(null)
    }
  }, [visible, connected])
  const pending = useRef(false)
  const autoTried = useRef(false)
  useEffect(() => {
    if (focusId) focusPane(focusId)
  }, [focusId])
  const sessions = snapshot?.terminals.filter((session) => session.taskId === taskId) ?? [],
    active =
      sessions.find((session) => session.id === selected) ??
      sessions.find((session) =>
        savedGroups
          .find((group) => group.sessions.includes(selected))
          ?.sessions.includes(session.id),
      ) ??
      sessions[0]
  const groups = terminalGroups(
    savedGroups,
    sessions.map((session) => session.id),
  )
  const liveSessions = useRef(sessions)
  liveSessions.current = sessions
  const group = groups.find((group) => group.sessions.includes(active?.id ?? ''))
  const checkoutLabel = (session: (typeof sessions)[number]) => {
    const link = task?.linkedCheckouts?.find((item) => item.id === session.checkoutId)
    const repository = workspace.repositories.find(
      (repo) => repo.id === (link?.repositoryId ?? task?.repositoryId),
    )
    return `${repository?.name ?? 'Project'} · ${link?.branch ?? (link ? link.execution : (task?.checkoutBranch ?? 'Primary checkout'))}`
  }
  const layout = group?.layout ?? 'columns'
  const splitLimit = (group?.sessions.length ?? 0) >= MAX_TERMINAL_PANES
  const [focusRequest, setFocusRequest] = useApplicationState({ id: '', count: 0 })
  const focusPane = (id: string) => {
    setSelected(id)
    setFocusRequest((current) => ({ id, count: current.count + 1 }))
  }
  useEffect(() => {
    if (connected && sessions.length && layoutOwner === scope)
      saveTerminalLayout(scope, active?.id ?? selected, groups)
  }, [
    scope,
    layoutOwner,
    connected,
    selected,
    savedGroups,
    sessions.map((session) => session.id).join(','),
  ])
  useEffect(() => {
    if (visible && active && !focusRequest.id) focusPane(active.id)
  }, [visible, active?.id])
  const task = workspace.tasks.find((item) => item.id === taskId)
  const shellReady =
    !!task &&
    (task.execution !== 'worktree' || !!task.existingWorktreePath || !canChangeTaskCheckout(task))
  const act = (operation: () => Promise<unknown>) => {
    if (!connected || !shellReady || pending.current || closeTarget.current) return
    pending.current = true
    const generation = currentScope.current.generation
    setBusy(true)
    setError('')
    void operation()
      .catch((error) => {
        if (generation === currentScope.current.generation) setError(String(error))
      })
      .finally(() => {
        if (generation !== currentScope.current.generation) return
        pending.current = false
        setBusy(false)
      })
  }
  const askClose = (ids: string[]) => {
    if (!connected || !visible || pending.current || closeTarget.current) return
    const target: CloseTarget = {
      ids: [...ids],
      labels: ids.map((id) => sessions.find((session) => session.id === id)?.title ?? id),
      next: ids.includes(active?.id ?? '')
        ? (group?.sessions.find((id) => !ids.includes(id)) ??
          groups.flatMap((item) => item.sessions).find((id) => !ids.includes(id)))
        : active?.id,
      restore: active?.id,
      generation: currentScope.current.generation,
      request,
    }
    closeFocus.current = target.restore
    closeTarget.current = target
    setClosing(target)
  }
  const closePane = (id: string) => askClose([id])
  const cancelClose = () => {
    closeTarget.current = null
    setClosing(null)
  }
  const confirmClose = () => {
    const target = closeTarget.current
    cancelClose()
    if (!target || target.generation !== currentScope.current.generation || !visible) return
    closeFocus.current = target.next
    act(async () => {
      try {
        for (const id of target.ids) {
          if (target.generation !== currentScope.current.generation) return
          await target.request('/api/terminals/close', { id }, responses.ok)
        }
        if (target.next && target.generation === currentScope.current.generation)
          focusPane(target.next)
      } catch (error) {
        if (target.generation === currentScope.current.generation) {
          const remaining = liveSessions.current
          const restore = remaining.find((session) => session.id === target.restore) ?? remaining[0]
          if (restore) focusPane(restore.id)
        }
        throw error
      }
    })
  }
  const create = (split?: TerminalGroup['layout']) => {
    if (split && splitLimit) return
    const generation = currentScope.current.generation
    act(() =>
      request(
        '/api/terminals',
        {
          taskId,
          checkoutId: split ? active?.checkoutId : checkoutId || undefined,
        },
        responses.terminal,
      ).then((session) => {
        if (generation !== currentScope.current.generation) return
        if (split && active) setGroups(splitTerminal(groups, active.id, session.id, split))
        focusPane(session.id)
      }),
    )
  }
  useEffect(() => {
    if (!visible) {
      autoTried.current = false
      return
    }
    if (autoTried.current || !connected || !shellReady || !!focusId) return
    autoTried.current = true
    if (sessions.length) return
    const generation = currentScope.current.generation
    act(() =>
      request('/api/terminals/ensure', { taskId }, responses.terminal).then((session) => {
        if (generation === currentScope.current.generation) setSelected(session.id)
      }),
    )
  }, [connected, shellReady, taskId, sessions, focusId, visible])
  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[#0d0e10]"
      aria-label="Terminal"
      onKeyDownCapture={(event) => {
        if (
          event.nativeEvent.isComposing ||
          event.keyCode === 229 ||
          !visible ||
          event.altKey ||
          (mac
            ? !event.metaKey || event.ctrlKey
            : !event.ctrlKey || !event.shiftKey || event.metaKey)
        )
          return
        const key = event.key.toLowerCase()
        if (!(mac ? ['d', 'n', 'w'] : ['d', 'e', 'n', 'w']).includes(key)) return
        event.preventDefault()
        event.stopPropagation()
        if (key === 'd') create(mac && event.shiftKey ? 'rows' : 'columns')
        else if (key === 'e') create('rows')
        else if (key === 'n') create()
        else if (active) closePane(active.id)
      }}
    >
      {!!task?.linkedCheckouts?.length && (
        <ChoicePicker
          aria-label="New terminal checkout"
          value={checkoutId}
          onValueChange={setCheckoutId}
        >
          <option value="">Primary checkout</option>
          {task.linkedCheckouts.map((link) => (
            <option key={link.id} value={link.id}>
              {workspace.repositories.find((repo) => repo.id === link.repositoryId)?.name ??
                link.repositoryId}{' '}
              · {link.branch ?? link.execution}
            </option>
          ))}
        </ChoicePicker>
      )}
      <header className="flex h-8 shrink-0 items-center gap-1 overflow-x-auto border-b px-2">
        {groups.map((tab, index) => {
          const session = sessions.find((session) => session.id === tab.sessions[0])!
          return (
            <div key={tab.id} className="flex shrink-0 items-center rounded">
              <Button
                size="sm"
                variant="ghost"
                className={cn('h-6 px-2 text-[0.625rem]', tab.id === group?.id && 'bg-accent')}
                onClick={() => focusPane(session.id)}
              >
                {tab.sessions.length > 1
                  ? `Terminal ${index + 1} · ${tab.sessions.length} panes`
                  : session.title}
                {task?.linkedCheckouts?.length ? ` · ${checkoutLabel(session)}` : ''}
                {session.exited ? ' · exited' : ''}
              </Button>
              <IconButton
                label={`Close terminal tab ${index + 1}`}
                className="size-6"
                disabled={!connected || busy}
                onClick={() => askClose(tab.sessions)}
              >
                <X size={12} />
              </IconButton>
            </div>
          )
        })}
        <IconButton
          label="New terminal session"
          className="size-6"
          disabled={!connected || !shellReady || busy}
          onClick={() => create()}
        >
          <Plus size={12} />
        </IconButton>
        <span className="flex-1" />
        <IconButton
          label={`Split terminal left/right (${mac ? 'Cmd+D' : 'Ctrl+Shift+D'}, max 4 panes)`}
          className="size-6"
          disabled={!connected || !active || busy || !shellReady || splitLimit}
          onClick={() => create('columns')}
        >
          <Columns2 size={12} />
        </IconButton>
        <IconButton
          label={`Split terminal top/bottom (${mac ? 'Cmd+Shift+D' : 'Ctrl+Shift+E'}, max 4 panes)`}
          className="size-6"
          disabled={!connected || !active || busy || !shellReady || splitLimit}
          onClick={() => create('rows')}
        >
          <Rows2 size={12} />
        </IconButton>
        {group && group.sessions.length > 1 && (
          <>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[0.625rem]"
              onClick={() => {
                const next = nextTerminalPane(group.sessions, active?.id ?? '', 1)
                if (next) focusPane(next)
              }}
            >
              Next pane
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[0.625rem]"
              onClick={() =>
                setGroups(
                  groups.map((item) =>
                    item.id === group.id
                      ? { ...item, layout: layout === 'rows' ? 'columns' : 'rows' }
                      : item,
                  ),
                )
              }
            >
              {layout === 'rows' ? 'Side by side' : 'Stack panes'}
            </Button>
          </>
        )}
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
          {groups
            .flatMap((group) => group.sessions)
            .map((id) => sessions.find((session) => session.id === id)!)
            .map((session) => (
              <div
                key={session.id}
                data-terminal-session={session.id}
                data-active-pane={session.id === active?.id}
                onPointerDown={() => setSelected(session.id)}
                onFocusCapture={() => setSelected(session.id)}
                className={cn(
                  'min-h-0 min-w-0 flex-1 flex flex-col',
                  !group?.sessions.includes(session.id) && 'hidden',
                  group && group.sessions.length > 1 && 'border',
                  group &&
                    group.sessions.length > 1 &&
                    (session.id === active?.id ? 'border-primary/70' : 'border-white/10'),
                )}
              >
                {group && group.sessions.length > 1 && (
                  <div className="flex h-7 shrink-0 items-center justify-between px-2 text-[0.625rem] text-muted-foreground">
                    <span title={checkoutLabel(session)}>
                      {session.title} · {checkoutLabel(session)}
                    </span>
                    <IconButton
                      label={`Close ${session.title} pane`}
                      className="size-6"
                      disabled={!connected || busy}
                      onClick={() => closePane(session.id)}
                    >
                      <X size={12} />
                    </IconButton>
                  </div>
                )}
                <TerminalSession
                  id={session.id}
                  focusRequest={focusRequest.id === session.id ? focusRequest.count : 0}
                  onOpenFile={
                    onOpenFile
                      ? async (file) => {
                          const generation = currentScope.current.generation
                          const result = await request(
                            '/api/terminals/file',
                            { id: session.id, path: file.path },
                            mutableStruct({
                              taskId: Schema.String,
                              path: Schema.String,
                              checkoutId: Schema.optional(Schema.String),
                            }),
                          )
                          if (generation !== currentScope.current.generation) return
                          if (result.taskId !== taskId)
                            throw new Error('This terminal belongs to another thread')
                          onOpenFile({
                            ...file,
                            path: result.path,
                            ...(result.checkoutId ? { checkoutId: result.checkoutId } : {}),
                          })
                        }
                      : undefined
                  }
                  readOnly={!!session.exited}
                  active={visible && !!group?.sessions.includes(session.id)}
                  onAddSelection={
                    onAddSelection ? (text) => onAddSelection(taskId, text) : undefined
                  }
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
            onClick={() => create()}
          >
            Open terminal
          </Button>
        </div>
      )}
      {closing &&
        closing.generation === currentScope.current.generation &&
        visible &&
        connected && (
          <TerminalCloseDialog
            labels={closing.labels}
            onCancel={cancelClose}
            onConfirm={confirmClose}
            onRestoreFocus={() => {
              if (
                closing.generation === currentScope.current.generation &&
                visible &&
                connected &&
                closeFocus.current
              )
                focusPane(closeFocus.current)
            }}
          />
        )}
      {error && (
        <p role="alert" className="break-words p-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}
