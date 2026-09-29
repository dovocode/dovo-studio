import { useApplicationState } from '@dovo/studio-core/state'
import { TaskTools } from './detail/task-tools'
import { TaskAgents } from './detail/task-agents'
import { BrowserPane } from './browser/browser-pane'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { templateTaskFields } from '@dovo/protocol'
import {
  createTask,
  readAppPreferences,
  responses,
  updateAppPreferences,
  resolveTaskDefaults,
  useStudioHost,
  useWorkspace,
  type StudioViewProps,
} from '@dovo/studio-core'
import {
  EmptyState,
  Button,
  IconButton,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  ProjectIcon,
  useCompactLayout,
  cn,
} from '@dovo/studio-ui'
import { TaskList } from './list/task-list'
import { TaskHeader, type TaskSurface } from './detail/task-header'
import { TaskConversation } from './detail/task-conversation'
import { ReviewPane } from './review/review-pane'
import { TaskFiles } from './detail/task-files'
import type { CodeReference } from './detail/code-reference'
import { TerminalPane } from './terminal/terminal-pane'
import {
  collectTasks,
  taskSources,
  taskCollectionKey,
  type TaskEntry,
} from './list/task-collection'
import { TaskSearchDialog, type TaskSearchMode } from './dialogs/task-search-dialog'
import { ProjectSelectionDialog } from './task-creation/project-selection-dialog'
import { SideQuestion } from './chat/thread/side-question'
const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
export default function TasksView({ entityId }: StudioViewProps) {
  const store = useWorkspace()
  const { workspace, setWorkspace, activeRuntimeId, switchRuntime } = store
  const { snapshot, connected, runtimes } = store
  // Depend on the exact slices taskSources reads so the collection is only rebuilt when
  // the underlying data changes, not on every context value identity change.
  const sources = useMemo(
    () => taskSources({ workspace, snapshot, activeRuntimeId, connected, runtimes }),
    [workspace, snapshot, activeRuntimeId, connected, runtimes],
  )
  const host = useStudioHost()
  const localTasks = useMemo(
    () => workspace.tasks.filter((task) => !task.example),
    [workspace.tasks],
  )
  const [selectedId, setSelectedId] = useApplicationState(
    entityId ??
      localTasks.find((t) => !t.archived && !t.archivedAt)?.id ??
      localTasks.find((t) => !t.archivedAt)?.id ??
      '',
  )
  const [deselected, setDeselected] = useApplicationState(false)
  const task = deselected
    ? undefined
    : (localTasks.find((t) => t.id === selectedId) ??
      (entityId
        ? undefined
        : (localTasks.find((t) => !t.archived && !t.archivedAt) ??
          localTasks.find((t) => !t.archivedAt))))
  const hasDiff =
    !!task &&
    (task.files.length > 0 ||
      (task.turns ?? []).some(
        (turn) =>
          !!turn.checkpoint && turn.checkpoint.files.length + turn.checkpoint.omitted.length > 0,
      ))
  useEffect(() => {
    if (!entityId && task && !deselected) host.navigate({ viewId: 'tasks', entityId: task.id })
  }, [entityId, task?.id, deselected])
  const compact = useCompactLayout()
  // Split view: a second task from the connected computer, next to the selected one.
  const [splitId, setSplitId] = useApplicationState('')
  const splitTask =
    !compact && splitId && splitId !== task?.id
      ? localTasks.find((item) => item.id === splitId && !item.archivedAt)
      : undefined
  const [listOpen, setListOpen] = useApplicationState(false)
  const [sidebar, setSidebar] = useApplicationState(true)
  const [codeReference, setCodeReference] = useState<CodeReference | null>(null)
  const [composerInsert, setComposerInsert] = useState<{
    taskId: string
    id: string
    text: string
  } | null>(null)
  const threadKey = taskCollectionKey(activeRuntimeId, task?.id ?? selectedId)
  const [threadSurfaces, setThreadSurfaces] = useApplicationState<Record<string, TaskSurface>>({})
  const surface = threadSurfaces[threadKey] ?? 'chat'
  const setSurface = useCallback(
    (next: TaskSurface) => {
      setThreadSurfaces((current) => ({ ...current, [threadKey]: next }))
    },
    [threadKey],
  )
  const [terminalVisited, setTerminalVisited] = useApplicationState(false)
  const [bottomTerminalTaskId, setBottomTerminalTaskId] = useApplicationState('')
  const bottomTerminalOpen = !compact && bottomTerminalTaskId === task?.id
  // The terminal a chat command just ran in, so the pane shows it.
  const [terminalFocus, setTerminalFocus] = useApplicationState('')
  const panes = useRef<Record<TaskSurface, HTMLDivElement | null>>({
    chat: null,
    changes: null,
    files: null,
    terminal: null,
    browser: null,
    devices: null,
    agents: null,
    'side-chats': null,
  })
  const lastFocus = useRef<Partial<Record<TaskSurface, HTMLElement>>>({})
  const focusNext = useRef<TaskSurface | null>(null)
  const selectSurface = useCallback(
    (next: TaskSurface, moveFocus = false) => {
      for (const id of [
        'chat',
        'changes',
        'files',
        'terminal',
        'browser',
        'devices',
        'agents',
        'side-chats',
      ] as const) {
        const focused = document.activeElement
        if (focused instanceof HTMLElement && panes.current[id]?.contains(focused)) {
          lastFocus.current[id] = focused
          // A toolbar click keeps focus on the toolbar. In-pane actions and shortcuts
          // move it out of content that is about to become hidden.
          if (id !== next && (id !== 'chat' || compact)) moveFocus = true
        }
      }
      if (moveFocus) focusNext.current = next
      setSurface(next)
      if (next === 'terminal') {
        setTerminalVisited(true)
        setBottomTerminalTaskId('')
      }
    },
    [compact, setSurface],
  )
  const addCodeReference = useCallback(
    (taskId: string, text: string) => {
      setCodeReference({ taskId, id: crypto.randomUUID(), text })
      selectSurface('chat', true)
    },
    [selectSurface],
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
    ;(target ?? pane).focus({
      preventScroll: true,
    })
  }, [surface, terminalVisited])
  const showTerminal = useCallback(
    (terminalId: string) => {
      setTerminalFocus(terminalId)
      selectSurface('terminal', true)
    },
    [selectSurface],
  )
  const toggleTerminal = useCallback(() => {
    if (surface !== 'terminal') setTerminalFocus('')
    selectSurface(surface === 'terminal' ? 'chat' : 'terminal', true)
  }, [selectSurface, surface])
  const toggleBottomTerminal = useCallback(() => {
    if (!task) return
    if (bottomTerminalOpen) setBottomTerminalTaskId('')
    else {
      setBottomTerminalTaskId(task.id)
      selectSurface('chat', true)
    }
  }, [task?.id, bottomTerminalOpen, selectSurface])
  useEffect(() => {
    if (surface === 'changes' && !hasDiff) selectSurface('files')
  }, [surface, hasDiff, selectSurface])
  const [projectId, setProjectId] = useApplicationState('')
  const [busy, setBusy] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const [choosingProject, setChoosingProject] = useApplicationState(false)
  const [projectQuery, setProjectQuery] = useApplicationState('')
  const [suggestedProject, setSuggestedProject] = useApplicationState('')
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const [pendingCreate, setPendingCreate] = useApplicationState<{
    runtimeId: string | null
    repositoryId: string
    templateId?: string
  } | null>(null)
  const startTask = useCallback(
    async (requestedProject?: string, confirmed = false, templateId?: string) => {
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
          source.workspace.repositories.map((repository) => ({
            source,
            repository,
          })),
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
        setPendingCreate({
          runtimeId,
          repositoryId,
          templateId,
        })
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
    const repository = workspace.repositories.find((repo) => repo.id === pendingCreate.repositoryId)
    const template = repository?.templates?.find((item) => item.id === pendingCreate.templateId)
    const created = createTask({
      title: template?.name ?? 'New task',
      objective: '',
      agentId: '',
      ...resolveTaskDefaults(store.snapshot?.defaults, repository),
      repositoryId: pendingCreate.repositoryId,
    })
    // A template prefills the draft and settings; nothing is sent until the user sends it.
    const task = template ? { ...created, ...templateTaskFields(template) } : created
    setWorkspace((w) => ({
      ...w,
      tasks: [task, ...w.tasks],
    }))
    setSelectedId(task.id)
    setDeselected(false)
    setChoosingProject(false)
    setListOpen(false)
    setPendingCreate(null)
    setBusy(false)
    host.navigate({
      viewId: 'tasks',
      entityId: task.id,
    })
  }, [
    activeRuntimeId,
    host,
    pendingCreate,
    setWorkspace,
    workspace.repositories,
    store.snapshot?.defaults,
  ])
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
      host.navigate({
        viewId: 'tasks',
        entityId: entry.task.id,
      })
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
    host.navigate({
      viewId: 'tasks',
    })
  }
  useEffect(
    () =>
      host.registerCommand({
        id: 'tasks.new',
        title: 'New task',
        run: () => startTask(),
      }),
    [host, startTask],
  )
  useEffect(() => {
    const disposers = [
      host.registerCommand({
        id: 'tasks.switch',
        title: 'Go to task…',
        run: () => setSearching('tasks'),
      }),
      host.registerCommand({
        id: 'tasks.search',
        title: 'Search conversations…',
        run: () => setSearching('messages'),
      }),
    ]
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, [host])
  useEffect(
    () =>
      host.registerCommand({
        id: 'tasks.terminal',
        title: 'Toggle terminal',
        run: toggleTerminal,
      }),
    [host, toggleTerminal],
  )
  // Sidebar order, reported by the visible task list, for switching tasks from the keyboard.
  const order = useRef<TaskEntry[]>([])
  const reportOrder = useCallback((entries: TaskEntry[]) => {
    order.current = entries
  }, [])
  const shortcuts = useRef({
    toggleTerminal,
    startTask,
    selectTask: (_entry: TaskEntry) => {},
    selectSurface,
    surface,
    task,
    selectedKey: '',
    stop: () => {},
    split: false,
  })
  const { request } = store
  const [stopError, setStopError] = useApplicationState('')
  const [transcriptNotice, setTranscriptNotice] = useApplicationState('')
  const setAsking = (open: boolean) => selectSurface(open ? 'side-chats' : 'chat', true)
  const [searching, setSearching] = useApplicationState<TaskSearchMode | null>(null)
  // After opening a search result, scroll its message into view once the thread renders.
  const [revealMessage, setRevealMessage] = useApplicationState('')
  useEffect(() => {
    if (!revealMessage) return
    let attempts = 0
    let frame = 0
    const reveal = () => {
      const element = document.getElementById(revealMessage)
      if (element) {
        element.scrollIntoView({ block: 'center' })
        element.classList.add('studio-search-hit')
        setTimeout(() => element.classList.remove('studio-search-hit'), 1600)
        setRevealMessage('')
      } else if (attempts++ < 30) frame = requestAnimationFrame(reveal)
      else setRevealMessage('')
    }
    frame = requestAnimationFrame(reveal)
    return () => cancelAnimationFrame(frame)
  }, [revealMessage])
  const allEntries = useMemo(() => collectTasks(sources), [sources])
  useEffect(() => {
    if (!transcriptNotice) return
    const timer = setTimeout(() => setTranscriptNotice(''), 1800)
    return () => clearTimeout(timer)
  }, [transcriptNotice])
  shortcuts.current = {
    toggleTerminal,
    startTask,
    selectTask: (entry) => void selectTask(entry),
    selectSurface,
    surface,
    task,
    selectedKey: task ? taskCollectionKey(activeRuntimeId, task.id) : '',
    split: !!splitTask,
    stop: () => {
      if (task?.status !== 'running' || !connected) return
      setStopError('')
      void request('/api/tasks/cancel', { id: task.id }, responses.ok).catch((error: unknown) =>
        setStopError(error instanceof Error ? error.message : String(error)),
      )
    },
  }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.repeat) return
      if (
        e.target instanceof Element &&
        e.target.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')
      )
        return
      const current = shortcuts.current
      const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
      const key = e.key.toLowerCase()
      const run = (action: () => void) => {
        e.preventDefault()
        action()
      }
      if (e.ctrlKey && !e.altKey && !e.metaKey && e.key === '`') return run(current.toggleTerminal)
      // ⌘P jumps to a task; ⌘⇧F searches every conversation.
      if (mod && !e.altKey && !e.shiftKey && key === 'p') return run(() => setSearching('tasks'))
      if (mod && !e.altKey && e.shiftKey && key === 'f') return run(() => setSearching('messages'))
      // ⌘\ (Ctrl+\ elsewhere) closes the side-by-side task.
      if (mod && !e.altKey && !e.shiftKey && e.key === '\\' && current.split)
        return run(() => setSplitId(''))
      // ⌘; (Ctrl+; elsewhere) asks a side question about the open task.
      if (mod && !e.altKey && !e.shiftKey && e.key === ';' && current.task)
        return run(() => setAsking(true))
      if (mod && !e.altKey && !e.shiftKey && key === 'n') return run(() => void current.startTask())
      // Ctrl+O cycles how much of each turn shows: folded steps, every step, replies only.
      if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && key === 'o')
        return run(() => {
          const next = (
            { collapsed: 'expanded', expanded: 'hidden', hidden: 'collapsed' } as const
          )[readAppPreferences().toolActivity]
          updateAppPreferences({ toolActivity: next })
          setTranscriptNotice(
            next === 'expanded'
              ? 'Showing every step'
              : next === 'hidden'
                ? 'Showing replies only'
                : 'Showing folded steps',
          )
        })
      if (mod && !e.altKey && e.shiftKey && key === 'd')
        return run(() =>
          current.selectSurface(current.surface === 'changes' ? 'chat' : 'changes', true),
        )
      // Ctrl+Tab everywhere, and ⌘⇧] / ⌘⇧[ like other Mac apps, move through the sidebar.
      const step =
        e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'Tab'
          ? e.shiftKey
            ? -1
            : 1
          : mod &&
              e.shiftKey &&
              !e.altKey &&
              (e.code === 'BracketRight' || e.code === 'BracketLeft')
            ? e.code === 'BracketRight'
              ? 1
              : -1
            : 0
      if (step) {
        const entries = order.current
        if (!entries.length) return
        const index = entries.findIndex((entry) => entry.key === current.selectedKey)
        const next = entries[(index + step + entries.length) % entries.length]
        if (next && next.key !== current.selectedKey) run(() => current.selectTask(next))
        else e.preventDefault()
        return
      }
      // Esc stops a running agent, but never inside the terminal or a tool pane that uses Esc.
      if (
        e.key === 'Escape' &&
        !e.altKey &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.shiftKey &&
        current.task?.status === 'running' &&
        (e.target === document.body ||
          (e.target instanceof Node && !!panes.current.chat?.contains(e.target)))
      )
        return run(current.stop)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
  const selectedKey = task ? taskCollectionKey(activeRuntimeId, task.id) : ''
  return (
    <>
      <div className="flex min-h-0 min-w-0 flex-1">
        <ResizablePanelGroup direction="horizontal" className="min-w-0">
          {(sidebar || !task) && !compact && (
            <>
              <ResizablePanel id="task-list" order={1} defaultSize={22} minSize={15} maxSize={45}>
                <div className="h-full min-w-0">
                  <TaskList
                    titleHeader
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
                    onOrderChange={reportOrder}
                    onSplit={(entry) => {
                      if (entry.source.runtimeId === activeRuntimeId) setSplitId(entry.task.id)
                    }}
                    onTemplate={(entry, templateId) =>
                      void startTask(entry.projectKey, true, templateId)
                    }
                  />
                </div>
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
                  onSurface={(next) => {
                    if (next === 'terminal') setTerminalFocus('')
                    selectSurface(next)
                  }}
                  compact={compact}
                  sidebarVisible={sidebar}
                  onSidebar={() => (compact ? setListOpen(true) : setSidebar((value) => !value))}
                  onTerminal={showTerminal}
                  hasDiff={hasDiff}
                />
                <div className="flex min-h-0 min-w-0 flex-1">
                  <div
                    ref={(element) => {
                      panes.current.chat = element
                    }}
                    tabIndex={-1}
                    className={cn(
                      'relative flex min-h-0 min-w-0 flex-1 flex-col',
                      (surface === 'changes' ||
                        surface === 'files' ||
                        (surface !== 'chat' && compact)) &&
                        'hidden',
                    )}
                  >
                    <p
                      role="status"
                      aria-live="polite"
                      className={cn(
                        'pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-md border bg-popover px-2.5 py-1 text-xs shadow-sm transition-opacity motion-reduce:transition-none',
                        transcriptNotice ? 'opacity-100' : 'opacity-0',
                      )}
                    >
                      {transcriptNotice}
                    </p>
                    {stopError && (
                      <p role="alert" className="px-5 pt-2 text-xs text-destructive">
                        Could not stop the agent. {stopError}
                      </p>
                    )}
                    <ResizablePanelGroup direction="vertical" className="min-h-0 flex-1">
                      <ResizablePanel
                        id="thread"
                        order={1}
                        defaultSize={bottomTerminalOpen ? 65 : 100}
                        minSize={30}
                      >
                        <TaskConversation
                          key={taskCollectionKey(activeRuntimeId, task.id)}
                          task={task}
                          codeReference={codeReference?.taskId === task.id ? codeReference : null}
                          visible={!listOpen && (!compact || surface === 'chat')}
                          onReview={() => selectSurface(hasDiff ? 'changes' : 'files')}
                          onTerminal={showTerminal}
                          onAside={() => setAsking(true)}
                          composerInsert={
                            composerInsert?.taskId === task.id ? composerInsert : null
                          }
                          onComposerInsertApplied={() => setComposerInsert(null)}
                        />
                      </ResizablePanel>
                      {bottomTerminalOpen && surface === 'chat' && (
                        <>
                          <ResizableHandle />
                          <ResizablePanel
                            id="bottom-terminal"
                            order={2}
                            defaultSize={35}
                            minSize={15}
                          >
                            <TerminalPane
                              key={`bottom:${task.id}`}
                              taskId={task.id}
                              onClose={() => setBottomTerminalTaskId('')}
                            />
                          </ResizablePanel>
                        </>
                      )}
                    </ResizablePanelGroup>
                  </div>
                  <aside
                    aria-label="Workspace tools"
                    className={cn(
                      'min-h-0 min-w-0 flex-col',
                      surface === 'chat' ? 'hidden' : 'flex',
                      compact || surface === 'changes' || surface === 'files'
                        ? 'flex-1'
                        : 'w-[380px] max-w-[48%] shrink-0 border-l',
                    )}
                  >
                    {!compact &&
                      surface !== 'browser' &&
                      surface !== 'devices' &&
                      surface !== 'changes' &&
                      surface !== 'files' && (
                        <div className="flex h-9 shrink-0 items-center justify-between border-b px-3 text-xs text-muted-foreground">
                          <span>Thread tools</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2"
                            onClick={() => selectSurface('chat', true)}
                          >
                            Close
                          </Button>
                        </div>
                      )}
                    {surface === 'side-chats' && (
                      <div
                        className="flex min-h-0 flex-1 flex-col"
                        ref={(element) => {
                          panes.current['side-chats'] = element
                        }}
                        tabIndex={-1}
                      >
                        <SideQuestion
                          key={task.id}
                          task={task}
                          onAddToComposer={(text) => {
                            setComposerInsert({ taskId: task.id, id: crypto.randomUUID(), text })
                            selectSurface('chat', true)
                          }}
                        />
                      </div>
                    )}
                    {surface === 'agents' && (
                      <div
                        ref={(element) => {
                          panes.current.agents = element
                        }}
                        tabIndex={-1}
                        className="min-h-0 flex-1 overflow-y-auto"
                      >
                        <TaskAgents task={task} />
                      </div>
                    )}
                    {(surface === 'browser' || surface === 'devices') && (
                      <div
                        ref={(element) => {
                          panes.current[surface] = element
                        }}
                        tabIndex={-1}
                        className="min-h-0 min-w-0 flex-1"
                      >
                        <BrowserPane
                          key={surface}
                          taskId={task.id}
                          initialMode={surface === 'devices' ? 'devices' : 'remote'}
                          onClose={() => selectSurface('chat', true)}
                        />
                      </div>
                    )}
                    <div
                      ref={(element) => {
                        panes.current.changes = element
                      }}
                      tabIndex={-1}
                      className={cn('min-h-0 min-w-0 flex-1', surface !== 'changes' && 'hidden')}
                    >
                      <ReviewPane
                        key={task.id}
                        task={task}
                        onReference={(text) => addCodeReference(task.id, text)}
                      />
                    </div>
                    <div
                      ref={(element) => {
                        panes.current.files = element
                      }}
                      tabIndex={-1}
                      className={cn('min-h-0 min-w-0 flex-1', surface !== 'files' && 'hidden')}
                    >
                      {surface === 'files' && (
                        <TaskFiles
                          key={task.id}
                          task={task}
                          onReference={(text) => addCodeReference(task.id, text)}
                        />
                      )}
                    </div>
                    <div
                      ref={(element) => {
                        panes.current.terminal = element
                      }}
                      tabIndex={-1}
                      className={cn('min-h-0 min-w-0 flex-1', surface !== 'terminal' && 'hidden')}
                    >
                      {terminalVisited && !bottomTerminalOpen && (
                        <TerminalPane
                          key={task.id}
                          taskId={task.id}
                          focusId={terminalFocus}
                          visible={surface === 'terminal'}
                          onClose={() => selectSurface('chat', true)}
                        />
                      )}
                    </div>
                  </aside>
                  {!compact && (
                    <TaskTools
                      surface={surface}
                      onSelect={(next) => {
                        if (next === 'terminal') setTerminalFocus('')
                        selectSurface(next === surface ? 'chat' : next)
                      }}
                      hasDiff={hasDiff}
                      bottomTerminalOpen={bottomTerminalOpen}
                      onBottomTerminal={toggleBottomTerminal}
                    />
                  )}
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-0 flex-col">
                {!compact && <header className="studio-task-thread-header">Tasks</header>}
                <div className="min-h-0 flex-1">
                  <EmptyState
                    title="What would you like to work on?"
                    description="Pick up a task from the sidebar, or start with a question, a fix, or a new idea."
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
                </div>
              </div>
            )}
          </ResizablePanel>
          {splitTask && (
            <>
              <ResizableHandle />
              <ResizablePanel id="split" order={3} defaultSize={36} minSize={24}>
                <section
                  aria-label={`Side by side: ${splitTask.title}`}
                  className="flex h-full min-h-0 flex-col border-l"
                >
                  <header className="studio-task-thread-header text-xs">
                    <ProjectIcon
                      repository={workspace.repositories.find(
                        (repo) => repo.id === splitTask.repositoryId,
                      )}
                      className="size-4"
                    />
                    <span className="min-w-0 flex-1 truncate font-medium" title={splitTask.title}>
                      {splitTask.title}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[0.6875rem]"
                      onClick={() => {
                        const previous = task?.id ?? ''
                        setSelectedId(splitTask.id)
                        setDeselected(false)
                        setSplitId(previous)
                        host.navigate({ viewId: 'tasks', entityId: splitTask.id })
                      }}
                    >
                      Swap
                    </Button>
                    <IconButton
                      label="Close side-by-side task (⌘/Ctrl+\)"
                      className="size-6"
                      onClick={() => setSplitId('')}
                    >
                      <X className="size-3.5" />
                    </IconButton>
                  </header>
                  <div className="min-h-0 flex-1">
                    <TaskConversation
                      key={`split:${splitTask.id}`}
                      task={splitTask}
                      visible
                      onReview={() => {
                        setSelectedId(splitTask.id)
                        setSplitId(task?.id ?? '')
                        selectSurface('changes')
                      }}
                    />
                  </div>
                </section>
              </ResizablePanel>
            </>
          )}
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
            onOrderChange={reportOrder}
          />
        </DialogContent>
      </Dialog>
      <TaskSearchDialog
        mode={searching}
        entries={allEntries}
        onModeChange={setSearching}
        onClose={() => setSearching(null)}
        onSelect={(entry, messageId) => {
          void selectTask(entry)
          if (messageId) {
            selectSurface('chat')
            setRevealMessage(`message-${entry.task.id}-${messageId}`)
          }
        }}
      />
      <ProjectSelectionDialog
        open={choosingProject}
        onOpenChange={(open) => {
          if (!busy) setChoosingProject(open)
        }}
        sources={sources}
        busy={busy}
        error={error}
        projectQuery={projectQuery}
        onProjectQueryChange={setProjectQuery}
        suggestedProject={suggestedProject}
        onSelect={(projectKey) => void startTask(projectKey, true)}
      />
    </>
  )
}
