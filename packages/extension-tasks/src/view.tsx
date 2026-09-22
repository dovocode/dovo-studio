import { Files, Terminal, Globe, PanelRightClose, Monitor, Folder } from 'lucide-react'
import { BrowserPane } from './browser/browser-pane'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  createTask,
  defaultTaskHarness,
  useStudioHost,
  useWorkspace,
  type StudioViewProps,
} from '@dovo/studio-core'
import {
  EmptyState,
  IconButton,
  Button,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  useCompactLayout,
  cn,
  Input,
} from '@dovo/studio-ui'
import { TaskList } from './task-list'
import { TaskHeader, type TaskSurface } from './task-header'
import { TaskConversation } from './task-conversation'
import { ReviewPane } from './review/review-pane'
import { TerminalPane } from './terminal/terminal-pane'
import { taskSources, taskCollectionKey, type TaskEntry } from './task-collection'
export default function TasksView({ entityId }: StudioViewProps) {
  const store = useWorkspace()
  const { workspace, setWorkspace, activeRuntimeId, switchRuntime } = store
  const sources = useMemo(() => taskSources(store), [store])
  const host = useStudioHost()
  const localTasks = workspace.tasks.filter((task) => !task.example)
  const [selectedId, setSelectedId] = useState(
    entityId ?? localTasks.find((t) => !t.archived)?.id ?? localTasks[0]?.id ?? '',
  )
  const [deselected, setDeselected] = useState(false)
  const compact = useCompactLayout()
  const [listOpen, setListOpen] = useState(false)
  const [sidebar, setSidebar] = useState(true)
  const [surface, setSurface] = useState<TaskSurface>('chat')
  const [split, setSplit] = useState(false)
  const [terminalVisited, setTerminalVisited] = useState(false)
  const panes = useRef<Record<TaskSurface, HTMLDivElement | null>>({
    chat: null,
    changes: null,
    terminal: null,
    browser: null,
  })
  const lastFocus = useRef<Partial<Record<TaskSurface, HTMLElement>>>({})
  const focusNext = useRef<TaskSurface | null>(null)
  const selectSurface = useCallback(
    (next: TaskSurface, moveFocus = false) => {
      for (const id of ['chat', 'changes', 'terminal', 'browser'] as const) {
        const focused = document.activeElement
        if (focused instanceof HTMLElement && panes.current[id]?.contains(focused)) {
          lastFocus.current[id] = focused
          // A toolbar click keeps focus on the toolbar. In-pane actions and shortcuts
          // move it out of content that is about to become hidden.
          if (id !== next && (id !== 'chat' || !split || compact)) moveFocus = true
        }
      }
      if (moveFocus) focusNext.current = next
      setSurface(next)
      if (next !== 'chat' && !compact) setSplit(true)
      if (next === 'terminal') setTerminalVisited(true)
    },
    [compact, split],
  )
  useLayoutEffect(() => {
    const next = focusNext.current
    if (!next) return
    focusNext.current = null
    const pane = panes.current[next]
    if (!pane) return
    const previous = lastFocus.current[next]
    const focusable = (element: HTMLElement) =>
      !!element.getClientRects().length && !element.matches(':disabled')
    const input = [...pane.querySelectorAll<HTMLElement>('textarea')].find(focusable)
    const target =
      previous && pane.contains(previous) && focusable(previous)
        ? previous
        : (input ??
          [...pane.querySelectorAll<HTMLElement>('input, button, [tabindex="0"]')].find(focusable))
    ;(target ?? pane).focus({ preventScroll: true })
  }, [surface, terminalVisited])
  const toggleTerminal = useCallback(() => {
    selectSurface(surface === 'terminal' ? 'chat' : 'terminal', true)
  }, [selectSurface, surface])
  const [projectId, setProjectId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [choosingProject, setChoosingProject] = useState(false)
  const [projectQuery, setProjectQuery] = useState('')
  const [suggestedProject, setSuggestedProject] = useState('')
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const [pendingCreate, setPendingCreate] = useState<{
    runtimeId: string | null
    repositoryId: string
  } | null>(null)
  const startTask = useCallback(
    async (requestedProject?: string, confirmed = false) => {
      if (busy) return
      if (!confirmed) {
        setSuggestedProject(requestedProject ?? projectId)
        setProjectQuery('')
        setError('')
        setChoosingProject(true)
        return
      }
      const selection = requestedProject ?? projectId
      const target = sources
        .flatMap((source) =>
          source.workspace.repositories.map((repository) => ({ source, repository })),
        )
        .find(
          ({ source, repository }) =>
            taskCollectionKey(source.runtimeId, repository.id) === selection,
        )
      if (!target) {
        setError('This project is no longer available. Choose another project.')
        return
      }
      if (!target.source.online) {
        setError('This device is offline. Reconnect it before starting a task.')
        return
      }
      const runtimeId = target.source.runtimeId
      const repositoryId = target.repository.id
      setBusy(true)
      setError('')
      try {
        if (runtimeId && runtimeId !== activeRuntimeId) await switchRuntime(runtimeId)
        if (!mounted.current) return
        setPendingCreate({ runtimeId, repositoryId })
      } catch (error) {
        setError(error instanceof Error ? error.message : String(error))
        setBusy(false)
      }
    },
    [projectId, workspace.repositories, sources, activeRuntimeId, switchRuntime, busy],
  )
  useEffect(() => {
    if (!pendingCreate || pendingCreate.runtimeId !== activeRuntimeId) return
    if (
      pendingCreate.repositoryId &&
      !workspace.repositories.some((repository) => repository.id === pendingCreate.repositoryId)
    ) {
      setError('This project is no longer available. Choose another project.')
      setPendingCreate(null)
      setBusy(false)
      return
    }
    const task = createTask({
      title: 'New task',
      objective: '',
      agentId: '',
      harness: defaultTaskHarness('codex'),
      execution: 'main',
      repositoryId: pendingCreate.repositoryId,
    })
    setWorkspace((w) => ({ ...w, tasks: [task, ...w.tasks] }))
    setSelectedId(task.id)
    setDeselected(false)
    setSurface('chat')
    setSplit(false)
    setChoosingProject(false)
    setListOpen(false)
    setPendingCreate(null)
    setBusy(false)
    host.navigate({ viewId: 'tasks', entityId: task.id })
  }, [activeRuntimeId, host, pendingCreate, setWorkspace, workspace.repositories])
  const selectTask = async (entry: TaskEntry) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      if (entry.source.runtimeId && entry.source.runtimeId !== activeRuntimeId)
        await switchRuntime(entry.source.runtimeId)
      if (!mounted.current) return
      setSelectedId(entry.task.id)
      setDeselected(false)
      host.navigate({ viewId: 'tasks', entityId: entry.task.id })
      setListOpen(false)
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    if (entityId) {
      setSelectedId(entityId)
      setDeselected(false)
    }
  }, [entityId])
  const deselectTask = () => {
    setDeselected(true)
    setSelectedId('')
    host.navigate({ viewId: 'tasks' })
  }
  useEffect(
    () => host.registerCommand({ id: 'tasks.new', title: 'New task', run: () => startTask() }),
    [host, startTask],
  )
  useEffect(
    () =>
      host.registerCommand({
        id: 'tasks.terminal',
        title: 'Toggle terminal',
        run: toggleTerminal,
      }),
    [host, toggleTerminal],
  )
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.ctrlKey &&
        !e.altKey &&
        !e.metaKey &&
        e.key === '`' &&
        !e.defaultPrevented &&
        !e.isComposing &&
        !e.repeat &&
        !(
          e.target instanceof Element &&
          e.target.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')
        )
      ) {
        e.preventDefault()
        toggleTerminal()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [toggleTerminal])
  const task = deselected
    ? undefined
    : (localTasks.find((t) => t.id === selectedId) ??
      (entityId ? undefined : (localTasks.find((t) => !t.archived) ?? localTasks[0])))
  const selectedKey = task ? taskCollectionKey(activeRuntimeId, task.id) : ''
  return (
    <>
      <div className="flex min-h-0 flex-1">
        <ResizablePanelGroup direction="horizontal">
          {(sidebar || !task) && !compact && (
            <>
              <ResizablePanel id="task-list" order={1} defaultSize={18} minSize={15} maxSize={35}>
                <TaskList
                  projectId={projectId}
                  onProjectChange={setProjectId}
                  selectedId={selectedKey}
                  sources={sources}
                  activeRuntimeId={activeRuntimeId}
                  busy={busy}
                  error={error}
                  onSelect={(entry) => void selectTask(entry)}
                  onCreate={(project) => void startTask(project)}
                  onDeselect={deselectTask}
                />
              </ResizablePanel>
              <ResizableHandle />
            </>
          )}
          <ResizablePanel id="conversation" order={2} minSize={30}>
            {task ? (
              <div
                key={taskCollectionKey(activeRuntimeId, task.id)}
                className="flex h-full min-h-0 flex-col"
              >
                <TaskHeader
                  task={task}
                  surface={surface}
                  onSurface={selectSurface}
                  split={surface !== 'chat'}
                  compact={compact}
                  onSplit={() => selectSurface(surface === 'chat' ? 'browser' : 'chat')}
                  onSidebar={() => (compact ? setListOpen(true) : setSidebar((value) => !value))}
                />
                <div className="flex min-h-0 min-w-0 flex-1">
                  <div
                    ref={(element) => {
                      panes.current.chat = element
                    }}
                    tabIndex={-1}
                    className={cn(
                      'min-h-0 min-w-0 flex-1',
                      surface !== 'chat' && compact && 'hidden',
                    )}
                  >
                    <TaskConversation
                      task={task}
                      visible={!listOpen && (!compact || surface === 'chat')}
                      onReview={() => selectSurface('changes')}
                    />
                  </div>
                  <aside
                    aria-label="Workspace tools"
                    className={cn(
                      'min-h-0 min-w-0 flex-col',
                      surface === 'chat' ? 'hidden' : 'flex',
                      compact ? 'flex-1' : 'w-[380px] max-w-[48%] shrink-0 border-l',
                    )}
                  >
                    {!compact && (
                      <div className="flex h-10 shrink-0 items-center gap-1 border-b px-2">
                        <div
                          role="group"
                          aria-label="Workspace tools"
                          className="flex min-w-0 flex-1 gap-0.5"
                        >
                          {(
                            [
                              ['changes', 'Diff', Files],
                              ['terminal', 'Terminal', Terminal],
                              ['browser', 'Preview', Globe],
                            ] as const
                          ).map(([id, label, Icon]) => (
                            <Button
                              key={id}
                              variant="ghost"
                              size="sm"
                              aria-pressed={surface === id}
                              onClick={() => selectSurface(id)}
                              className={cn(
                                'h-7 gap-1.5 px-2 text-xs',
                                surface === id && 'bg-muted',
                              )}
                            >
                              <Icon size={13} />
                              {label}
                            </Button>
                          ))}
                        </div>
                        <IconButton
                          label="Hide workspace sidebar"
                          className="size-7 shrink-0"
                          onClick={() => selectSurface('chat', true)}
                        >
                          <PanelRightClose size={14} />
                        </IconButton>
                      </div>
                    )}
                    {surface === 'browser' && (
                      <div
                        ref={(element) => {
                          panes.current.browser = element
                        }}
                        tabIndex={-1}
                        className="min-h-0 min-w-0 flex-1"
                      >
                        <BrowserPane taskId={task.id} />
                      </div>
                    )}
                    <div
                      ref={(element) => {
                        panes.current.changes = element
                      }}
                      tabIndex={-1}
                      className={cn('min-h-0 min-w-0 flex-1', surface !== 'changes' && 'hidden')}
                    >
                      <ReviewPane key={task.id} task={task} />
                    </div>
                    <div
                      ref={(element) => {
                        panes.current.terminal = element
                      }}
                      tabIndex={-1}
                      className={cn('min-h-0 min-w-0 flex-1', surface !== 'terminal' && 'hidden')}
                    >
                      {terminalVisited && (
                        <TerminalPane
                          key={task.id}
                          taskId={task.id}
                          onClose={() => selectSurface('chat', true)}
                        />
                      )}
                    </div>
                  </aside>
                </div>
              </div>
            ) : (
              <EmptyState
                title="Choose a task"
                description="Your conversations from every connected computer appear together."
                action={
                  <div className="flex gap-2">
                    {compact && (
                      <Button variant="outline" onClick={() => setListOpen(true)}>
                        Browse tasks
                      </Button>
                    )}
                    <Button disabled={busy} onClick={() => void startTask()}>
                      Create task
                    </Button>
                  </div>
                }
              />
            )}
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
      <Dialog open={compact && listOpen} onOpenChange={setListOpen}>
        <DialogContent className="flex h-[80dvh] max-w-sm flex-col p-0">
          <DialogTitle className="px-4 pt-4">Tasks</DialogTitle>
          <DialogDescription className="sr-only">Select or create a task.</DialogDescription>
          <TaskList
            projectId={projectId}
            onProjectChange={setProjectId}
            selectedId={selectedKey}
            sources={sources}
            activeRuntimeId={activeRuntimeId}
            busy={busy}
            error={error}
            onSelect={(entry) => void selectTask(entry)}
            onCreate={(project) => void startTask(project)}
            onDeselect={deselectTask}
          />
        </DialogContent>
      </Dialog>
      <Dialog
        open={choosingProject}
        onOpenChange={(open) => {
          if (!busy) setChoosingProject(open)
        }}
      >
        <DialogContent className="max-w-md">
          <DialogTitle>New task</DialogTitle>
          <DialogDescription>
            Choose the project and computer where this task will run.
          </DialogDescription>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <Input
            aria-label="Search projects and devices"
            placeholder="Search projects or devices…"
            value={projectQuery}
            onChange={(event) => setProjectQuery(event.target.value)}
          />
          <div className="max-h-[55dvh] space-y-3 overflow-y-auto">
            {sources.map((source) => {
              const repositories = source.workspace.repositories.filter((repository) =>
                `${repository.name} ${repository.path} ${source.name}`
                  .toLowerCase()
                  .includes(projectQuery.trim().toLowerCase()),
              )
              if (!repositories.length) return null
              return (
                <section key={source.runtimeId ?? 'local'} aria-label={source.name}>
                  <h3 className="flex items-center gap-2 px-3 py-1 text-xs text-muted-foreground">
                    <Monitor className="size-3.5" />
                    <span className="truncate">{source.name}</span>
                    {!source.online && <span className="ml-auto">Offline</span>}
                  </h3>
                  {repositories.map((repository) => {
                    const key = taskCollectionKey(source.runtimeId, repository.id)
                    return (
                      <Button
                        key={key}
                        variant="ghost"
                        disabled={busy || !source.online}
                        className={cn(
                          'h-auto w-full justify-start gap-2 px-3 py-2 text-left',
                          key === suggestedProject && 'bg-muted/50',
                        )}
                        onClick={() => void startTask(key, true)}
                      >
                        <Folder className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0">
                          <span className="block truncate">{repository.name}</span>
                          <span className="block truncate text-xs font-normal text-muted-foreground">
                            {repository.path}
                          </span>
                        </span>
                      </Button>
                    )
                  })}
                </section>
              )
            })}
            {projectQuery &&
              !sources.some((source) =>
                source.workspace.repositories.some((repository) =>
                  `${repository.name} ${repository.path} ${source.name}`
                    .toLowerCase()
                    .includes(projectQuery.trim().toLowerCase()),
                ),
              ) && (
                <p className="px-3 py-4 text-sm text-muted-foreground">
                  No matching projects or devices.
                </p>
              )}
            {!sources.some((source) => source.workspace.repositories.length) && (
              <p className="py-4 text-sm text-muted-foreground">
                Add a project from the Projects menu to start a task.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
