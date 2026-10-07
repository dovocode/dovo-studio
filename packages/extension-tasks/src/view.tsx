import { fileStats } from './files/presentation'
import { randomUUID, checkpointFileCount } from '@dovo/protocol'
import { githubPullTarget } from '@dovo/protocol'
import { ResizableSidebar } from './detail/resizable-sidebar'
import { readTaskListViewState, saveTaskListViewState } from './list/task-list-view-state'
import { useCachedTask } from '@dovo/studio-core'
import { watchRuntimeTask } from '@dovo/protocol'
import type { ArtifactReference, Task } from '@dovo/protocol'
import { PullDetail } from '@dovo/extension-scm/pull-detail'
import { threadPullPreview } from './detail/thread-pull-preview'
import { useApplicationState } from '@dovo/studio-core/state'
import { TaskTools } from './detail/task-tools'
import { TaskAgents } from './detail/task-agents'
import { LinkedProjects } from './detail/linked-projects'
import { ThreadArtifacts } from './chat/artifacts'
import { BrowserPane, DevicesPane } from './browser/browser-pane'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { X, Maximize2, Minimize2 } from 'lucide-react'
import { templateTaskFields } from '@dovo/protocol'
import {
  createTask,
  readAppPreferences,
  useAppPreferences,
  responses,
  updateAppPreferences,
  resolveTaskDefaults,
  useStudioHost,
  useWorkspace,
  type StudioViewProps,
} from '@dovo/studio-core'
import {
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
import { useLiveRefresh } from './detail/live-refresh'
import type { CodeReference } from './detail/code-reference'
import { TerminalPane } from './terminal/terminal-pane'
import {
  collectTasks,
  taskSources,
  taskCollectionKey,
  type TaskEntry,
} from './list/task-collection'
import { TaskSearchDialog, type TaskSearchMode } from './dialogs/task-search-dialog'
import { StartupDraft } from './task-creation/startup-draft'
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
    () =>
      taskSources({
        workspace,
        snapshot,
        activeRuntimeId,
        connected,
        runtimes,
        connection: store.connection,
      }),
    [workspace, snapshot, activeRuntimeId, connected, runtimes, store.connection],
  )
  const preferences = useAppPreferences()
  const host = useStudioHost()
  const localTasks = useMemo(
    () => workspace.tasks.filter((task) => !task.example),
    [workspace.tasks],
  )
  const [selectedId, setSelectedId] = useApplicationState(entityId ?? '')
  const [startupDraft, setStartupDraft] = useState<{
    task: Task
    runtimeId: string | null
  } | null>(null)
  const reportStartupDraft = useCallback((task: Task | null, runtimeId: string | null) => {
    setStartupDraft(task ? { task, runtimeId } : null)
  }, [])
  const [deselected, setDeselected] = useApplicationState(false)
  const selectedTask = deselected ? undefined : localTasks.find((t) => t.id === selectedId)
  const {
    task: storedTask,
    loaded: historyLoaded,
    error: historyError,
  } = useCachedTask(selectedTask)
  // Saving a startup draft changes persistence, not its provider or editor identity.
  const usingStartupDraft =
    !selectedTask ||
    (startupDraft?.runtimeId === activeRuntimeId && startupDraft.task.id === selectedTask.id)
  const task = storedTask ?? (usingStartupDraft ? startupDraft?.task : undefined)
  const hasDiff =
    !!task &&
    (task.files.length > 0 ||
      !!task.linkedCheckouts?.length ||
      task.historyTotals?.hasChanges ||
      (task.turns ?? []).some(
        (turn) => !!turn.checkpoint && checkpointFileCount(turn.checkpoint) > 0,
      ))
  useEffect(() => {
    if (!entityId && storedTask && !deselected)
      host.navigate({ viewId: 'tasks', entityId: storedTask.id })
  }, [entityId, storedTask?.id, deselected])
  const compact = useCompactLayout()
  const [viewerExpanded, setViewerExpanded] = useState(false)
  const [viewerDocked, setViewerDocked] = useState(false)
  const workspacePane = useRef<HTMLDivElement | null>(null)
  const editingFile = useRef(false)
  const setFileEditing = useCallback((value: boolean) => {
    editingFile.current = value
  }, [])

  // Split view: a second task from the connected computer, next to the selected one.
  const [splitId, setSplitId] = useApplicationState('')
  const splitSummary =
    !compact && splitId && splitId !== task?.id
      ? localTasks.find((item) => item.id === splitId && !item.archivedAt)
      : undefined
  const {
    task: splitTask,
    loaded: splitHistoryLoaded,
    error: splitHistoryError,
  } = useCachedTask(splitSummary)
  useEffect(() => {
    const connection = store.connection
    if (!connection) return
    const stops = [storedTask?.id, splitTask?.id]
      .filter((id): id is string => !!id)
      .map((id) => watchRuntimeTask(connection, id))
    return () => stops.forEach((stop) => stop())
  }, [store.connection, storedTask?.id, splitTask?.id])
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
  const [artifactSelection, setArtifactSelection] = useState<{
    threadKey: string
    id: string
    openId: string
  }>()
  const surface = threadSurfaces[threadKey] ?? 'chat'
  const toolsExpanded = surface !== 'chat' && surface !== 'terminal'
  const fileViewer = surface === 'files' || surface === 'changes'
  useEffect(() => {
    const element = workspacePane.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) =>
      setViewerDocked(entry.contentRect.width >= 1050),
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [task?.id])
  const repository = workspace.repositories.find((item) => item.id === task?.repositoryId)
  const refreshChanges = useCallback(async () => {
    if (!task || repository?.kind || editingFile.current) return
    await store.request(
      '/api/scm/changes',
      { repositoryId: task.repositoryId, taskId: task.id },
      responses.files,
    )
  }, [task?.id, task?.repositoryId, repository?.kind, store.request])
  const changesError = useLiveRefresh(
    connected &&
      !!task &&
      !task.archived &&
      !task.archivedAt &&
      !repository?.kind &&
      (task.execution !== 'worktree' || !!task.checkoutBranch || !!task.existingWorktreePath),
    refreshChanges,
  )
  const lastToolSurface = useRef<TaskSurface>('files')
  const setSurface = useCallback(
    (next: TaskSurface) => {
      setThreadSurfaces((current) => ({ ...current, [threadKey]: next }))
    },
    [threadKey],
  )
  const [terminalVisited, setTerminalVisited] = useApplicationState(false)
  const [bottomTerminalTaskId, setBottomTerminalTaskId] = useApplicationState('')
  const bottomTerminalOpen = !compact && bottomTerminalTaskId === threadKey
  // The terminal a chat command just ran in, so the pane shows it.
  const [browserLink, setBrowserLink] = useState<{
    taskId: string
    id: string
    url: string
  } | null>(null)
  const [terminalFocus, setTerminalFocus] = useApplicationState('')
  const panes = useRef<Record<TaskSurface, HTMLDivElement | null>>({
    'pull-preview': null,
    chat: null,
    changes: null,
    files: null,
    terminal: null,
    browser: null,
    devices: null,
    agents: null,
    projects: null,
    artifacts: null,
    'side-chats': null,
  })
  const lastFocus = useRef<Partial<Record<TaskSurface, HTMLElement>>>({})
  const focusNext = useRef<TaskSurface | null>(null)
  const selectSurface = useCallback(
    (next: TaskSurface, moveFocus = false) => {
      for (const id of [
        'pull-preview',
        'chat',
        'changes',
        'files',
        'terminal',
        'browser',
        'devices',
        'agents',
        'projects',
        'artifacts',
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
      if (!compact && next === 'terminal') {
        setBottomTerminalTaskId(threadKey)
        setSurface('chat')
        return
      }
      if (next !== 'chat' && next !== 'terminal') {
        lastToolSurface.current = next
      }
      setSurface(next)
      if (next === 'terminal') {
        setTerminalVisited(true)
        setBottomTerminalTaskId('')
      }
    },
    [compact, setSurface, threadKey],
  )
  const [pullPreviews, setPullPreviews] = useApplicationState<
    Record<string, { repositoryId: string; number: number }>
  >({})
  const openArtifact = (reference: ArtifactReference) => {
    const key = taskCollectionKey(activeRuntimeId, reference.taskId)
    setArtifactSelection({ threadKey: key, id: reference.id, openId: randomUUID() })
    if (reference.taskId !== task?.id) {
      setSelectedId(reference.taskId)
      setSplitId(task?.id ?? '')
      setThreadSurfaces((current) => ({ ...current, [key]: 'artifacts' }))
    } else selectSurface('artifacts', compact)
  }
  const openPullPreview = (target: Task, url: string) => {
    const preview = threadPullPreview(
      githubPullTarget(url)?.url ?? url,
      target,
      workspace.repositories,
    )
    if (!preview) return host.openPullLink?.(url) ?? false
    const key = taskCollectionKey(activeRuntimeId, target.id)
    setPullPreviews((current) => ({ ...current, [key]: preview }))
    if (target.id !== task?.id) {
      setSelectedId(target.id)
      setSplitId(task?.id ?? '')
      setThreadSurfaces((current) => ({ ...current, [key]: 'pull-preview' }))
    } else selectSurface('pull-preview')
    return true
  }
  const proactiveSeen = useRef(new Set<string>())
  useEffect(() => {
    if (
      !preferences.proactivePanels ||
      !task ||
      !historyLoaded ||
      task.status === 'running' ||
      threadSurfaces[threadKey] !== undefined ||
      proactiveSeen.current.has(threadKey)
    )
      return
    proactiveSeen.current.add(threadKey)
    if (task.pullRequest?.url) {
      openPullPreview(task, task.pullRequest.url)
      return
    }
    const lines = task.files
      .map(fileStats)
      .reduce((sum, stats) => sum + stats.additions + stats.deletions, 0)
    if (task.files.length >= 3 || lines >= 50) selectSurface('changes')
  }, [preferences.proactivePanels, task, historyLoaded, threadKey, threadSurfaces])
  const addCodeReference = useCallback(
    (taskId: string, text: string) => {
      setCodeReference({ taskId, id: randomUUID(), text })
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
  }, [surface, terminalVisited, bottomTerminalOpen])
  const showTerminal = useCallback(
    (terminalId: string) => {
      setTerminalFocus(terminalId)
      selectSurface('terminal', true)
    },
    [selectSurface],
  )
  const toggleTerminal = useCallback(() => {
    if (surface !== 'terminal') setTerminalFocus('')
    if (!compact && bottomTerminalOpen) setBottomTerminalTaskId('')
    else selectSurface(surface === 'terminal' ? 'chat' : 'terminal', true)
  }, [selectSurface, surface, compact, bottomTerminalOpen])
  const toggleBottomTerminal = useCallback(() => {
    if (!task) return
    if (bottomTerminalOpen) setBottomTerminalTaskId('')
    else {
      setBottomTerminalTaskId(threadKey)
      selectSurface('chat', true)
    }
  }, [task?.id, threadKey, bottomTerminalOpen, selectSurface])
  useEffect(() => {
    if (!compact && surface === 'terminal') selectSurface('terminal')
  }, [compact, surface, selectSurface])
  useEffect(() => {
    if (surface === 'changes' && !hasDiff) selectSurface('files')
  }, [surface, hasDiff, selectSurface])
  const [projectId, setProjectId, projectRef] = useApplicationState(
    () => readTaskListViewState(host).projectId ?? '',
  )
  useEffect(
    () => () => saveTaskListViewState(host, { projectId: projectRef.current }),
    [host, projectRef],
  )
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
    if (
      busy ||
      (!storedTask &&
        startupDraft?.task.id === entry.task.id &&
        startupDraft.runtimeId === entry.source.runtimeId)
    )
      return
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
    setDraftVersion((version) => version + 1)
    setSidebar(true)
    setDeselected(true)
    setSelectedId('')
    host.navigate({
      viewId: 'tasks',
    })
  }
  const [draftVersion, setDraftVersion] = useApplicationState(0)
  const newThread = useCallback(() => {
    if (busy) return
    setDeselected(true)
    setSelectedId('')
    setSplitId('')
    setListOpen(false)
    setChoosingProject(false)
    setError('')
    setSidebar(true)
    setDraftVersion((version) => version + 1)
    host.navigate({ viewId: 'tasks' })
  }, [busy, host])
  useEffect(
    () =>
      host.registerCommand({
        id: 'tasks.new',
        title: 'New thread',
        run: newThread,
      }),
    [host, newThread],
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
    newThread,
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
  const revealHandled = useCallback(() => setRevealMessage(''), [setRevealMessage])
  const allEntries = useMemo(() => collectTasks(sources), [sources])
  useEffect(() => {
    if (!transcriptNotice) return
    const timer = setTimeout(() => setTranscriptNotice(''), 1800)
    return () => clearTimeout(timer)
  }, [transcriptNotice])
  shortcuts.current = {
    toggleTerminal,
    newThread,
    selectTask: (entry) => void selectTask(entry),
    selectSurface,
    surface,
    task,
    selectedKey: task ? taskCollectionKey(activeRuntimeId, task.id) : '',
    split: !!splitTask,
    stop: () => {
      if (task?.status !== 'running' || !connected) return
      setStopError('')
      void request(
        '/api/tasks/cancel',
        { id: task.id, runId: task.activeRunId },
        responses.ok,
      ).catch((error: unknown) =>
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
      if (mod && !e.altKey && !e.shiftKey && key === 'f' && current.task)
        return run(() => {
          const focusedThread =
            e.target instanceof Element
              ? e.target.closest<HTMLElement>('[data-task-conversation]')?.dataset.taskConversation
              : undefined
          const id = focusedThread ?? current.task!.id
          if (id === current.task!.id) current.selectSurface('chat')
          window.dispatchEvent(new CustomEvent('dovo:search-thread', { detail: id }))
        })
      // ⌘\ (Ctrl+\ elsewhere) closes the side-by-side task.
      if (mod && !e.altKey && !e.shiftKey && e.key === '\\' && current.split)
        return run(() => setSplitId(''))
      // ⌘; (Ctrl+; elsewhere) asks a side question about the open task.
      if (mod && !e.altKey && !e.shiftKey && e.key === ';' && current.task)
        return run(() => setAsking(true))
      if (mod && !e.altKey && !e.shiftKey && key === 'n') return run(() => current.newThread())
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
  const temporaryEntry = useMemo(() => {
    if (storedTask || !startupDraft) return undefined
    const source = sources.find((source) => source.runtimeId === startupDraft.runtimeId)
    if (!source) return undefined
    return collectTasks([
      {
        ...source,
        workspace: { ...source.workspace, tasks: [startupDraft.task] },
      },
    ])[0]
  }, [storedTask, startupDraft, sources])
  const selectedKey = task
    ? taskCollectionKey(activeRuntimeId, task.id)
    : (temporaryEntry?.key ?? '')
  const renderThread = (currentTask: Task, workspaceControls?: ReactNode, temporary = false) => {
    const task = storedTask?.id === currentTask.id ? storedTask : currentTask
    return (
      <div
        key={taskCollectionKey(activeRuntimeId, task.id)}
        className="flex h-full min-h-0 flex-col"
      >
        {temporary ? (
          <header className="studio-task-thread-header">
            New task
            {compact && <Button onClick={() => setListOpen(true)}>Browse tasks</Button>}
          </header>
        ) : (
          <TaskHeader
            onPullLink={(url) => openPullPreview(task, url)}
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
            toolsExpanded={toolsExpanded}
            onTools={() => {
              if (toolsExpanded) {
                lastToolSurface.current = surface
                selectSurface('chat', true)
              } else {
                selectSurface(lastToolSurface.current)
              }
            }}
            bottomTerminalOpen={bottomTerminalOpen}
            onBottomTerminal={toggleBottomTerminal}
          />
        )}
        <div ref={workspacePane} className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <div
            ref={(element) => {
              panes.current.chat = element
            }}
            tabIndex={-1}
            className={cn(
              'relative flex min-h-0 min-w-0 flex-1 flex-col',
              ((fileViewer && viewerExpanded) || (surface !== 'chat' && compact && !fileViewer)) &&
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
            {changesError && (
              <p role="status" className="px-5 py-1 text-xs text-destructive">
                Couldn’t refresh changes: {changesError}
              </p>
            )}
            {stopError && (
              <p role="alert" className="px-5 pt-2 text-xs text-destructive">
                Could not stop the agent. {stopError}
              </p>
            )}
            <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
              <ResizablePanel id="thread" defaultSize={bottomTerminalOpen ? 65 : 100} minSize="30%">
                <TaskConversation
                  historyLoaded={usingStartupDraft || historyLoaded}
                  historyError={historyError}
                  key={taskCollectionKey(activeRuntimeId, task.id)}
                  task={task}
                  temporary={temporary}
                  workspaceControls={workspaceControls}
                  revealMessage={revealMessage}
                  onRevealHandled={revealHandled}
                  codeReference={codeReference?.taskId === task.id ? codeReference : null}
                  visible={!listOpen && (!compact || surface === 'chat')}
                  onReview={() => selectSurface(hasDiff ? 'changes' : 'files')}
                  onTerminal={showTerminal}
                  onPullLink={(url) => openPullPreview(task, url)}
                  onArtifact={openArtifact}
                  onBrowser={(url) => {
                    setBrowserLink({ taskId: task.id, id: randomUUID(), url })
                    selectSurface('browser')
                  }}
                  onAside={() => setAsking(true)}
                  composerInsert={composerInsert?.taskId === task.id ? composerInsert : null}
                  onComposerInsertApplied={() => setComposerInsert(null)}
                />
              </ResizablePanel>
              {bottomTerminalOpen && surface === 'chat' && (
                <>
                  <ResizableHandle />
                  <ResizablePanel id="bottom-terminal" defaultSize="35%" minSize="15%">
                    <div
                      ref={(element) => {
                        if (!compact) panes.current.terminal = element
                      }}
                      tabIndex={-1}
                      className="h-full min-h-0"
                    >
                      <TerminalPane
                        key={`bottom:${task.id}`}
                        taskId={task.id}
                        focusId={terminalFocus}
                        onClose={() => setBottomTerminalTaskId('')}
                      />
                    </div>
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          </div>
          <ResizableSidebar
            key={fileViewer || surface === 'artifacts' ? 'viewer' : 'tools'}
            preference={
              fileViewer || surface === 'artifacts' ? 'viewerSidebarWidth' : 'toolsSidebarWidth'
            }
            side="right"
            label="tools sidebar"
            maxFraction={
              fileViewer && !viewerDocked
                ? 1
                : surface === 'artifacts'
                  ? 0.6
                  : fileViewer
                    ? 0.5
                    : 0.48
            }
            maxWidth={fileViewer && !viewerDocked ? 640 : 960}
            reservedWidth={fileViewer && !viewerDocked ? 72 : 0}
            resizable={!compact && surface !== 'chat' && !(fileViewer && viewerExpanded)}
            aria-label="Workspace tools"
            className={cn(
              'min-h-0 min-w-0 flex-col bg-background',
              surface === 'chat' ? 'hidden' : 'flex',
              fileViewer
                ? viewerExpanded
                  ? 'flex-1 border-l'
                  : viewerDocked && !compact
                    ? 'shrink-0 border-l'
                    : cn(
                        'absolute inset-y-2 z-30 rounded-lg border shadow-2xl overflow-hidden',
                        compact ? 'right-2' : 'right-14',
                        compact && 'w-[min(640px,calc(100%-72px))]',
                      )
                : compact
                  ? 'flex-1'
                  : 'shrink-0 border-l',
            )}
          >
            {fileViewer && (
              <div className="flex h-9 shrink-0 items-center gap-1 border-b px-3 text-xs">
                <span className="flex-1 text-muted-foreground">
                  {surface === 'files' ? 'Project files' : 'Changes'}
                </span>
                <IconButton
                  label={viewerExpanded ? 'Restore side panel' : 'Expand viewer'}
                  aria-pressed={viewerExpanded}
                  className="size-7"
                  onClick={() => setViewerExpanded((value) => !value)}
                >
                  {viewerExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                </IconButton>
                <IconButton
                  label="Close viewer"
                  className="size-7"
                  onClick={() => selectSurface('chat', true)}
                >
                  <X size={14} />
                </IconButton>
              </div>
            )}
            {!compact &&
              surface !== 'pull-preview' &&
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
            {surface === 'pull-preview' && pullPreviews[threadKey] && (
              <div
                ref={(element) => {
                  panes.current['pull-preview'] = element
                }}
                tabIndex={-1}
                className="flex min-h-0 flex-1 flex-col"
              >
                <PullDetail
                  key={JSON.stringify([threadKey, pullPreviews[threadKey]])}
                  repositoryId={pullPreviews[threadKey]!.repositoryId}
                  number={pullPreviews[threadKey]!.number}
                  embedded
                  onBack={() => selectSurface('chat', true)}
                  onChanged={() => {}}
                />
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
                    setComposerInsert({ taskId: task.id, id: randomUUID(), text })
                    selectSurface('chat', true)
                  }}
                />
              </div>
            )}
            {surface === 'artifacts' && (
              <div
                ref={(element) => {
                  panes.current.artifacts = element
                }}
                tabIndex={-1}
                className="min-h-0 min-w-0 flex-1 overflow-hidden"
              >
                <ThreadArtifacts
                  key={`${threadKey}:${artifactSelection?.threadKey === threadKey ? artifactSelection.openId : ''}`}
                  taskId={task.id}
                  initialId={
                    artifactSelection?.threadKey === threadKey ? artifactSelection.id : undefined
                  }
                  onClose={() => selectSurface('chat', true)}
                />
              </div>
            )}
            {surface === 'projects' && (
              <div
                ref={(element) => {
                  panes.current.projects = element
                }}
                tabIndex={-1}
                className="min-h-0 flex-1 overflow-y-auto p-4"
              >
                <LinkedProjects key={threadKey} task={task} />
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
                {surface === 'devices' ? (
                  <DevicesPane taskId={task.id} onClose={() => selectSurface('chat', true)} />
                ) : (
                  <BrowserPane
                    taskId={task.id}
                    openLink={browserLink?.taskId === task.id ? browserLink : null}
                    onLinkOpened={() => setBrowserLink(null)}
                    onClose={() => selectSurface('chat', true)}
                  />
                )}
              </div>
            )}
            <div
              ref={(element) => {
                panes.current.changes = element
              }}
              tabIndex={-1}
              className={cn('min-h-0 min-w-0 flex-1', surface !== 'changes' && 'hidden')}
            >
              {surface === 'changes' && (
                <ReviewPane
                  key={task.id}
                  task={task}
                  onReference={(text) => addCodeReference(task.id, text)}
                  onEditingChange={setFileEditing}
                />
              )}
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
                  onEditingChange={setFileEditing}
                  onReference={(text) => addCodeReference(task.id, text)}
                />
              )}
            </div>
            <div
              ref={(element) => {
                if (compact) panes.current.terminal = element
              }}
              tabIndex={-1}
              className={cn('min-h-0 min-w-0 flex-1', surface !== 'terminal' && 'hidden')}
            >
              {compact && terminalVisited && (
                <TerminalPane
                  key={task.id}
                  taskId={task.id}
                  focusId={terminalFocus}
                  visible={surface === 'terminal'}
                  onClose={() => selectSurface('chat', true)}
                />
              )}
            </div>
          </ResizableSidebar>
          {!compact && !temporary && (
            <TaskTools
              surface={surface}
              onSelect={(next) => selectSurface(next === surface ? 'chat' : next)}
              hasDiff={hasDiff}
              artifactsEnabled={!!snapshot?.artifactsEnabled}
            />
          )}
        </div>
      </div>
    )
  }
  return (
    <>
      <div className="flex min-h-0 min-w-0 flex-1">
        <ResizableSidebar
          as="div"
          preference="threadSidebarWidth"
          side="left"
          label="thread sidebar"
          maxFraction={0.45}
          maxWidth={640}
          resizable={(sidebar || !task) && !compact}
          className={cn('min-h-0', (!(sidebar || !task) || compact) && 'hidden')}
        >
          {(sidebar || !task) && !compact && (
            <div className="h-full min-w-0">
              <TaskList
                titleHeader
                projectId={projectId}
                onProjectChange={setProjectId}
                selectedId={selectedKey}
                sources={sources}
                temporaryEntry={temporaryEntry}
                activeRuntimeId={activeRuntimeId}
                busy={busy}
                error={error}
                onSelect={(entry) => void selectTask(entry)}
                onCreate={(project) => void startTask(project)}
                onNewThread={newThread}
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
          )}
        </ResizableSidebar>
        <ResizablePanelGroup orientation="horizontal" className="min-w-0 flex-1">
          <ResizablePanel id="conversation" minSize="30%">
            {usingStartupDraft ? (
              <StartupDraft
                key={taskCollectionKey(activeRuntimeId, String(draftVersion))}
                onDraftChange={reportStartupDraft}
                onProject={() => void startTask()}
                renderThread={renderThread}
                onCommit={(draft) => {
                  setSelectedId(draft.id)
                  setDeselected(false)
                  host.navigate({ viewId: 'tasks', entityId: draft.id })
                }}
              />
            ) : task ? (
              renderThread(task)
            ) : null}
          </ResizablePanel>
          {splitTask && (
            <>
              <ResizableHandle />
              <ResizablePanel id="split" defaultSize="36%" minSize="24%">
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
                      historyLoaded={splitHistoryLoaded}
                      historyError={splitHistoryError}
                      onPullLink={(url) => openPullPreview(splitTask, url)}
                      onArtifact={openArtifact}
                      key={`split:${splitTask.id}`}
                      task={splitTask}
                      visible
                      onBrowser={(url) => {
                        setBrowserLink({ taskId: splitTask.id, id: randomUUID(), url })
                        setThreadSurfaces((current) => ({
                          ...current,
                          [taskCollectionKey(activeRuntimeId, splitTask.id)]: 'browser',
                        }))
                        setSelectedId(splitTask.id)
                        setSplitId(task?.id ?? '')
                      }}
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
            temporaryEntry={temporaryEntry}
            activeRuntimeId={activeRuntimeId}
            busy={busy}
            error={error}
            onSelect={(entry) => void selectTask(entry)}
            onCreate={(project) => void startTask(project)}
            onNewThread={newThread}
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
        noProject={false}
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
