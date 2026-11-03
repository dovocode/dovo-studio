import {
  Activity,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import {
  ChevronDown,
  Globe2,
  House,
  MessageSquare,
  Terminal,
  X,
  Search,
  SlidersHorizontal,
} from 'lucide-react'
import {
  browserTabCategory,
  isPrivateBrowserProfile,
  isSnoozed,
  randomUUID,
  runtimeComputerName,
  STUDIO_BROWSER_SCOPE,
  STUDIO_TERMINAL_SCOPE,
  taskFamilyInputIds,
  taskIsWorking,
  wakeBrowserTab,
  type RuntimeSnapshot,
  type TerminalInfo,
  type UpdateTerminal,
} from '@dovo/protocol'
import {
  responses,
  StudioHostProvider,
  useAppPreferences,
  useStudioHost,
  useWorkspace,
  WorkspaceScope,
  type StudioHostApi,
  type StudioNavigation,
  type Task,
} from '@dovo/studio-core'
import {
  Button,
  ChoicePicker,
  IconButton,
  Input,
  SidebarHeader,
  useNavigationSidebar,
  cn,
} from '@dovo/studio-ui'
import TasksView from '../view'
import {
  BrowserPane,
  restoredSharedBrowserTabs,
  sharedBrowserWindowId,
  type BrowserLifecycleRequest,
} from '../browser/browser-pane'
import type { BrowserTab } from '../browser/shared-browser-tabs'
import { taskActionClient, useTaskActionStore } from '../list/task-row-actions'
import { retainTaskOwner, type TaskOwner } from '../list/task-collection'
import { ResizableSidebar } from '../detail/resizable-sidebar'
import {
  NewWorkspaceTerminalDialog,
  WorkspaceTerminalSurface,
  terminalContext,
  useWorkspaceComputers,
} from '../terminal/terminal-workspace'
import { terminalStatus, type TerminalStatusTone } from '../terminal/terminal-status'
import { WorkspaceInput } from './workspace-input'
import { WorkspaceResourceMenu } from './workspace-resource-menu'
import { workspaceIdentity } from './workspace-identity'
import {
  WorkspacePageRow,
  WorkspaceTerminalRow,
  WorkspaceThreadRow,
  type WorkspaceRowStatus,
} from './workspace-rows'
import {
  closeWorkspaceTab,
  openWorkspaceTab,
  reconcileWorkspaceTabs,
  showWorkspaceOverview,
  readWorkspaceTabs,
  saveWorkspaceTabs,
  workspaceTabKey,
  type WorkspaceTab,
} from './workspace-tabs'

type ResourceStatus = WorkspaceRowStatus | 'needs-input' | 'working' | 'waiting'
/** One sidebar row; every kind exposes the same Pin / Settle / Snooze workflow. */
type WorkspaceResource = {
  tab: WorkspaceTab
  title: string
  detail: string
  offline: boolean
  pinned: boolean
  status: ResourceStatus
  snoozedUntil?: string
  settleDisabled?: boolean
  pin: () => Promise<void> | void
  settle: () => Promise<void> | void
  snooze: (until: string | null) => Promise<void> | void
  /** Presentation facts for the kind's own row design. */
  row:
    | { kind: 'thread'; task: Task; owner: TaskOwner; needsInput: boolean; terminals: number }
    | { kind: 'browser'; page: BrowserTab; computer: string; runtimeIcon?: RuntimeIcon }
    | {
        kind: 'terminal'
        project: string
        checkout: string
        /** True only for a known branch; folders and unknown checkouts are not branches. */
        checkoutIsBranch: boolean
        state: string
        stateTone: TerminalStatusTone
        stateDetail?: string
        computer: string
        runtimeIcon?: RuntimeIcon
      }
}
type RuntimeIcon = RuntimeSnapshot['runtimeIcon']
const sections = [
  { id: 'pinned', name: 'Pinned' },
  { id: 'needs-input', name: 'Needs input' },
  { id: 'active', name: 'Active' },
  { id: 'working', name: 'Working' },
  { id: 'waiting', name: 'Waiting' },
  { id: 'snoozed', name: 'Snoozed' },
  { id: 'settled', name: 'Settled' },
] as const
type SectionId = (typeof sections)[number]['id']
const sectionOf = (resource: WorkspaceResource): SectionId =>
  resource.pinned ? 'pinned' : resource.status
const isoTime = (time: number) => new Date(time).toISOString()

export default function UnifiedWorkspace() {
  const enabled = useAppPreferences().unifiedWorkspaceEnabled
  const host = useStudioHost()
  if (!enabled)
    return (
      <div className="p-6 text-sm">
        <p>Enable Unified workspace in Settings → General → Experimental.</p>
        <Button className="mt-3" onClick={() => host.navigate({ viewId: 'general' })}>
          Open settings
        </Button>
      </div>
    )
  return <WorkspaceContent />
}

function WorkspaceContent() {
  const store = useWorkspace()
  const computers = useWorkspaceComputers()
  const host = useStudioHost()
  const sidebar = useNavigationSidebar()
  const [restored] = useState(readWorkspaceTabs)
  const [state, setState] = useState(restored.state)
  const taskStore = useTaskActionStore()
  const browserWindowId = sharedBrowserWindowId(host)
  // BrowserPane reads and writes this list while its page surface is hidden, so the sidebar and pane
  // share one authoritative copy; undefined until a pane hydrates a fresh browser workspace.
  const [browserTabs, setBrowserTabs] = useState<BrowserTab[] | undefined>(() =>
    restoredSharedBrowserTabs(browserWindowId),
  )
  const [browserLifecycleRequest, setBrowserLifecycleRequest] = useState<BrowserLifecycleRequest>()
  const setControlledBrowserTabs = useCallback<Dispatch<SetStateAction<BrowserTab[]>>>(
    (action) =>
      setBrowserTabs((previous) =>
        typeof action === 'function' ? action(previous ?? []) : action,
      ),
    [],
  )
  const pages = useMemo(() => (browserTabs ?? []).filter((tab) => !tab.previewOf), [browserTabs])
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(timer)
  }, [])
  const [pendingActions, setPendingActions] = useState<ReadonlySet<string>>(() => new Set())
  const pendingActionsRef = useRef(new Set<string>())
  const taskOwners = useRef(new Map<string, TaskOwner>())
  const [openSections, setOpenSections] = useState<Record<SectionId, boolean>>({
    pinned: true,
    'needs-input': true,
    active: true,
    working: false,
    waiting: false,
    snoozed: false,
    settled: false,
  })
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | WorkspaceTab['kind']>('all')
  const [computer, setComputer] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [creatingTerminal, setCreatingTerminal] = useState(false)
  const [error, setError] = useState(restored.error ?? '')
  const [lifecycleError, setLifecycleError] = useState('')
  const [switching, setSwitching] = useState(false)
  // A failed computer switch keeps its tab and offers a retry instead of a blank panel.
  const [switchFailure, setSwitchFailure] = useState<{ runtimeId: string; message: string }>()
  const [switchAttempt, setSwitchAttempt] = useState(0)
  const [browserRequest, setBrowserRequest] = useState('')
  const pendingBrowserAction = useRef(false)
  const requestedBrowserTab = useRef<string | undefined>(undefined)
  const [browserLink, setBrowserLink] = useState<{ id: string; url: string } | null>(null)
  const threadNavigation = useRef(new Map<string, StudioNavigation>())
  const active = state.tabs.find((tab) => workspaceTabKey(tab) === state.active)
  const current = useRef(state)
  current.current = state
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  // Older saved tabs may point at thread terminals. Drop the tab once its computer's snapshot
  // confirms the shell is thread-scoped; the shell itself keeps running.
  const threadTerminalKeys = state.tabs
    .filter(
      (tab) =>
        tab.kind === 'terminal' &&
        computers
          .find((entry) => entry.profile.id === tab.runtimeId)
          ?.snapshot?.terminals.some(
            (session) => session.id === tab.id && session.taskId !== STUDIO_TERMINAL_SCOPE,
          ),
    )
    .map(workspaceTabKey)
  useEffect(() => {
    if (!threadTerminalKeys.length) return
    const ineligible = new Set(threadTerminalKeys)
    setState((previous) =>
      reconcileWorkspaceTabs(previous, (tab) =>
        ineligible.has(workspaceTabKey(tab)) ? 'missing' : 'unknown',
      ),
    )
  }, [threadTerminalKeys.join('\n')])
  useEffect(() => {
    try {
      saveWorkspaceTabs(state)
    } catch {
      setError('Could not save workspace tabs. They remain available in this session.')
    }
  }, [state])
  // Threads retain the existing active-computer mutation path; terminals and pages can use
  // explicit remote ownership without changing the user's active computer.
  // Paired computers can load after a restored tab; re-run once its owner appears.
  const activeOwnerPresent =
    active?.kind === 'thread' && computers.some((entry) => entry.profile.id === active.runtimeId)
  useEffect(() => {
    if (active?.kind !== 'thread' || active.runtimeId === store.activeRuntimeId) {
      setSwitching(false)
      setSwitchFailure(undefined)
      return
    }
    if (!activeOwnerPresent) {
      setSwitching(false)
      return
    }
    let alive = true
    const runtimeId = active.runtimeId
    setSwitching(true)
    setSwitchFailure(undefined)
    void store
      .switchRuntime(runtimeId)
      .catch((cause: unknown) => {
        if (alive)
          setSwitchFailure({
            runtimeId,
            message: cause instanceof Error ? cause.message : String(cause),
          })
      })
      .finally(() => {
        if (alive) setSwitching(false)
      })
    return () => {
      alive = false
    }
  }, [
    active?.kind,
    active?.runtimeId,
    activeOwnerPresent,
    store.activeRuntimeId,
    store.switchRuntime,
    switchAttempt,
  ])
  const open = useCallback((tab: WorkspaceTab) => {
    if (tab.kind === 'browser')
      setBrowserTabs((previous) =>
        previous?.map((page) => (page.id === tab.id ? wakeBrowserTab(page) : page)),
      )
    setState((previous) => openWorkspaceTab(previous, tab))
  }, [])
  const openBrowser = useCallback(
    (id: string) => open({ kind: 'browser', runtimeId: '', id }),
    [open],
  )
  const newBrowser = useCallback(() => {
    pendingBrowserAction.current = true
    setBrowserRequest(randomUUID())
    openBrowser('new')
  }, [openBrowser])
  const openBrowserLink = useCallback(
    async (url: string) => {
      pendingBrowserAction.current = true
      setBrowserLink({ id: randomUUID(), url })
      openBrowser('new')
    },
    [openBrowser],
  )
  const api = useMemo<StudioHostApi>(
    () => ({
      ...host,
      taskNavigationGuard: () => {
        const key = current.current.active
        return () => mounted.current && current.current.active === key
      },
      navigate: (target: StudioNavigation, options?: { replace?: boolean }) => {
        if (target.viewId === 'tasks') {
          // Navigation comes from the visible thread; keep its computer even mid-switch.
          const origin = current.current.tabs.find(
            (tab) => workspaceTabKey(tab) === current.current.active,
          )
          const tab: WorkspaceTab = {
            kind: 'thread',
            runtimeId:
              origin?.kind === 'thread' && origin.runtimeId
                ? origin.runtimeId
                : (store.activeRuntimeId ?? ''),
            id: target.entityId ?? '',
          }
          threadNavigation.current.set(workspaceTabKey(tab), target)
          setState((previous) => {
            const selected = previous.tabs.find((tab) => workspaceTabKey(tab) === previous.active)
            const base =
              selected?.kind === 'thread' && !selected.id
                ? closeWorkspaceTab(previous, previous.active)
                : previous
            return openWorkspaceTab(base, tab)
          })
        } else if (target.viewId === 'browser') {
          if (target.entityId) void openBrowserLink(target.entityId)
          else newBrowser()
        } else host.navigate(target, options)
      },
      openThread: (target: Parameters<NonNullable<typeof host.openThread>>[0]) => {
        const owner = computers.find(
          (entry) =>
            entry.profile.id === target.runtimeId ||
            (!!target.runtimeIdentity && entry.snapshot?.runtimeId === target.runtimeIdentity),
        )
        if (!owner) {
          host.openThread?.(target)
          return
        }
        const tab: WorkspaceTab = {
          kind: 'thread',
          runtimeId: owner.profile.id,
          id: target.threadId,
        }
        threadNavigation.current.set(workspaceTabKey(tab), {
          viewId: 'tasks',
          entityId: target.threadId,
          nativeAgentKey: target.nativeAgentKey,
          threadParent: target.parent,
        })
        open(tab)
      },
      openBrowserLink,
      getLinkActions: (url, options) =>
        (host.getLinkActions?.(url, options) ?? []).map((action) =>
          action.kind === 'browser' ? { ...action, run: () => openBrowserLink(url) } : action,
        ),
      openLink: (url: string) => {
        if (!host.openPullLink?.(url) && !host.openPipelineLink?.(url)) void openBrowserLink(url)
      },
    }),
    [host, store.activeRuntimeId, computers, open, openBrowserLink, newBrowser],
  )
  /** Serialize lifecycle changes per item; closing or hiding never ends a session. */
  const runLifecycle = (tab: WorkspaceTab, action: () => Promise<void> | void) => {
    const key = workspaceTabKey(tab)
    if (pendingActionsRef.current.has(key)) return
    pendingActionsRef.current.add(key)
    setPendingActions(new Set(pendingActionsRef.current))
    setLifecycleError('')
    void (async () => {
      try {
        await action()
      } catch (cause: unknown) {
        if (mounted.current)
          setLifecycleError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        pendingActionsRef.current.delete(key)
        if (mounted.current) setPendingActions(new Set(pendingActionsRef.current))
      }
    })()
  }
  const resources: WorkspaceResource[] = [
    ...computers.flatMap((owner) => {
      const source = {
        runtimeId: owner.profile.id,
        name: runtimeComputerName(owner),
        online: owner.connected,
      }
      const snapshot = owner.snapshot
      // Every resource below comes from the snapshot; none exist before it arrives.
      if (!snapshot) return []
      // Reuse the previous owner object while its facts are unchanged, so thread rows stay memoized.
      const taskOwner = retainTaskOwner(taskOwners.current.get(owner.profile.id), {
        ...source,
        connection: owner.profile.connection,
        address: owner.profile.connection.address,
        workspace: snapshot.workspace,
        snapshot,
      })
      taskOwners.current.set(owner.profile.id, taskOwner)
      const input = taskFamilyInputIds(
        snapshot.workspace.tasks,
        [...(snapshot.questions ?? []), ...(snapshot.approvals ?? [])].map(
          (request) => request.taskId,
        ),
      )
      const shellCounts = new Map<string, number>()
      for (const session of snapshot.terminals)
        if (!session.exited)
          shellCounts.set(session.taskId, (shellCounts.get(session.taskId) ?? 0) + 1)
      // Settled threads are task.archived; only hard-archived threads (archivedAt) leave the list.
      const threads = snapshot.workspace.tasks
        .filter((task) => !task.example && !task.archivedAt)
        .map((task): WorkspaceResource => {
          const tab = { kind: 'thread' as const, runtimeId: owner.profile.id, id: task.id }
          // Capture the owner now so a later active-computer switch cannot redirect the write.
          const patch = (updates: Parameters<ReturnType<typeof taskActionClient>['patch']>[1]) =>
            taskActionClient(taskStore, source).patch(task, updates)
          const needsInput = input.has(task.id)
          return {
            tab,
            title: task.title || 'Untitled thread',
            detail: source.name,
            offline: !owner.connected,
            pinned: !!task.pinned,
            // Same precedence and activity helpers as TaskList; pinning wins in sectionOf.
            status: task.archived
              ? 'settled'
              : needsInput
                ? 'needs-input'
                : isSnoozed(task, now)
                  ? 'snoozed'
                  : taskIsWorking(task)
                    ? 'working'
                    : task.waitingForFeedback
                      ? 'waiting'
                      : 'active',
            snoozedUntil: task.snoozedUntil ?? undefined,
            settleDisabled: task.status === 'running',
            pin: () => patch({ pinned: !task.pinned }),
            settle: () => patch({ archived: !task.archived, snoozedUntil: null }),
            snooze: (until) => patch({ snoozedUntil: until }),
            row: {
              kind: 'thread',
              task,
              owner: taskOwner,
              needsInput,
              terminals: shellCounts.get(task.id) ?? 0,
            },
          }
        })
      // Thread terminals belong to their thread, as browser previews do; only standalone shells mix in.
      const terminals = snapshot.terminals
        .filter((session) => session.taskId === STUDIO_TERMINAL_SCOPE)
        .map((session: TerminalInfo): WorkspaceResource => {
          // Workflow metadata only; settling or snoozing never stops the shell.
          const update = async (updates: Omit<UpdateTerminal, 'id'>) => {
            if (!owner.connected) throw new Error(`${source.name} is offline.`)
            await store.readRuntime(
              owner.profile,
              '/api/terminals/update',
              { id: session.id, ...updates },
              responses.terminal,
              'POST',
            )
            // The write committed; a failed refresh must not report the change as failed.
            await store.refreshRuntime(owner.profile).catch(() => undefined)
          }
          const snoozed = !!session.snoozedUntil && Date.parse(session.snoozedUntil) > now
          const activity = terminalStatus(session, owner.connected)
          const repository = snapshot.workspace.repositories.find(
            (item) => item.id === session.repositoryId,
          )
          // A worktree with an unknown branch must not claim the project's main branch.
          const branch =
            session.checkoutBranch ??
            (session.execution === 'worktree' ? undefined : repository?.branch)
          return {
            tab: { kind: 'terminal' as const, runtimeId: owner.profile.id, id: session.id },
            title: session.title,
            detail: `${source.name} · ${terminalContext(session, snapshot.workspace)}`,
            offline: !owner.connected,
            pinned: !!session.pinned,
            status: session.settledAt ? 'settled' : snoozed ? 'snoozed' : activity.section,
            snoozedUntil: session.snoozedUntil,
            pin: () => update({ pinned: !session.pinned }),
            settle: () => update({ settled: !session.settledAt, snoozedUntil: null }),
            snooze: (until) => update({ snoozedUntil: until }),
            row: {
              kind: 'terminal',
              project: repository?.name ?? 'Home folder',
              checkout:
                branch ??
                (!repository
                  ? 'Home folder'
                  : (session.directory ??
                    (session.execution === 'worktree' ? 'Worktree' : 'Local checkout'))),
              checkoutIsBranch: branch !== undefined,
              state: activity.label,
              stateTone: activity.tone,
              stateDetail: activity.detail,
              computer: source.name,
              runtimeIcon: snapshot.runtimeIcon,
            },
          }
        })
      return [...threads, ...terminals]
    }),
    ...pages.map((page): WorkspaceResource => {
      const status = browserTabCategory(page, now)
      const pageOwner = computers.find((entry) => entry.profile.id === page.runtimeId)
      return {
        tab: { kind: 'browser' as const, runtimeId: '', id: page.id },
        title: page.title || page.url || 'New browser tab',
        detail: `${page.url || 'Browser'}${isPrivateBrowserProfile(page.profileId) ? ' · Private' : ''}`,
        offline: false,
        pinned: !!page.pinned,
        status,
        snoozedUntil:
          status === 'snoozed' && page.snoozedUntil !== undefined
            ? isoTime(page.snoozedUntil)
            : undefined,
        pin: () =>
          setBrowserLifecycleRequest({
            requestId: randomUUID(),
            tabId: page.id,
            action: page.pinned ? 'unpin' : 'pin',
          }),
        settle: () =>
          setBrowserLifecycleRequest({
            requestId: randomUUID(),
            tabId: page.id,
            action: status === 'settled' ? 'wake' : 'settle',
          }),
        snooze: (until) =>
          setBrowserLifecycleRequest(
            until === null
              ? { requestId: randomUUID(), tabId: page.id, action: 'wake' }
              : {
                  requestId: randomUUID(),
                  tabId: page.id,
                  action: 'snooze',
                  until: Date.parse(until),
                },
          ),
        row: {
          kind: 'browser',
          page,
          computer:
            page.kind === 'web'
              ? 'This computer'
              : pageOwner
                ? runtimeComputerName(pageOwner)
                : 'Unavailable computer',
          runtimeIcon: pageOwner?.snapshot?.runtimeIcon,
        },
      }
    }),
  ]
  const searching = !!search.trim()
  const matchingResources = resources
    .filter(
      (resource) =>
        (filter === 'all' || resource.tab.kind === filter) &&
        (!computer ||
          resource.tab.runtimeId === computer ||
          (resource.tab.kind === 'browser' &&
            pages.find((page) => page.id === resource.tab.id)?.runtimeId === computer)) &&
        `${resource.title} ${resource.detail}`.toLowerCase().includes(search.toLowerCase()),
    )
    .sort(
      (a, b) =>
        a.title.localeCompare(b.title, undefined, { numeric: true }) ||
        workspaceTabKey(a.tab).localeCompare(workspaceTabKey(b.tab)),
    )
  /** One row per item, in its kind's established design; shared by the sidebar and overview. */
  const renderResource = (resource: WorkspaceResource, pinnedPage = false) => {
    const key = workspaceTabKey(resource.tab)
    const status: WorkspaceRowStatus =
      resource.status === 'settled' || resource.status === 'snoozed' ? resource.status : 'active'
    const shell = {
      title: resource.title,
      selected: key === state.active,
      disabled: switching,
      status,
      onSelect: () => open(resource.tab),
      actions: (
        <WorkspaceResourceMenu
          title={resource.title}
          pinned={resource.pinned}
          settled={resource.status === 'settled'}
          snoozedUntil={resource.snoozedUntil}
          disabled={pendingActions.has(key) || resource.offline}
          settleDisabled={resource.settleDisabled}
          onPin={() => runLifecycle(resource.tab, resource.pin)}
          onSettle={() => runLifecycle(resource.tab, resource.settle)}
          onSnooze={(until) => runLifecycle(resource.tab, () => resource.snooze(until))}
        />
      ),
    }
    const row = resource.row
    return row.kind === 'thread' ? (
      <WorkspaceThreadRow key={key} {...shell} {...row} />
    ) : row.kind === 'browser' ? (
      <WorkspacePageRow key={key} {...shell} {...row} pinnedPage={pinnedPage} />
    ) : (
      <WorkspaceTerminalRow
        key={key}
        {...shell}
        {...row}
        pinned={resource.pinned}
        offline={resource.offline}
      />
    )
  }
  // Home resumes work: open tabs first, then pinned, then other active items. Still one mixed list.
  const continueWorking = [
    ...state.tabs.flatMap((tab) =>
      resources.filter((resource) => workspaceTabKey(resource.tab) === workspaceTabKey(tab)),
    ),
    ...resources.filter((resource) => resource.pinned),
    ...[...resources]
      .filter((resource) => resource.status === 'active')
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true })),
  ]
    .filter(
      (resource, index, all) =>
        all.findIndex((item) => workspaceTabKey(item.tab) === workspaceTabKey(resource.tab)) ===
        index,
    )
    .slice(0, 6)
  const showHome = () => {
    setState(showWorkspaceOverview)
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>('[data-workspace-input] textarea')?.focus(),
    )
  }
  /** Hiding an item focuses the remaining content, or returns to the Home composer. */
  const closeTab = (key: string) => {
    const next = closeWorkspaceTab(current.current, key)
    setState(next)
    requestAnimationFrame(() => {
      const target = next.active
        ? document.getElementById('workspace-content')
        : document.querySelector<HTMLElement>('[data-workspace-input] textarea')
      target?.focus()
    })
  }
  // Sections follow the thread workflow; each one mixes threads, pages and terminals.
  const sidebarSections = sections
    .map((section) => ({
      ...section,
      items: matchingResources.filter((resource) => sectionOf(resource) === section.id),
    }))
    .filter((section) => section.items.length)
  const label = (tab: WorkspaceTab) => {
    const listed = resources.find(
      (resource) => workspaceTabKey(resource.tab) === workspaceTabKey(tab),
    )?.title
    if (listed) return listed
    // Hard-archived threads leave the list but still resolve from their computer's snapshot.
    const identity =
      tab.kind === 'browser' ? undefined : workspaceIdentity(tab, { computers, browserTabs })
    if (identity?.availability === 'present' && tab.id) return identity.title
    return tab.kind === 'thread' && !tab.id
      ? 'New thread'
      : tab.kind === 'terminal'
        ? 'Terminal session'
        : `${tab.kind} · ${tab.id === 'new' ? 'New tab' : tab.id}`
  }
  const browserTabsChanged = useCallback((tabs: BrowserTab[], activeId: string) => {
    // A new-page selection can arrive before its updated browser tab list commits.
    if (requestedBrowserTab.current && !tabs.some((tab) => tab.id === requestedBrowserTab.current))
      return
    requestedBrowserTab.current = undefined
    // The pane's explicit tab list is authoritative: drop every workspace ref to a closed page,
    // but keep the "new" placeholder while its page is still being created.
    const live = new Set(tabs.map((tab) => tab.id))
    setState((previous) => {
      const stale = previous.tabs.filter(
        (tab) =>
          tab.kind === 'browser' &&
          !live.has(tab.id) &&
          !(tab.id === 'new' && pendingBrowserAction.current),
      )
      if (!stale.length) return previous
      const next = stale.reduce(
        (state, tab) => closeWorkspaceTab(state, workspaceTabKey(tab)),
        previous,
      )
      return stale.some((tab) => workspaceTabKey(tab) === previous.active)
        ? openWorkspaceTab(next, { kind: 'browser', runtimeId: '', id: activeId })
        : next
    })
  }, [])
  return (
    <StudioHostProvider api={api}>
      <section aria-label="Unified workspace" className="flex min-h-0 min-w-0 flex-1">
        {!sidebar?.collapsed && (
          <ResizableSidebar
            preference="threadSidebarWidth"
            side="left"
            label="Workspace sidebar"
            maxFraction={0.45}
            maxWidth={640}
            className="studio-task-sidebar flex min-h-0 flex-col"
          >
            <SidebarHeader />
            <div className="studio-overview-pane flex min-h-0 flex-1 flex-col overflow-hidden bg-sidebar">
              <div className="studio-thread-sidebar-controls shrink-0 space-y-2 border-b px-3 pb-2 pt-3">
                <div className="flex items-center gap-2">
                  <div className="studio-thread-search relative min-w-0 flex-1">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      aria-label="Search workspace"
                      placeholder="Search workspace…"
                      className="h-8 pl-8 text-xs md:text-xs"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                  </div>
                  <IconButton
                    label="Filter workspace"
                    aria-pressed={filtersOpen}
                    className="studio-thread-new size-8"
                    onClick={() => setFiltersOpen(!filtersOpen)}
                  >
                    <SlidersHorizontal className="size-3.5" />
                  </IconButton>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label="Workspace home"
                    title="Show workspace home; open items stay open"
                    aria-current={!active ? 'page' : undefined}
                    className={cn(
                      'min-w-0 flex-1 rounded px-1 text-left text-xs font-medium hover:text-foreground',
                      active ? 'text-muted-foreground' : 'text-foreground',
                    )}
                    onClick={showHome}
                  >
                    Workspace
                  </button>
                  {active && (
                    <IconButton
                      label={`Hide ${label(active)}`}
                      title="Hide this open item; it remains available in the sidebar."
                      className="size-7 text-muted-foreground"
                      disabled={switching}
                      onClick={() => closeTab(workspaceTabKey(active))}
                    >
                      <X className="size-3.5" />
                    </IconButton>
                  )}
                  <IconButton
                    label="New thread"
                    title="New thread"
                    className="size-7"
                    disabled={switching || !store.activeRuntimeId}
                    onClick={() =>
                      open({ kind: 'thread', runtimeId: store.activeRuntimeId ?? '', id: '' })
                    }
                  >
                    <MessageSquare className="size-3.5" />
                  </IconButton>
                  <IconButton
                    label="New browser"
                    title="New browser"
                    className="size-7"
                    onClick={newBrowser}
                  >
                    <Globe2 className="size-3.5" />
                  </IconButton>
                  <IconButton
                    label="New terminal"
                    title="New terminal"
                    className="size-7"
                    onClick={() => setCreatingTerminal(true)}
                  >
                    <Terminal className="size-3.5" />
                  </IconButton>
                </div>
                {filtersOpen && (
                  <div className="space-y-2 pb-1">
                    <ChoicePicker
                      aria-label="Workspace computer filter"
                      className="h-8 text-xs"
                      value={computer}
                      onValueChange={setComputer}
                    >
                      <option value="">All computers</option>
                      {computers.map((owner) => (
                        <option key={owner.profile.id} value={owner.profile.id}>
                          {runtimeComputerName(owner)}
                        </option>
                      ))}
                    </ChoicePicker>
                    <div className="flex gap-1" aria-label="Workspace type filter">
                      {(['all', 'thread', 'browser', 'terminal'] as const).map((kind) => (
                        <Button
                          key={kind}
                          size="sm"
                          variant="ghost"
                          className={cn(
                            'h-7 flex-1 px-1 text-[11px]',
                            filter === kind && 'bg-accent text-foreground',
                          )}
                          aria-pressed={filter === kind}
                          onClick={() => setFilter(kind)}
                        >
                          {kind === 'all' ? 'All' : `${kind[0].toUpperCase()}${kind.slice(1)}s`}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {sidebarSections.map((section) => {
                  const expanded = searching || openSections[section.id]
                  return (
                    <section key={section.id} aria-label={`${section.name} workspace items`}>
                      <details
                        data-section={section.id}
                        open={expanded}
                        className="group studio-list-section mb-1 shrink-0"
                      >
                        <summary
                          aria-disabled={searching || undefined}
                          className="studio-list-section-header"
                          onClick={(event) => {
                            event.preventDefault()
                            if (searching) return
                            setOpenSections((previous) => ({
                              ...previous,
                              [section.id]: !previous[section.id],
                            }))
                          }}
                        >
                          <ChevronDown
                            size={11}
                            className="studio-list-section-chevron"
                            aria-hidden="true"
                          />
                          {['needs-input', 'working', 'waiting', 'snoozed', 'settled'].includes(
                            section.id,
                          ) && <span className="studio-thread-section-dot" aria-hidden="true" />}
                          <span className="min-w-0 flex-1 truncate">{section.name}</span>
                          <span>{section.items.length}</span>
                        </summary>
                        {expanded && (
                          <div className="pt-1">
                            {section.id === 'pinned' ? (
                              <>
                                {section.items.some((item) => item.tab.kind === 'browser') && (
                                  <div
                                    role="group"
                                    aria-label="Pinned browser tabs"
                                    className="studio-browser-pins mb-1.5 grid grid-cols-[repeat(auto-fill,minmax(3rem,1fr))] gap-1.5"
                                  >
                                    {section.items
                                      .filter((item) => item.tab.kind === 'browser')
                                      .map((item) => renderResource(item, true))}
                                  </div>
                                )}
                                {section.items
                                  .filter((item) => item.tab.kind === 'thread')
                                  .map((item) => renderResource(item))}
                                {section.items
                                  .filter((item) => item.tab.kind === 'terminal')
                                  .map((item) => renderResource(item))}
                              </>
                            ) : (
                              section.items.map((item) => renderResource(item))
                            )}
                          </div>
                        )}
                      </details>
                    </section>
                  )
                })}
                {!matchingResources.length && (
                  <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                    {search || computer || filter !== 'all'
                      ? 'No matching workspace items.'
                      : 'Your threads, pages and terminals will appear here.'}
                  </p>
                )}
              </div>
            </div>
          </ResizableSidebar>
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {sidebar?.collapsed && (
            <div className="flex h-9 shrink-0 items-center gap-1 border-b px-2">
              <Button size="sm" variant="ghost" aria-label="Workspace home" onClick={showHome}>
                <House className="size-3.5" />
                Workspace
              </Button>
              {active && (
                <IconButton
                  label={`Hide ${label(active)}`}
                  title="Hide this open item; it remains available in the sidebar."
                  className="ml-auto size-7 text-muted-foreground"
                  disabled={switching}
                  onClick={() => closeTab(workspaceTabKey(active))}
                >
                  <X className="size-3.5" />
                </IconButton>
              )}
            </div>
          )}
          {error && (
            <p role="alert" className="p-3 text-xs text-destructive">
              {error}
            </p>
          )}
          {lifecycleError && (
            <p role="alert" className="p-3 text-xs text-destructive">
              {lifecycleError}
            </p>
          )}
          {/* Keep the Home draft mounted without taking space above an active workspace tab. */}
          <div
            hidden={!!active}
            className={
              active
                ? 'hidden'
                : 'flex min-h-0 flex-1 justify-center overflow-y-auto px-8 py-[12vh]'
            }
          >
            <div className="startup-draft w-full max-w-[var(--chat-max)]">
              {!active && (
                <div className="mb-7 text-center">
                  <h1 className="startup-heading text-balance text-xl font-medium tracking-tight sm:text-2xl">
                    What are you working on?
                  </h1>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    A page to explore, a command to run, or an idea to build.
                  </p>
                </div>
              )}
              <WorkspaceInput active={active} onOpen={open} onBrowser={openBrowserLink} />
              {!active && (
                <div className="mt-5 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-2 rounded-lg text-xs"
                    disabled={switching || !store.activeRuntimeId}
                    onClick={() =>
                      open({ kind: 'thread', runtimeId: store.activeRuntimeId ?? '', id: '' })
                    }
                  >
                    <MessageSquare className="size-3.5" />
                    New thread
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-2 rounded-lg text-xs"
                    onClick={newBrowser}
                  >
                    <Globe2 className="size-3.5" />
                    New browser
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-2 rounded-lg text-xs"
                    onClick={() => setCreatingTerminal(true)}
                  >
                    <Terminal className="size-3.5" />
                    New terminal
                  </Button>
                </div>
              )}
              {!active && !!continueWorking.length && (
                <section aria-label="Continue working" className="mt-10">
                  <h2 className="mb-2 px-1 text-xs font-medium text-muted-foreground">
                    Continue working
                  </h2>
                  {continueWorking.map((item) => renderResource(item))}
                </section>
              )}
            </div>
          </div>
          <div
            id="workspace-content"
            role="region"
            aria-label={
              active
                ? `${active.kind === 'browser' ? 'Page' : active.kind === 'thread' ? 'Thread' : 'Terminal'}: ${label(active)}`
                : undefined
            }
            tabIndex={-1}
            className={cn('flex min-h-0 min-w-0 flex-1 flex-col', !active && 'hidden')}
          >
            {switching && (
              <p role="status" className="p-3 text-xs text-muted-foreground">
                Opening thread’s computer…
              </p>
            )}
            {!switching &&
              active?.kind === 'thread' &&
              switchFailure?.runtimeId === active.runtimeId && (
                <div role="alert" className="p-6 text-sm">
                  <p className="text-destructive">
                    Couldn’t open this thread’s computer: {switchFailure.message}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-3"
                    onClick={() => setSwitchAttempt((attempt) => attempt + 1)}
                  >
                    Retry
                  </Button>
                </div>
              )}
            {state.tabs
              .filter((tab) => tab.kind !== 'browser')
              .map((tab) => {
                const key = workspaceTabKey(tab),
                  selected = state.active === key
                const owner = computers.find((entry) => entry.profile.id === tab.runtimeId)
                return (
                  <Activity
                    key={key}
                    mode={
                      selected &&
                      (tab.kind !== 'thread' || !owner || store.activeRuntimeId === tab.runtimeId)
                        ? 'visible'
                        : 'hidden'
                    }
                  >
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                      {tab.kind === 'terminal' ? (
                        <WorkspaceTerminalSurface
                          embedded
                          target={tab}
                          onHide={() => setState((previous) => closeWorkspaceTab(previous, key))}
                          onNew={() => setCreatingTerminal(true)}
                          onLifecycleError={setLifecycleError}
                        />
                      ) : owner ? (
                        <WorkspaceScope profile={owner.profile}>
                          <TasksView
                            embedded
                            entityId={tab.id || undefined}
                            {...threadNavigation.current.get(key)}
                          />
                        </WorkspaceScope>
                      ) : (
                        <p role="status" className="p-6 text-sm text-muted-foreground">
                          This thread’s computer is no longer paired.
                        </p>
                      )}
                    </div>
                  </Activity>
                )
              })}
            <div
              className={cn(
                'flex min-h-0 min-w-0 flex-1 flex-col',
                active?.kind !== 'browser' && 'hidden',
              )}
            >
              <BrowserPane
                taskId={STUDIO_BROWSER_SCOPE}
                shared
                openLink={browserLink}
                onLinkOpened={() => setBrowserLink(null)}
                workspaceControl={{
                  visible: active?.kind === 'browser',
                  lifecycleRequest: browserLifecycleRequest,
                  onLifecycleHandled: (requestId) =>
                    setBrowserLifecycleRequest((previous) =>
                      previous?.requestId === requestId ? undefined : previous,
                    ),
                  onError: setLifecycleError,
                  focusTabId: active?.kind === 'browser' ? active.id : undefined,
                  onSelect: (id) => {
                    pendingBrowserAction.current = false
                    requestedBrowserTab.current = id
                    setState((previous) => {
                      const placeholder = previous.tabs.find(
                        (tab) => tab.kind === 'browser' && tab.id === 'new',
                      )
                      return openWorkspaceTab(
                        placeholder
                          ? closeWorkspaceTab(previous, workspaceTabKey(placeholder))
                          : previous,
                        { kind: 'browser', runtimeId: '', id },
                      )
                    })
                  },
                  onTabsChange: browserTabsChanged,
                  newTabRequest: browserRequest,
                  tabs: browserTabs,
                  onSetTabs: setControlledBrowserTabs,
                }}
              />
            </div>
          </div>
        </div>
        <NewWorkspaceTerminalDialog
          open={creatingTerminal}
          onOpenChange={setCreatingTerminal}
          onOpen={(target) => open({ ...target, kind: 'terminal' })}
        />
      </section>
    </StudioHostProvider>
  )
}
