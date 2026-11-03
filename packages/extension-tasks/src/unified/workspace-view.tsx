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
  AlarmClock,
  Check,
  ChevronRight,
  Globe2,
  MessageSquare,
  Terminal,
  X,
  Plus,
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
  wakeBrowserTab,
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
import { ResizableSidebar } from '../detail/resizable-sidebar'
import {
  NewWorkspaceTerminalDialog,
  WorkspaceTerminalSurface,
  terminalContext,
  useWorkspaceComputers,
} from '../terminal/terminal-workspace'
import { WorkspaceInput } from './workspace-input'
import { WorkspaceResourceMenu } from './workspace-resource-menu'
import {
  closeWorkspaceTab,
  openWorkspaceTab,
  readWorkspaceTabs,
  saveWorkspaceTabs,
  workspaceTabKey,
  type WorkspaceTab,
} from './workspace-tabs'

const icons = { thread: MessageSquare, browser: Globe2, terminal: Terminal }
type ResourceStatus = 'active' | 'snoozed' | 'settled'
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
}
const sections = [
  { id: 'pinned', name: 'Pinned' },
  { id: 'active', name: 'Active' },
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
  const [openSections, setOpenSections] = useState<Record<SectionId, boolean>>({
    pinned: true,
    active: true,
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
  useEffect(() => {
    try {
      saveWorkspaceTabs(state)
    } catch {
      setError('Could not save workspace tabs. They remain available in this session.')
    }
  }, [state])
  // Threads retain the existing active-computer mutation path; terminals and pages can use
  // explicit remote ownership without changing the user's active computer.
  useEffect(() => {
    if (active?.kind !== 'thread' || active.runtimeId === store.activeRuntimeId) {
      setSwitching(false)
      return
    }
    let alive = true
    if (!computers.some((entry) => entry.profile.id === active.runtimeId)) {
      setSwitching(false)
      return
    }
    setSwitching(true)
    setError('')
    void store
      .switchRuntime(active.runtimeId)
      .catch((cause: unknown) => {
        if (alive) setError(String(cause))
      })
      .finally(() => {
        if (alive) setSwitching(false)
      })
    return () => {
      alive = false
    }
  }, [active?.kind, active?.runtimeId, store.activeRuntimeId, store.switchRuntime])
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
          const tab: WorkspaceTab = {
            kind: 'thread',
            runtimeId: store.activeRuntimeId ?? '',
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
      // Settled threads are task.archived; only hard-archived threads (archivedAt) leave the list.
      const threads = (owner.snapshot?.workspace.tasks ?? [])
        .filter((task) => !task.example && !task.archivedAt)
        .map((task): WorkspaceResource => {
          const tab = { kind: 'thread' as const, runtimeId: owner.profile.id, id: task.id }
          // Capture the owner now so a later active-computer switch cannot redirect the write.
          const patch = (updates: Parameters<ReturnType<typeof taskActionClient>['patch']>[1]) =>
            taskActionClient(taskStore, source).patch(task, updates)
          return {
            tab,
            title: task.title || 'Untitled thread',
            detail: source.name,
            offline: !owner.connected,
            pinned: !!task.pinned,
            status: task.archived ? 'settled' : isSnoozed(task, now) ? 'snoozed' : 'active',
            snoozedUntil: task.snoozedUntil ?? undefined,
            settleDisabled: task.status === 'running',
            pin: () => patch({ pinned: !task.pinned }),
            settle: () => patch({ archived: !task.archived, snoozedUntil: null }),
            snooze: (until) => patch({ snoozedUntil: until }),
          }
        })
      const terminals = (owner.snapshot?.terminals ?? []).map(
        (session: TerminalInfo): WorkspaceResource => {
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
            await store.refreshRuntime(owner.profile)
          }
          const snoozed = !!session.snoozedUntil && Date.parse(session.snoozedUntil) > now
          return {
            tab: { kind: 'terminal' as const, runtimeId: owner.profile.id, id: session.id },
            title: `${session.title}${session.exited ? ' · exited' : ''}`,
            detail: `${source.name} · ${terminalContext(session, owner.snapshot?.workspace)}`,
            offline: !owner.connected,
            pinned: !!session.pinned,
            status: snoozed ? 'snoozed' : session.settledAt ? 'settled' : 'active',
            snoozedUntil: session.snoozedUntil,
            pin: () => update({ pinned: !session.pinned }),
            settle: () => update({ settled: !session.settledAt, snoozedUntil: null }),
            snooze: (until) => update({ snoozedUntil: until }),
          }
        },
      )
      return [...threads, ...terminals]
    }),
    ...pages.map((page): WorkspaceResource => {
      const status = browserTabCategory(page, now)
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
  // Sections follow the thread workflow; each one mixes threads, pages and terminals.
  const sidebarSections = sections
    .map((section) => ({
      ...section,
      items: matchingResources.filter((resource) => sectionOf(resource) === section.id),
    }))
    .filter((section) => section.items.length)
  const label = (tab: WorkspaceTab) =>
    resources.find((resource) => workspaceTabKey(resource.tab) === workspaceTabKey(tab))?.title ??
    (tab.kind === 'thread' && !tab.id
      ? 'New thread'
      : tab.kind === 'terminal'
        ? 'Terminal session'
        : `${tab.kind} · ${tab.id === 'new' ? 'New tab' : tab.id}`)
  const browserTabsChanged = useCallback((tabs: BrowserTab[], activeId: string) => {
    // A new-page selection can arrive before its updated browser tab list commits.
    if (requestedBrowserTab.current && !tabs.some((tab) => tab.id === requestedBrowserTab.current))
      return
    requestedBrowserTab.current = undefined
    setState((previous) => {
      const selected = previous.tabs.find((tab) => workspaceTabKey(tab) === previous.active)
      if (
        !pendingBrowserAction.current &&
        selected?.kind === 'browser' &&
        !tabs.some((tab) => tab.id === selected.id)
      )
        return openWorkspaceTab(closeWorkspaceTab(previous, previous.active), {
          kind: 'browser',
          runtimeId: '',
          id: activeId,
        })
      return previous
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
                  <span className="min-w-0 flex-1 px-1 text-xs font-medium text-muted-foreground">
                    Workspace
                  </span>
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
                    <section
                      key={section.id}
                      aria-label={`${section.name} workspace items`}
                      className="mb-2"
                    >
                      <button
                        type="button"
                        aria-expanded={expanded}
                        disabled={searching}
                        className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                        onClick={() =>
                          setOpenSections((previous) => ({
                            ...previous,
                            [section.id]: !previous[section.id],
                          }))
                        }
                      >
                        <ChevronRight
                          className={cn(
                            'size-3 shrink-0 transition-transform',
                            expanded && 'rotate-90',
                          )}
                        />
                        <span className="flex-1 text-left">{section.name}</span>
                        <span className="tabular-nums">{section.items.length}</span>
                      </button>
                      {expanded &&
                        section.items.map((resource) => {
                          const key = workspaceTabKey(resource.tab)
                          const selected = key === state.active
                          const Icon = icons[resource.tab.kind]
                          const busy = pendingActions.has(key)
                          return (
                            <div
                              key={key}
                              className="studio-thread-row mb-1 flex items-center gap-1"
                              data-highlighted={selected || undefined}
                            >
                              <button
                                type="button"
                                disabled={switching}
                                aria-current={selected ? 'page' : undefined}
                                className="studio-thread-card flex min-w-0 flex-1 items-center gap-2.5 border px-2.5 py-2.5 text-left hover:bg-accent"
                                onClick={() => open(resource.tab)}
                              >
                                <Icon
                                  className={cn(
                                    'size-4 shrink-0',
                                    selected ? 'text-primary' : 'text-muted-foreground',
                                  )}
                                />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-medium">
                                    {resource.title}
                                  </span>
                                  <span className="studio-thread-card-context block truncate text-xs text-muted-foreground">
                                    {resource.detail}
                                    {resource.offline ? ' · offline' : ''}
                                  </span>
                                </span>
                                {resource.status === 'settled' && (
                                  <Check
                                    className="size-3.5 shrink-0 text-muted-foreground"
                                    aria-label="Settled"
                                  />
                                )}
                                {resource.status === 'snoozed' && (
                                  <AlarmClock
                                    className="size-3.5 shrink-0 text-muted-foreground"
                                    aria-label="Snoozed"
                                  />
                                )}
                              </button>
                              <WorkspaceResourceMenu
                                title={resource.title}
                                pinned={resource.pinned}
                                settled={resource.status === 'settled'}
                                snoozedUntil={resource.snoozedUntil}
                                disabled={busy || resource.offline}
                                settleDisabled={resource.settleDisabled}
                                onPin={() => runLifecycle(resource.tab, resource.pin)}
                                onSettle={() => runLifecycle(resource.tab, resource.settle)}
                                onSnooze={(until) =>
                                  runLifecycle(resource.tab, () => resource.snooze(until))
                                }
                              />
                            </div>
                          )
                        })}
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
          {!!state.tabs.length && (
            <div
              role="tablist"
              aria-label="Workspace tabs"
              className="flex min-h-11 shrink-0 items-center gap-1 overflow-x-auto border-b bg-sidebar/40 px-2 py-1"
            >
              {state.tabs.map((tab) => {
                const key = workspaceTabKey(tab),
                  Icon = icons[tab.kind]
                return (
                  <div
                    key={key}
                    className={cn(
                      'group flex shrink-0 items-center rounded-lg border border-transparent pr-1',
                      state.active === key
                        ? 'border-border/60 bg-background shadow-sm'
                        : 'hover:bg-accent/50',
                    )}
                  >
                    <button
                      type="button"
                      role="tab"
                      id={`workspace-tab-${encodeURIComponent(key)}`}
                      aria-controls="workspace-tab-panel"
                      aria-selected={state.active === key}
                      tabIndex={state.active === key ? 0 : -1}
                      onKeyDown={(event) => {
                        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                        event.preventDefault()
                        const index = state.tabs.indexOf(tab)
                        const next =
                          event.key === 'Home'
                            ? 0
                            : event.key === 'End'
                              ? state.tabs.length - 1
                              : (index +
                                  (event.key === 'ArrowRight' ? 1 : -1) +
                                  state.tabs.length) %
                                state.tabs.length
                        open(state.tabs[next])
                        event.currentTarget
                          .closest('[role="tablist"]')
                          ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                          [next]?.focus()
                      }}
                      disabled={switching}
                      className="flex max-w-52 items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground aria-selected:text-foreground"
                      onClick={() => open(tab)}
                    >
                      <Icon size={14} className="shrink-0" />
                      <span className="truncate">{label(tab)}</span>
                    </button>
                    <IconButton
                      label={`Close workspace tab ${label(tab)}`}
                      title="Close this workspace tab; the session remains available in the sidebar."
                      className="size-5 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                      onClick={() => setState((previous) => closeWorkspaceTab(previous, key))}
                    >
                      <X size={12} />
                    </IconButton>
                  </div>
                )
              })}
              <IconButton
                label="New workspace tab"
                title="New thread"
                className="size-7 shrink-0 text-muted-foreground"
                onClick={() =>
                  open({ kind: 'thread', runtimeId: store.activeRuntimeId ?? '', id: '' })
                }
              >
                <Plus className="size-3.5" />
              </IconButton>
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
          <div
            className={
              active
                ? 'shrink-0 px-4 py-3'
                : 'flex min-h-0 flex-1 items-center justify-center px-8 py-10'
            }
          >
            <div className={active ? 'w-full' : 'w-full max-w-xl'}>
              {!active && (
                <div className="mb-7">
                  <h1 className="text-2xl font-medium tracking-tight">What are you working on?</h1>
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
            </div>
          </div>
          <div
            id="workspace-tab-panel"
            role="tabpanel"
            aria-labelledby={
              active ? `workspace-tab-${encodeURIComponent(workspaceTabKey(active))}` : undefined
            }
            className={cn('flex min-h-0 min-w-0 flex-1 flex-col', !active && 'hidden')}
          >
            {switching && (
              <p role="status" className="p-3 text-xs text-muted-foreground">
                Opening thread’s computer…
              </p>
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
                          onSelect={(target) => open({ ...target, kind: 'terminal' })}
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
