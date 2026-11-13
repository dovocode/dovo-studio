import { botScope } from './bots/bot-scope'
import type { WorkspaceControls } from './chat/composer/composer-workspace'
import type { SelectRemoteProject } from './chat/composer/composer-project'
import type { CodeFinding } from '@dovo/protocol'
import { fileStats } from './files/presentation'
import { randomUUID, checkpointFileCount } from '@dovo/protocol'
import { forgePullTarget, pullRepositoryIdentity } from '@dovo/protocol'
import { FloatingPreview, type PreviewPlacement } from './detail/floating-preview'
import { ResizableSidebar } from './detail/resizable-sidebar'
import { BotWorkSummary } from './bots/bot-work-summary'
import { BotSettings } from './bots/bot-settings'
import { readTaskListViewState, saveTaskListViewState } from './list/task-list-view-state'
import { useCachedTask } from '@dovo/studio-core'
import {
  nativeAgentKey as nativeThreadKey,
  nativeFailureKey,
  watchRuntimeTask,
} from '@dovo/protocol'
import type { ArtifactReference, Subagent, Task } from '@dovo/protocol'
import { PullDetail } from '@dovo/extension-scm/pull-detail'
import { threadPullPreview } from './detail/thread-pull-preview'
import { useApplicationState } from '@dovo/studio-core/state'
import { TaskTools } from './detail/task-tools'
import { TaskAgents } from './detail/task-agents'
import { NativeAgentThread } from './detail/native-agent-thread'
import { LinkedProjects } from './detail/linked-projects'
import { ThreadArtifacts } from './chat/artifacts'
import { BrowserPane, DevicesPane } from './browser/browser-pane'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { X, Maximize2, Minimize2, Bot, FolderSymlink, FileDiff } from 'lucide-react'
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
  HeaderContent,
  SidebarHeader,
  useLeftSidebar,
  useNavigationSidebar,
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
import { TaskProjectPanel } from './detail/task-project-panel'
import { TaskProjectPanelRoot, ThreadInfoPanel } from './detail/thread-info-panel'
import { TaskLinkedPullPanel } from './detail/task-linked-pull-panel'
import { taskPullLinks } from './detail/task-pull-links'
import { TaskHeader, type TaskSurface } from './detail/task-header'
import { TaskConversation } from './detail/task-conversation'
import { ReviewPane } from './review/review-pane'
import { TaskFiles } from './detail/task-files'
import { useLiveRefreshState } from './detail/live-refresh'
import {
  BackgroundRefreshProvider,
  BackgroundRefreshIssue,
  BackgroundRefreshNotice,
} from './detail/background-refresh-notice'
import { useCommittedCallback } from './detail/use-committed-callback'
import { TerminalPane } from './terminal/terminal-pane'
import { terminalSelectionIsCurrent } from './terminal/terminal-selection'
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
import { ReplicatedThread } from './detail/replicated-thread'
import {
  BringBackButton,
  DiscardSideDraft,
  SideThreadAttentionBadge,
  SideThreadAttentionBanner,
  SideThreadBar,
  SideThreadProvenance,
  SideThreadsPanel,
  focusSideThreadAttention,
  useSideThreadAttention,
} from './chat/thread/side-threads-panel'
import {
  forgetSideChatBeside,
  handoffApplied,
  recordHandoff,
  recordSideChatBeside,
  sideChatBeside,
  sideThreadOf,
  unusedSideDraft,
  type SideThreadHandoff,
} from './detail/side-threads'
import { ReviewSideThreadChangesButton } from './detail/side-thread-changes'
import { sideThreadAttention, type SideThreadAttention } from '@dovo/protocol'
const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
export default function TasksView({
  entityId,
  threadParent,
  nativeAgentKey,
  navigationKey,
  pullTarget,
  embedded = false,
  onBotDeleted,
}: StudioViewProps & { embedded?: boolean; onBotDeleted?: (id: string) => void }) {
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
  // Unified can replace its host object when palette registration rerenders the shell.
  // Subscriptions depend on the registry function, not unrelated navigation context.
  const { registerCommand } = host
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
  const deletionSelection = useRef({ id: selectedId, runtimeId: activeRuntimeId })
  deletionSelection.current = { id: selectedId, runtimeId: activeRuntimeId }
  const selectedTask = deselected ? undefined : localTasks.find((t) => t.id === selectedId)
  const {
    task: storedTask,
    loaded: historyLoaded,
    error: historyError,
    retry: retryHistory,
    retrying: historyRetrying,
    retryError: historyRetryError,
    unauthorized: historyUnauthorized,
  } = useCachedTask(selectedTask)
  // Saving a startup draft changes persistence, not its provider or editor identity.
  const usingStartupDraft =
    !selectedTask ||
    (startupDraft?.runtimeId === activeRuntimeId && startupDraft.task.id === selectedTask.id)
  const task = storedTask ?? (usingStartupDraft ? startupDraft?.task : undefined)
  const hasDiff =
    !!task &&
    (workspace.repositories.some((repo) => repo.id === task.repositoryId && !repo.kind) ||
      task.files.length > 0 ||
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
    retry: retrySplitHistory,
    retrying: splitHistoryRetrying,
    retryError: splitHistoryRetryError,
    unauthorized: splitHistoryUnauthorized,
  } = useCachedTask(splitSummary)
  useEffect(() => {
    const connection = store.connection
    if (!connection) return
    const stops = [deselected ? undefined : selectedId || entityId, splitId]
      .filter((id): id is string => !!id)
      .map((id) => watchRuntimeTask(connection, id))
    return () => stops.forEach((stop) => stop())
  }, [store.connection, deselected, selectedId, entityId, splitId])
  // A side chat shown beside its parent returns with that parent, and only with it. Other
  // side-by-side threads keep their usual behavior.
  const runtimeIdentity = snapshot?.runtimeId
  const besideScope = (parentId: string) => taskCollectionKey(activeRuntimeId, parentId)
  const pairedChild =
    !compact && task ? sideChatBeside(besideScope(task.id), runtimeIdentity) : undefined
  const restorableChild = localTasks.some(
    (item) =>
      item.id === pairedChild && !item.archivedAt && sideThreadOf(item)?.parentTaskId === task?.id,
  )
    ? pairedChild!
    : ''
  // Restores once per parent selection; a side chat opened explicitly with the parent wins.
  const restoredFor = useRef('')
  useEffect(() => {
    if (compact || !task) return
    const parentKey = besideScope(task.id)
    if (restoredFor.current === parentKey) return
    const shown = localTasks.find((item) => item.id === splitId)
    const link = shown && sideThreadOf(shown)
    if (link?.parentTaskId === task.id) {
      restoredFor.current = parentKey
      return
    }
    if (restorableChild) {
      restoredFor.current = parentKey
      setSplitId(restorableChild)
      return
    }
    // A side chat paired with another parent does not follow the selection.
    if (link) setSplitId('')
    // Wait for a paired side chat that has not loaded yet.
    if (!pairedChild) restoredFor.current = parentKey
  }, [task?.id, restorableChild, compact, activeRuntimeId])
  useEffect(() => {
    if (task && splitSummary && sideThreadOf(splitSummary)?.parentTaskId === task.id)
      recordSideChatBeside(besideScope(task.id), runtimeIdentity, splitSummary.id)
  }, [task?.id, splitSummary?.id, runtimeIdentity, activeRuntimeId])
  /** Closing, or explicitly replacing, a side-by-side side chat ends its pairing. */
  const closeSplit = (next = '') => {
    if (task && splitSummary && sideThreadOf(splitSummary)?.parentTaskId === task.id)
      forgetSideChatBeside(besideScope(task.id))
    setSplitId(next)
  }
  const [listOpen, setListOpen] = useApplicationState(false)
  const [sidebarPreference, setSidebar] = useLeftSidebar(!host.threadWindow)
  const sidebar = !embedded && sidebarPreference
  const navigationSidebar = useNavigationSidebar()
  useEffect(() => {
    if (!embedded && compact && navigationSidebar?.setCollapsed)
      setListOpen(!navigationSidebar.collapsed)
  }, [compact, navigationSidebar?.collapsed, navigationSidebar?.setCollapsed])
  const [sideChatDrafts, setSideChatDrafts] = useState<Record<string, Record<string, string>>>({})
  const [composerInsert, setComposerInsert] = useState<{
    threadKey: string
    id: string
    text: string
    replaceKey?: string
  } | null>(null)
  // Side chat results wait for their parent's composer, which appends each receipt once.
  const [handoffs, setHandoffs] = useState<
    { threadKey: string; id: string; text: string; once: true }[]
  >([])
  const threadKey = taskCollectionKey(activeRuntimeId, task?.id ?? selectedId)
  const [threadSurfaces, setThreadSurfaces] = useApplicationState<Record<string, TaskSurface>>({})
  const [artifactSelection, setArtifactSelection] = useState<{
    threadKey: string
    id: string
    openId: string
  }>()
  const [nativeThread, setNativeThread] = useState<{
    parentKey: string
    taskId: string
    agent: Subagent
  }>()
  const openedNativeRoute = useRef('')
  useEffect(() => {
    const route = JSON.stringify([activeRuntimeId, entityId, nativeAgentKey, navigationKey])
    if (!nativeAgentKey) {
      openedNativeRoute.current = ''
      return
    }
    if (!entityId || openedNativeRoute.current === route) return
    const owner = workspace.tasks.find((item) => item.id === entityId)
    const agent = owner?.subagents?.find(
      (agent) =>
        agent.source !== 'dovo' &&
        (nativeThreadKey(owner.id, agent) === nativeAgentKey ||
          nativeFailureKey(owner.id, agent) === nativeAgentKey),
    )
    if (!owner || !agent) return
    openedNativeRoute.current = route
    setNativeThread({
      parentKey: taskCollectionKey(activeRuntimeId, owner.id),
      taskId: owner.id,
      agent,
    })
  }, [activeRuntimeId, entityId, nativeAgentKey, navigationKey, workspace.tasks])
  useEffect(() => {
    if (!nativeAgentKey) setNativeThread(undefined)
  }, [entityId, navigationKey, nativeAgentKey])
  const [fileReveal, setFileReveal] = useState<{
    threadKey: string
    path: string
    line: number
    checkoutId?: string
    requestId: string
  }>()
  const surface = threadSurfaces[threadKey] ?? 'chat'
  const [browserPlacements, setBrowserPlacements] = useState<Record<string, PreviewPlacement>>({})
  const browserPlacement = browserPlacements[threadKey] ?? 'inline'
  const browserDetached = surface === 'browser' && browserPlacement !== 'inline'
  const toolsExpanded = surface !== 'chat' && surface !== 'terminal'
  const fileViewer = surface === 'files' || surface === 'changes'
  const repository = workspace.repositories.find((item) => item.id === task?.repositoryId)
  const refreshChanges = useCallback(async () => {
    if (!task || task.replica || repository?.kind || editingFile.current) return
    await store.request(
      '/api/scm/changes',
      { repositoryId: task.repositoryId, taskId: task.id, includeFiles: false },
      responses.changesRefresh,
    )
  }, [
    task?.id,
    task?.repositoryId,
    repository?.kind,
    store.request,
    store.connection?.address,
    store.connection?.token,
    store.connection?.runtimeId,
  ])
  const { error: changesError, retry: retryChanges } = useLiveRefreshState(
    connected &&
      !!task &&
      !task.replica &&
      !task.archived &&
      !task.archivedAt &&
      !repository?.kind &&
      (task.execution !== 'worktree' || !!task.checkoutBranch || !!task.existingWorktreePath),
    refreshChanges,
  )
  const lastToolSurface = useRef<TaskSurface>('files')
  const setSurface = useCommittedCallback((next: TaskSurface) => {
    setThreadSurfaces((current) => ({ ...current, [threadKey]: next }))
  })
  const [terminalVisited, setTerminalVisited] = useApplicationState(false)
  const [bottomTerminalTaskId, setBottomTerminalTaskId] = useApplicationState('')
  const bottomTerminalOpen = !compact && bottomTerminalTaskId === threadKey
  // The terminal a chat command just ran in, so the pane shows it.
  const [browserLink, setBrowserLink] = useState<{
    taskId: string
    id: string
    url: string
    remote?: boolean
    runtimeId?: string | null
  } | null>(null)
  const [reviewTarget, setReviewTarget] = useState<{
    threadKey: string
    finding?: CodeFinding
  } | null>(null)
  const [terminalFocus, setTerminalFocus] = useApplicationState('')
  const panes = useRef<Record<TaskSurface, HTMLDivElement | null>>({
    'bot-settings': null,
    'bot-mcp': null,
    'bot-skills': null,
    'bot-memory': null,
    'bot-routines': null,
    'pull-preview': null,
    'linked-pulls': null,
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
  const selectSurface = useCommittedCallback((next: TaskSurface, moveFocus = false) => {
    if (task?.replica && next !== 'chat') return
    for (const id of [
      'bot-settings',
      'bot-mcp',
      'bot-skills',
      'bot-memory',
      'bot-routines',
      'pull-preview',
      'linked-pulls',
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
  })
  const [pullPreviews, setPullPreviews] = useApplicationState<
    Record<
      string,
      {
        repositoryId: string
        number: number
        returnTo?: 'chat' | 'linked-pulls'
        tab?: 'overview' | 'changes' | 'checks'
        fragment?: string
      }
    >
  >({})
  // A PR handoff opens its task with that PR beside the full chat, once per navigation.
  const openedPullTarget = useRef('')
  useEffect(() => {
    if (!entityId || !pullTarget?.repositoryId || pullTarget.runtimeId !== activeRuntimeId) return
    const route = JSON.stringify([entityId, navigationKey, pullTarget])
    if (openedPullTarget.current === route || !workspace.tasks.some((item) => item.id === entityId))
      return
    openedPullTarget.current = route
    const key = taskCollectionKey(activeRuntimeId, entityId)
    setPullPreviews((current) => ({
      ...current,
      [key]: {
        repositoryId: pullTarget.repositoryId!,
        number: pullTarget.number,
        tab: pullTarget.tab,
        fragment: pullTarget.fragment,
      },
    }))
    setThreadSurfaces((current) => ({ ...current, [key]: 'pull-preview' }))
  }, [entityId, navigationKey, pullTarget, activeRuntimeId, workspace.tasks])
  const openArtifact = (reference: ArtifactReference) => {
    const key = taskCollectionKey(activeRuntimeId, reference.taskId)
    setArtifactSelection({ threadKey: key, id: reference.id, openId: randomUUID() })
    if (reference.taskId !== task?.id) {
      setSelectedId(reference.taskId)
      setSplitId(task?.id ?? '')
      setThreadSurfaces((current) => ({ ...current, [key]: 'artifacts' }))
    } else selectSurface('artifacts', compact)
  }
  const openPullPreview = (
    target: Task,
    url: string,
    returnTo: 'chat' | 'linked-pulls' = 'chat',
  ) => {
    const link = forgePullTarget(
      url,
      workspace.repositories.map((repository) => ({
        identity: pullRepositoryIdentity(repository),
      })),
    )
    const preview = threadPullPreview(url, target, workspace.repositories)
    if (!preview)
      return (
        host.openPullLink?.(url, {
          runtimeId: activeRuntimeId ?? undefined,
          repositoryId: target.repositoryId,
        }) ?? false
      )
    const key = taskCollectionKey(activeRuntimeId, target.id)
    setPullPreviews((current) => ({
      ...current,
      [key]: { ...preview, returnTo, tab: link?.tab, fragment: link?.fragment },
    }))
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
  const addCodeReference = useCommittedCallback((taskId: string, text: string) => {
    setComposerInsert({
      threadKey: taskCollectionKey(activeRuntimeId, taskId),
      id: randomUUID(),
      text,
    })
    selectSurface('chat', true)
  })
  const addTerminalSelection = useCommittedCallback(
    (owner: string, taskId: string, text: string) => {
      if (!terminalSelectionIsCurrent(owner, taskId, threadKey, task?.id)) return
      addCodeReference(taskId, text)
    },
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
  const showTerminal = useCommittedCallback((terminalId: string) => {
    setTerminalFocus(terminalId)
    selectSurface('terminal', true)
  })
  const toggleTerminal = useCommittedCallback(() => {
    if (surface !== 'terminal') setTerminalFocus('')
    if (!compact && bottomTerminalOpen) setBottomTerminalTaskId('')
    else selectSurface(surface === 'terminal' ? 'chat' : 'terminal', true)
  })
  const toggleBottomTerminal = useCommittedCallback(() => {
    if (!task) return
    if (bottomTerminalOpen) setBottomTerminalTaskId('')
    else {
      setBottomTerminalTaskId(threadKey)
      selectSurface('chat', true)
    }
  })
  useEffect(() => {
    if (!compact && surface === 'terminal') selectSurface('terminal')
  }, [compact, surface, selectSurface])
  useEffect(() => {
    if (surface === 'changes' && !hasDiff && reviewTarget?.threadKey !== threadKey)
      selectSurface('files')
  }, [surface, hasDiff, selectSurface, reviewTarget?.threadKey, threadKey])
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
  const startTask = useCommittedCallback(
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
        setError('This device is offline. Reconnect it before starting a thread.')
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
      title: template?.name ?? 'New thread',
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
    if (compact) setSidebar(false)
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
      if (compact) setSidebar(false)
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
    setSidebar(!compact)
    setDeselected(true)
    setSelectedId('')
    host.navigate({
      viewId: 'tasks',
    })
  }
  const [draftVersion, setDraftVersion] = useApplicationState(0)
  const newThread = useCommittedCallback(() => {
    if (busy) return
    setDeselected(true)
    setSelectedId('')
    setSplitId('')
    setListOpen(false)
    setChoosingProject(false)
    setError('')
    setSidebar(!compact)
    setDraftVersion((version) => version + 1)
    host.navigate({ viewId: 'tasks' })
  })
  useEffect(
    () =>
      registerCommand({
        id: 'tasks.new',
        title: 'New thread',
        aliases: ['new thread', 'new chat', 'start conversation'],
        run: newThread,
      }),
    [registerCommand, newThread],
  )
  useEffect(() => {
    const disposers = [
      registerCommand({
        id: 'tasks.switch',
        title: 'Go to thread…',
        aliases: ['go to thread', 'find thread', 'find thread', 'switch thread', 'switch thread'],
        run: () => setSearching('tasks'),
      }),
      registerCommand({
        id: 'tasks.search',
        title: 'Search conversations…',
        aliases: ['search messages', 'find message', 'search thread', 'find in conversation'],
        run: () => setSearching('messages'),
      }),
    ]
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, [registerCommand])
  useEffect(
    () =>
      registerCommand({
        id: 'tasks.terminal',
        title: 'Toggle terminal',
        aliases: ['shell', 'console', 'command line'],
        run: toggleTerminal,
      }),
    [registerCommand, toggleTerminal],
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
    closeSplit: () => {},
  })
  const { request } = store
  const [stopError, setStopError] = useApplicationState('')
  const [transcriptNotice, setTranscriptNotice] = useApplicationState('')
  const openThread = useCommittedCallback((id: string, beside: string = '') => {
    setSelectedId(id)
    setDeselected(false)
    setSplitId(compact ? '' : beside)
    host.navigate({ viewId: 'tasks', entityId: id })
  })
  // Side chats open beside their parent where there is room, and as a normal thread otherwise.
  // The current tool, such as a PR preview, stays open next to both threads.
  const openSideThread = useCommittedCallback((key: string, childId?: string) => {
    if (!childId) {
      setThreadSurfaces((current) => ({ ...current, [key]: 'side-chats' }))
      if (key === threadKey) selectSurface('side-chats', true)
      return
    }
    // Creating a side chat can finish after the user has switched threads or runtimes.
    if (key !== threadKey) return
    if (compact) openThread(childId)
    else setSplitId(childId)
  })
  const [handoffNotice, setHandoffNotice] = useState<{ threadKey: string; text: string } | null>(
    null,
  )
  useEffect(() => {
    if (!handoffNotice) return
    const timer = setTimeout(() => setHandoffNotice(null), 8000)
    return () => clearTimeout(timer)
  }, [handoffNotice])
  const deliverHandoff = useCommittedCallback((handoff: SideThreadHandoff, title: string) => {
    const key = taskCollectionKey(activeRuntimeId, handoff.id)
    // A repeated receipt, or text the saved draft already holds, is not added again.
    const repeat =
      handoffApplied(key, handoff.receiptId) ||
      !!workspace.tasks.find((item) => item.id === handoff.id)?.draft?.includes(handoff.text)
    setHandoffNotice({
      threadKey: key,
      text: repeat
        ? `Results from “${title}” were already brought back to this draft.`
        : `Added results from “${title}” to this draft. Review them before sending.`,
    })
    if (handoffApplied(key, handoff.receiptId)) return
    setHandoffs((current) => [
      ...current.filter((item) => item.threadKey !== key || item.id !== handoff.receiptId),
      { threadKey: key, id: handoff.receiptId, text: handoff.text, once: true },
    ])
  })
  const sideAttention = useSideThreadAttention()
  // Approvals and questions use the side chat's normal controls, opened where it is shown.
  const attendSideThread = useCommittedCallback((childId: string, kind: SideThreadAttention) => {
    if (compact) openThread(childId)
    else setSplitId(childId)
    focusSideThreadAttention(childId, kind)
  })
  const sideThreadDiscarded = useCommittedCallback((childId: string) => {
    const parentId = sideThreadOf(
      workspace.tasks.find((item) => item.id === childId) ?? { id: '' },
    )?.parentTaskId
    if (parentId && sideChatBeside(besideScope(parentId), runtimeIdentity) === childId)
      forgetSideChatBeside(besideScope(parentId))
    if (splitId === childId) setSplitId('')
    if (task?.id === childId && parentId) openThread(parentId)
  })
  const returnToParent = useCommittedCallback((parentId: string, childId: string) => {
    setThreadSurfaces((current) => ({
      ...current,
      [taskCollectionKey(activeRuntimeId, parentId)]: 'chat',
    }))
    openThread(parentId, childId)
  })
  const [searching, setSearching] = useApplicationState<TaskSearchMode | null>(null)
  // After opening a search result, scroll its message into view once the thread renders.
  const [revealMessage, setRevealMessage] = useApplicationState('')
  useEffect(() => {
    const reveal = (event: Event) => {
      if (!(event instanceof CustomEvent)) return
      const detail: unknown = event.detail
      if (
        !detail ||
        typeof detail !== 'object' ||
        !('scope' in detail) ||
        !('taskId' in detail) ||
        !('messageId' in detail)
      )
        return
      if (
        detail.scope !== botScope(snapshot?.runtimeId ?? activeRuntimeId, store.connection) ||
        detail.taskId !== task?.id ||
        typeof detail.messageId !== 'string'
      )
        return
      setRevealMessage(detail.messageId)
    }
    window.addEventListener('dovo:bot-memory-source', reveal)
    return () => window.removeEventListener('dovo:bot-memory-source', reveal)
  }, [task?.id, snapshot?.runtimeId, activeRuntimeId, store.connection, setRevealMessage])
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
    closeSplit: () => closeSplit(),
    stop: () => {
      if (task?.replica || task?.status !== 'running' || !connected) return
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
        return run(() => current.closeSplit())
      // ⌘; (Ctrl+; elsewhere) asks a side question about the open task.
      if (mod && !e.altKey && !e.shiftKey && e.key === ';' && current.task)
        return run(() => {
          const focusedThread =
            e.target instanceof Element
              ? e.target.closest<HTMLElement>('[data-task-conversation]')?.dataset.taskConversation
              : undefined
          const event = new CustomEvent('dovo:ask-side-question', {
            detail: focusedThread ?? current.task!.id,
            cancelable: true,
          })
          if (window.dispatchEvent(event)) current.selectSurface('side-chats', true)
        })
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
  const renderThread = (
    currentTask: Task,
    workspaceControls?: WorkspaceControls,
    temporary = false,
    onSelectRemote?: SelectRemoteProject,
    onStartBackground?: (task: Task) => void,
  ) => {
    const task = storedTask?.id === currentTask.id ? storedTask : currentTask
    if (task.replica) return <ReplicatedThread key={`${activeRuntimeId}:${task.id}`} task={task} />
    const native =
      nativeThread?.parentKey === taskCollectionKey(activeRuntimeId, task.id)
        ? nativeThread
        : undefined
    const nativeAgent =
      native &&
      (workspace.tasks
        .find((item) => item.id === native.taskId)
        ?.subagents?.find(
          (agent) =>
            agent.id === native.agent.id &&
            agent.provider === native.agent.provider &&
            agent.sessionId === native.agent.sessionId,
        ) ??
        native.agent)
    const projectPanelOpen = !task.bot && preferences.projectPanelOpen
    const pendingInsert =
      (composerInsert?.threadKey === threadKey ? composerInsert : null) ??
      handoffs.find((item) => item.threadKey === threadKey) ??
      null
    const setProjectPanelOpen = (open: boolean) => {
      if (open && (compact || (fileViewer && viewerExpanded))) {
        setViewerExpanded(false)
        selectSurface('chat')
      }
      updateAppPreferences({ projectPanelOpen: open })
    }
    return (
      <BackgroundRefreshProvider
        key={JSON.stringify([
          activeRuntimeId,
          store.connection?.address,
          store.connection?.token,
          store.connection?.runtimeId,
          task.id,
        ])}
      >
        <TaskProjectPanelRoot
          key={taskCollectionKey(activeRuntimeId, task.id)}
          open={
            !temporary &&
            projectPanelOpen &&
            !native &&
            !(fileViewer && viewerExpanded) &&
            (!compact || surface === 'chat')
          }
          onOpenChange={setProjectPanelOpen}
        >
          {native && nativeAgent && (
            <NativeAgentThread
              key={`${native.parentKey}:${native.taskId}:${nativeAgent.provider}:${nativeAgent.sessionId}:${nativeAgent.id}`}
              taskId={native.taskId}
              agent={nativeAgent}
              parentTitle={task.title}
              projectName={
                workspace.repositories.find((repo) => repo.id === task.repositoryId)?.name
              }
              windowRightEdge={!splitTask}
              onClose={() => setNativeThread(undefined)}
            />
          )}
          {native ? null : temporary ? (
            <HeaderContent>
              <header
                className="studio-task-thread-header"
                data-window-edge
                data-window-right-edge={!splitTask || undefined}
              >
                New thread
              </header>
            </HeaderContent>
          ) : (
            <TaskHeader
              parentThread={task.id === entityId ? threadParent : undefined}
              windowRightEdge={!splitTask}
              onPullLink={(url) => openPullPreview(task, url)}
              task={task}
              projectPanelOpen={projectPanelOpen}
              onProjectPanel={() => setProjectPanelOpen(!projectPanelOpen)}
              onCreate={() =>
                void startTask(taskCollectionKey(activeRuntimeId, task.repositoryId), true)
              }
              onDeselect={deselectTask}
              onProjectDeleted={() => setProjectId('scratch')}
              surface={surface}
              onSurface={(next) => {
                if (next === 'terminal') setTerminalFocus('')
                selectSurface(next)
              }}
              compact={compact}
              sidebarVisible={sidebar}
              hasDiff={hasDiff}
            />
          )}
          <div
            className={cn(
              'relative flex min-h-0 min-w-0 flex-1 overflow-hidden',
              native && 'hidden',
            )}
          >
            <div
              data-project-panel-frame
              data-info-open={projectPanelOpen || undefined}
              ref={(element) => {
                panes.current.chat = element
              }}
              tabIndex={-1}
              className={cn(
                'relative flex min-h-0 min-w-0 flex-1 flex-col',
                ((fileViewer && viewerExpanded) ||
                  (surface !== 'chat' && compact && !browserDetached)) &&
                  'hidden',
              )}
            >
              <ThreadInfoPanel title={task.title}>
                {!temporary && projectPanelOpen && (
                  <TaskProjectPanel
                    active={
                      !native &&
                      !listOpen &&
                      !(fileViewer && viewerExpanded) &&
                      (!compact || surface === 'chat')
                    }
                    key={taskCollectionKey(activeRuntimeId, task.id)}
                    task={task}
                    onPullLink={(url) => openPullPreview(task, url)}
                    onTerminal={(terminalId) => {
                      setProjectPanelOpen(false)
                      showTerminal(terminalId)
                    }}
                    onBrowser={(url) => {
                      setProjectPanelOpen(false)
                      setBrowserLink({
                        taskId: task.id,
                        id: randomUUID(),
                        url,
                        remote: true,
                        runtimeId: activeRuntimeId,
                      })
                      selectSurface('browser')
                    }}
                    onSurface={(next) => {
                      setProjectPanelOpen(false)
                      selectSurface(next)
                    }}
                  />
                )}
              </ThreadInfoPanel>
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
              <BackgroundRefreshIssue label="Changes" error={changesError} retry={retryChanges} />
              <BackgroundRefreshNotice />
              {stopError && (
                <p role="alert" className="px-5 pt-2 text-xs text-destructive">
                  Could not stop the agent. {stopError}
                </p>
              )}
              {!temporary && sideThreadOf(task) && (
                <SideThreadBar
                  task={task}
                  link={sideThreadOf(task)!}
                  onReturn={(parentId) => returnToParent(parentId, task.id)}
                  onBroughtBack={(handoff) => {
                    deliverHandoff(handoff, task.title)
                    returnToParent(handoff.id, task.id)
                  }}
                  onDiscarded={sideThreadDiscarded}
                />
              )}
              {!temporary && !sideThreadOf(task) && (
                <SideThreadAttentionBanner task={task} onAttend={attendSideThread} />
              )}
              {handoffNotice?.threadKey === threadKey && (
                <div
                  role="status"
                  className="flex shrink-0 items-center gap-2 border-b px-4 py-1.5 text-xs text-muted-foreground"
                >
                  <span className="min-w-0 flex-1">{handoffNotice.text}</span>
                  <IconButton
                    label="Dismiss"
                    className="size-6"
                    onClick={() => setHandoffNotice(null)}
                  >
                    <X className="size-3.5" />
                  </IconButton>
                </div>
              )}
              {task.bot && !temporary && (
                <BotWorkSummary
                  task={task}
                  onRoutines={() => selectSurface('bot-routines', true)}
                  onWorkers={() => selectSurface('agents', true)}
                />
              )}
              <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
                <ResizablePanel
                  id="thread"
                  defaultSize={bottomTerminalOpen ? '65%' : '100%'}
                  minSize="30%"
                >
                  <div className="relative h-full min-h-0" data-conversation-boundary>
                    <TaskConversation
                      historyLoaded={usingStartupDraft || historyLoaded}
                      historyError={historyError}
                      onRetryHistory={retryHistory}
                      historyRetrying={historyRetrying}
                      historyRetryError={historyRetryError}
                      historyUnauthorized={historyUnauthorized}
                      key={taskCollectionKey(activeRuntimeId, task.id)}
                      task={task}
                      temporary={temporary}
                      workspaceControls={workspaceControls}
                      onSelectRemote={onSelectRemote}
                      onStartBackground={onStartBackground}
                      revealMessage={revealMessage}
                      onRevealHandled={revealHandled}
                      visible={!native && !listOpen && (!compact || surface === 'chat')}
                      onReview={() => selectSurface(hasDiff ? 'changes' : 'files')}
                      onCodeReview={(finding) => {
                        setReviewTarget({ threadKey, finding })
                        selectSurface('changes')
                      }}
                      onTerminal={showTerminal}
                      onPullLink={(url) => openPullPreview(task, url)}
                      onArtifact={openArtifact}
                      onBrowser={(url) => {
                        setBrowserLink({ taskId: task.id, id: randomUUID(), url })
                        selectSurface('browser')
                      }}
                      onAside={
                        sideThreadOf(task)
                          ? undefined
                          : (childId) => openSideThread(threadKey, childId)
                      }
                      composerInsert={pendingInsert}
                      onComposerInsertApplied={() => {
                        if (pendingInsert && 'once' in pendingInsert) {
                          recordHandoff(threadKey, pendingInsert.id)
                          setHandoffs((current) => current.filter((item) => item !== pendingInsert))
                        } else
                          setComposerInsert((current) =>
                            current?.id === composerInsert?.id ? null : current,
                          )
                      }}
                    />
                  </div>
                </ResizablePanel>
                {bottomTerminalOpen && surface !== 'terminal' && (
                  <>
                    <ResizableHandle className="bg-transparent hover:bg-border focus-visible:bg-border data-[separator=active]:bg-border" />
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
                          onOpenFile={(file) => {
                            setFileReveal({ ...file, threadKey, requestId: randomUUID() })
                            selectSurface('files', true)
                          }}
                          onAddSelection={(taskId, text) =>
                            addTerminalSelection(threadKey, taskId, text)
                          }
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
                surface === 'artifacts'
                  ? 0.6
                  : fileViewer
                    ? surface === 'files'
                      ? 0.4
                      : 0.5
                    : 0.48
              }
              maxWidth={960}
              resizable={
                !compact &&
                !browserDetached &&
                surface !== 'chat' &&
                !(fileViewer && viewerExpanded)
              }
              aria-label="Workspace tools"
              className={
                browserDetached
                  ? 'contents'
                  : cn(
                      'studio-page-surface min-h-0 min-w-0 flex-col bg-background',
                      surface === 'chat' ? 'hidden' : 'flex',
                      compact
                        ? 'flex-1'
                        : cn(
                            'studio-thread-tools-panel',
                            fileViewer && viewerExpanded ? 'flex-1' : 'shrink-0',
                          ),
                    )
              }
            >
              <div
                className={
                  browserDetached
                    ? 'contents'
                    : 'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[inherit]'
                }
              >
                {task.bot && (
                  <div
                    hidden={!surface.startsWith('bot-')}
                    className="min-h-0 flex-1 overflow-y-auto"
                    aria-label={`${surface === 'bot-mcp' ? 'MCP servers' : surface === 'bot-skills' ? 'Skills' : surface === 'bot-memory' ? 'Memory' : surface === 'bot-routines' ? 'Routines' : 'Settings'} panel`}
                    ref={(node) => {
                      panes.current['bot-settings'] = node
                      panes.current['bot-mcp'] = node
                      panes.current['bot-skills'] = node
                      panes.current['bot-memory'] = node
                      panes.current['bot-routines'] = node
                    }}
                  >
                    <header className="studio-thread-tools-header flex items-center gap-2 border-b px-3 py-2 text-xs">
                      <h2 className="flex-1 font-medium">
                        {surface === 'bot-mcp'
                          ? 'MCP servers'
                          : surface === 'bot-skills'
                            ? 'Skills'
                            : surface === 'bot-memory'
                              ? 'Memory'
                              : surface === 'bot-routines'
                                ? 'Routines'
                                : 'Settings'}
                      </h2>
                      <IconButton
                        label="Close Bot panel"
                        onClick={() => selectSurface('chat', true)}
                      >
                        <X size={14} />
                      </IconButton>
                    </header>
                    <BotSettings
                      key={`${botScope(snapshot?.runtimeId ?? activeRuntimeId, store.connection)}:${task.id}`}
                      task={task}
                      onDeleted={() => {
                        if (
                          (!onBotDeleted && !mounted.current) ||
                          deletionSelection.current.id !== task.id ||
                          deletionSelection.current.runtimeId !== activeRuntimeId
                        )
                          return
                        if (onBotDeleted) onBotDeleted(task.id)
                        else deselectTask()
                      }}
                      section={
                        surface === 'bot-mcp'
                          ? 'mcp'
                          : surface === 'bot-skills'
                            ? 'skill'
                            : surface === 'bot-memory'
                              ? 'memory'
                              : surface === 'bot-routines'
                                ? 'routines'
                                : 'settings'
                      }
                    />
                  </div>
                )}
                {surface === 'changes' && (
                  <header className="studio-thread-tools-header flex shrink-0 items-center gap-2 border-b px-3 py-2 text-xs">
                    <FileDiff size={16} className="text-muted-foreground" aria-hidden="true" />
                    <h2 className="min-w-0 flex-1 truncate font-medium">Changes</h2>
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
                  </header>
                )}
                {!compact && (surface === 'projects' || surface === 'agents') && (
                  <header className="studio-thread-tools-header flex shrink-0 items-center gap-2 border-b px-3 py-2 text-xs">
                    {surface === 'projects' ? (
                      <FolderSymlink
                        size={16}
                        className="text-muted-foreground"
                        aria-hidden="true"
                      />
                    ) : (
                      <Bot size={16} className="text-muted-foreground" aria-hidden="true" />
                    )}
                    <h2 className="min-w-0 flex-1 truncate font-medium">
                      {surface === 'projects' ? 'Linked projects' : 'Agents'}
                    </h2>
                    <IconButton
                      label={surface === 'projects' ? 'Close linked projects' : 'Close agents'}
                      className="size-7"
                      onClick={() => selectSurface('chat', true)}
                    >
                      <X size={14} />
                    </IconButton>
                  </header>
                )}
                {surface === 'linked-pulls' && (
                  <div
                    ref={(element) => {
                      panes.current['linked-pulls'] = element
                    }}
                    tabIndex={-1}
                    className="flex min-h-0 flex-1 flex-col"
                  >
                    <TaskLinkedPullPanel
                      key={threadKey}
                      task={task}
                      onPullLink={(url) => openPullPreview(task, url, 'linked-pulls')}
                      onClose={() => selectSurface('chat', true)}
                    />
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
                      initialTab={pullPreviews[threadKey]?.tab}
                      initialFragment={pullPreviews[threadKey]?.fragment}
                      embedded
                      onBack={() =>
                        selectSurface(
                          pullPreviews[threadKey]?.returnTo === 'linked-pulls' &&
                            taskPullLinks(task).length
                            ? 'linked-pulls'
                            : 'chat',
                          true,
                        )
                      }
                      onChanged={() => {}}
                      linkedThread={{
                        task,
                        // The draft stays reviewable beside the PR; nothing is sent automatically.
                        onAsk: (text) => {
                          const preview = pullPreviews[threadKey]
                          setComposerInsert({
                            threadKey,
                            id: randomUUID(),
                            text,
                            // A newer ask about the same PR replaces its untouched earlier context.
                            ...(preview
                              ? {
                                  replaceKey: JSON.stringify([
                                    'pull',
                                    preview.repositoryId,
                                    preview.number,
                                  ]),
                                }
                              : {}),
                          })
                          if (compact) selectSurface('chat', true)
                        },
                      }}
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
                    <SideThreadsPanel
                      key={task.id}
                      task={task}
                      onClose={compact ? undefined : () => selectSurface('chat', true)}
                      openId={splitTask?.id}
                      onOpen={(childId) => openSideThread(threadKey, childId)}
                      onOpenThread={(childId) => openThread(childId, compact ? '' : task.id)}
                      onAttend={attendSideThread}
                      onDiscarded={sideThreadDiscarded}
                      onBroughtBack={(handoff, child) => {
                        deliverHandoff(handoff, child.title)
                        selectSurface('chat', true)
                      }}
                      readOnlyQuestions={
                        <SideQuestion
                          key={task.id}
                          task={task}
                          drafts={sideChatDrafts[threadKey] ?? {}}
                          setDrafts={(update) =>
                            setSideChatDrafts((current) => {
                              const previous = current[threadKey] ?? {}
                              const next = typeof update === 'function' ? update(previous) : update
                              return next === previous ? current : { ...current, [threadKey]: next }
                            })
                          }
                          onAddToComposer={(text) => addCodeReference(task.id, text)}
                        />
                      }
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
                        artifactSelection?.threadKey === threadKey
                          ? artifactSelection.id
                          : undefined
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
                    <TaskAgents
                      key={task.id}
                      task={task}
                      onOpenThread={(thread) => {
                        setNativeThread({
                          ...thread,
                          parentKey: taskCollectionKey(activeRuntimeId, task.id),
                        })
                      }}
                    />
                  </div>
                )}
                {(surface === 'browser' || surface === 'devices') && (
                  <div
                    ref={(element) => {
                      panes.current[surface] = element
                    }}
                    tabIndex={-1}
                    className={browserDetached ? 'contents' : 'min-h-0 min-w-0 flex-1'}
                  >
                    {surface === 'devices' ? (
                      <DevicesPane taskId={task.id} onClose={() => selectSurface('chat', true)} />
                    ) : (
                      <FloatingPreview
                        key={threadKey}
                        title="Browser"
                        placement={browserPlacement}
                        onPlacementChange={(placement) =>
                          setBrowserPlacements((current) => ({
                            ...current,
                            [threadKey]: placement,
                          }))
                        }
                        inlineClassName="h-full"
                        returnLabel="Dock preview"
                        onClose={() => selectSurface('chat', true)}
                      >
                        <BrowserPane
                          taskId={task.id}
                          openLink={
                            browserLink?.taskId === task.id &&
                            (browserLink.runtimeId === undefined ||
                              browserLink.runtimeId === activeRuntimeId)
                              ? browserLink
                              : null
                          }
                          onLinkOpened={() => setBrowserLink(null)}
                        />
                      </FloatingPreview>
                    )}
                  </div>
                )}
                <div
                  ref={(element) => {
                    panes.current.changes = element
                  }}
                  tabIndex={-1}
                  className={cn(
                    'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
                    surface !== 'changes' && 'hidden',
                  )}
                >
                  {surface === 'changes' && (
                    <ReviewPane
                      key={`${task.id}:${reviewTarget?.threadKey === threadKey ? (reviewTarget.finding?.id ?? 'report') : ''}`}
                      task={task}
                      initialFinding={
                        reviewTarget?.threadKey === threadKey ? reviewTarget.finding : undefined
                      }
                      initialTab={
                        reviewTarget?.threadKey === threadKey && !reviewTarget.finding
                          ? 'findings'
                          : 'diff'
                      }
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
                  className={cn(
                    'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
                    surface !== 'files' && 'hidden',
                  )}
                >
                  {surface === 'files' && (
                    <TaskFiles
                      key={task.id}
                      onClose={() => selectSurface('chat', true)}
                      onExpand={() => setViewerExpanded((value) => !value)}
                      expanded={viewerExpanded}
                      task={task}
                      reveal={fileReveal?.threadKey === threadKey ? fileReveal : undefined}
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
                      onOpenFile={(file) => {
                        setFileReveal({ ...file, threadKey, requestId: randomUUID() })
                        selectSurface('files', true)
                      }}
                      visible={surface === 'terminal'}
                      onAddSelection={(taskId, text) =>
                        addTerminalSelection(threadKey, taskId, text)
                      }
                      onClose={() => selectSurface('chat', true)}
                    />
                  )}
                </div>
              </div>
            </ResizableSidebar>
            {!compact && !temporary && (
              <TaskTools
                task={task}
                surface={surface}
                onSelect={(next) => selectSurface(next === surface ? 'chat' : next)}
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
                artifactsEnabled={!!snapshot?.artifactsEnabled}
              />
            )}
          </div>
        </TaskProjectPanelRoot>
      </BackgroundRefreshProvider>
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
          resizable={sidebar && !compact}
          className={cn('min-h-0', (!sidebar || compact) && 'hidden')}
        >
          <SidebarHeader enabled={!sidebar && !compact} />
          {sidebar && !compact && (
            <div className="h-full min-w-0">
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
                onSplit={(entry) => {
                  if (entry.source.runtimeId === activeRuntimeId) closeSplit(entry.task.id)
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
                key={draftVersion}
                onDraftChange={reportStartupDraft}
                onBackgroundStarted={() => {
                  setDeselected(true)
                  setSelectedId('')
                  host.navigate({ viewId: 'tasks' })
                }}
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
                  <header className="studio-task-thread-header text-xs" data-window-right-edge>
                    <ProjectIcon
                      repository={workspace.repositories.find(
                        (repo) => repo.id === splitTask.repositoryId,
                      )}
                      className="size-4"
                    />
                    <span className="min-w-0 flex-1 truncate font-medium" title={splitTask.title}>
                      {sideThreadOf(splitTask)?.parentTaskId === task?.id && (
                        <span className="mr-1.5 font-normal text-muted-foreground">
                          Side chat ·
                        </span>
                      )}
                      {splitTask.title}
                    </span>
                    {sideThreadOf(splitTask) &&
                      (() => {
                        const kind = sideThreadAttention(sideAttention, splitTask.id)
                        return kind && <SideThreadAttentionBadge kind={kind} />
                      })()}
                    {task && sideThreadOf(splitTask)?.parentTaskId === task.id && (
                      <>
                        <DiscardSideDraft child={splitTask} onDiscarded={sideThreadDiscarded} />
                        {!unusedSideDraft(splitTask) && (
                          <>
                            <ReviewSideThreadChangesButton task={splitTask} />
                            <BringBackButton
                              child={splitTask}
                              parent={task}
                              onDone={(handoff) => {
                                deliverHandoff(handoff, splitTask.title)
                                selectSurface('chat', true)
                              }}
                            />
                          </>
                        )}
                      </>
                    )}
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
                      label="Close side-by-side thread (⌘/Ctrl+\)"
                      className="size-6"
                      onClick={() => closeSplit()}
                    >
                      <X className="size-3.5" />
                    </IconButton>
                  </header>
                  {sideThreadOf(splitTask) && (
                    <SideThreadProvenance
                      link={sideThreadOf(splitTask)!}
                      className="shrink-0 border-b px-4 py-1.5"
                    />
                  )}
                  <div className="min-h-0 flex-1">
                    <TaskConversation
                      historyLoaded={splitHistoryLoaded}
                      historyError={splitHistoryError}
                      onRetryHistory={retrySplitHistory}
                      historyRetrying={splitHistoryRetrying}
                      historyRetryError={splitHistoryRetryError}
                      historyUnauthorized={splitHistoryUnauthorized}
                      onPullLink={(url) => openPullPreview(splitTask, url)}
                      onArtifact={openArtifact}
                      key={`split:${splitTask.id}`}
                      task={splitTask}
                      onAside={
                        sideThreadOf(splitTask)
                          ? undefined
                          : (childId) => {
                              const key = taskCollectionKey(activeRuntimeId, splitTask.id)
                              if (!childId)
                                setThreadSurfaces((current) => ({
                                  ...current,
                                  [key]: 'side-chats',
                                }))
                              if (shortcuts.current.selectedKey !== threadKey) return
                              // The asking thread moves to the main pane, its side chat beside it.
                              openThread(splitTask.id, childId ?? task?.id ?? '')
                            }
                      }
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
      <Dialog
        modal={false}
        open={compact && listOpen}
        onOpenChange={(open) => {
          setListOpen(open)
          if (compact) setSidebar(open)
        }}
      >
        <DialogContent
          className="left-auto right-2 flex h-[80dvh] max-w-[min(24rem,calc(100vw-68px))] translate-x-0 flex-col p-0"
          onInteractOutside={(event) => {
            const target = event.detail.originalEvent.target
            if (target instanceof Element && target.closest('[aria-label="Main navigation"]'))
              event.preventDefault()
          }}
        >
          <DialogTitle className="px-4 pt-4">Threads</DialogTitle>
          <DialogDescription className="sr-only">Select or create a thread.</DialogDescription>
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
