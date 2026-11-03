import { Activity, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Globe2, MessageSquare, Terminal, X } from 'lucide-react'
import { randomUUID, runtimeComputerName, STUDIO_BROWSER_SCOPE } from '@dovo/protocol'
import {
  StudioHostProvider,
  useAppPreferences,
  useStudioHost,
  useWorkspace,
  WorkspaceScope,
  type StudioHostApi,
  type StudioNavigation,
} from '@dovo/studio-core'
import { Button, IconButton, Input, SidebarHeader, useNavigationSidebar } from '@dovo/studio-ui'
import TasksView from '../view'
import { BrowserPane } from '../browser/browser-pane'
import { readSharedBrowserTabs, type BrowserTab } from '../browser/shared-browser-tabs'
import { ResizableSidebar } from '../detail/resizable-sidebar'
import {
  NewWorkspaceTerminal,
  WorkspaceTerminalSurface,
  terminalContext,
  useWorkspaceComputers,
} from '../terminal/terminal-workspace'
import { WorkspaceInput } from './workspace-input'
import {
  closeWorkspaceTab,
  openWorkspaceTab,
  readWorkspaceTabs,
  saveWorkspaceTabs,
  workspaceTabKey,
  type WorkspaceTab,
} from './workspace-tabs'

const icons = { thread: MessageSquare, browser: Globe2, terminal: Terminal }

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
  const [pages, setPages] = useState<BrowserTab[]>(() => readSharedBrowserTabs().state?.tabs ?? [])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | WorkspaceTab['kind']>('all')
  const [computer, setComputer] = useState('')
  const [error, setError] = useState(restored.error ?? '')
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
  const resources = [
    ...computers.flatMap((owner) => [
      ...(owner.snapshot?.workspace.tasks
        .filter((task) => !task.archived && !task.archivedAt)
        .map((task) => ({
          tab: { kind: 'thread' as const, runtimeId: owner.profile.id, id: task.id },
          title: task.title || 'Untitled thread',
          detail: runtimeComputerName(owner),
          offline: !owner.connected,
        })) ?? []),
      ...(owner.snapshot?.terminals.map((session) => ({
        tab: { kind: 'terminal' as const, runtimeId: owner.profile.id, id: session.id },
        title: `${session.title}${session.exited ? ' · exited' : ''}`,
        detail: `${runtimeComputerName(owner)} · ${terminalContext(session, owner.snapshot?.workspace)}`,
        offline: !owner.connected,
      })) ?? []),
    ]),
    ...pages.map((page) => ({
      tab: { kind: 'browser' as const, runtimeId: '', id: page.id },
      title: page.title || page.url || 'New browser tab',
      detail: page.url || 'Browser',
      offline: false,
    })),
  ]
  const label = (tab: WorkspaceTab) =>
    resources.find((resource) => workspaceTabKey(resource.tab) === workspaceTabKey(tab))?.title ??
    (tab.kind === 'thread' && !tab.id
      ? 'New thread'
      : `${tab.kind} · ${tab.id === 'new' ? 'New tab' : tab.id}`)
  const browserTabsChanged = useCallback((tabs: BrowserTab[], activeId: string) => {
    setPages(tabs)
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
            preference="browserSidebarWidth"
            side="left"
            label="Workspace sidebar"
            maxFraction={0.45}
            maxWidth={480}
            className="flex min-h-0 flex-col border-r"
          >
            <SidebarHeader />
            <h1 className="px-3 py-2 text-sm font-medium">Workspace</h1>
            <div className="flex gap-2 border-b p-3">
              <Button
                size="sm"
                disabled={switching || !store.activeRuntimeId}
                onClick={() =>
                  open({ kind: 'thread', runtimeId: store.activeRuntimeId ?? '', id: '' })
                }
              >
                New thread
              </Button>
              <Button size="sm" variant="outline" onClick={newBrowser}>
                New browser
              </Button>
            </div>
            <NewWorkspaceTerminal onOpen={(target) => open({ ...target, kind: 'terminal' })} />
            <div className="space-y-2 p-2">
              <Input
                aria-label="Search workspace"
                placeholder="Search workspace…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <select
                aria-label="Workspace computer filter"
                className="w-full rounded border bg-background p-2 text-xs"
                value={computer}
                onChange={(event) => setComputer(event.target.value)}
              >
                <option value="">All computers</option>
                {computers.map((owner) => (
                  <option key={owner.profile.id} value={owner.profile.id}>
                    {runtimeComputerName(owner)}
                  </option>
                ))}
              </select>
              <div className="flex flex-wrap gap-1" aria-label="Workspace type filter">
                {(['all', 'thread', 'browser', 'terminal'] as const).map((kind) => (
                  <Button
                    key={kind}
                    size="sm"
                    variant={filter === kind ? 'secondary' : 'ghost'}
                    aria-pressed={filter === kind}
                    onClick={() => setFilter(kind)}
                  >
                    {kind === 'all' ? 'All' : `${kind[0].toUpperCase()}${kind.slice(1)}s`}
                  </Button>
                ))}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {resources
                .filter(
                  (resource) =>
                    (filter === 'all' || resource.tab.kind === filter) &&
                    (!computer ||
                      resource.tab.runtimeId === computer ||
                      (resource.tab.kind === 'browser' &&
                        pages.find((page) => page.id === resource.tab.id)?.runtimeId ===
                          computer)) &&
                    `${resource.title} ${resource.detail}`
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                )
                .map((resource) => {
                  const Icon = icons[resource.tab.kind]
                  return (
                    <button
                      key={workspaceTabKey(resource.tab)}
                      type="button"
                      disabled={switching}
                      className="mb-1 flex w-full items-center gap-2 rounded p-2 text-left text-xs hover:bg-accent"
                      onClick={() => open(resource.tab)}
                    >
                      <Icon size={14} className="shrink-0" />
                      <span className="min-w-0">
                        <span className="block truncate">{resource.title}</span>
                        <span className="block truncate text-muted-foreground">
                          {resource.detail}
                          {resource.offline ? ' · offline' : ''}
                        </span>
                      </span>
                    </button>
                  )
                })}
            </div>
          </ResizableSidebar>
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div
            role="tablist"
            aria-label="Workspace tabs"
            className="flex shrink-0 overflow-x-auto border-b p-1"
          >
            {state.tabs.map((tab) => {
              const key = workspaceTabKey(tab),
                Icon = icons[tab.kind]
              return (
                <div key={key} className="flex shrink-0 items-center">
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
                            : (index + (event.key === 'ArrowRight' ? 1 : -1) + state.tabs.length) %
                              state.tabs.length
                      open(state.tabs[next])
                      event.currentTarget
                        .closest('[role="tablist"]')
                        ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                        [next]?.focus()
                    }}
                    disabled={switching}
                    className="flex max-w-60 items-center gap-2 rounded px-3 py-2 text-xs aria-selected:bg-accent"
                    onClick={() => open(tab)}
                  >
                    <Icon size={14} className="shrink-0" />
                    <span className="truncate">{label(tab)}</span>
                  </button>
                  <IconButton
                    label={`Close workspace tab ${label(tab)}`}
                    title="Close this workspace tab; the session remains available in the sidebar."
                    className="size-6"
                    onClick={() => setState((previous) => closeWorkspaceTab(previous, key))}
                  >
                    <X size={12} />
                  </IconButton>
                </div>
              )
            })}
          </div>
          {error && (
            <p role="alert" className="p-3 text-xs text-destructive">
              {error}
            </p>
          )}
          <WorkspaceInput active={active} onOpen={open} onBrowser={openBrowserLink} />
          <div
            id="workspace-tab-panel"
            role="tabpanel"
            aria-labelledby={
              active ? `workspace-tab-${encodeURIComponent(workspaceTabKey(active))}` : undefined
            }
            className="flex min-h-0 min-w-0 flex-1 flex-col"
          >
            {!active && (
              <div className="p-6 text-sm text-muted-foreground">
                Open a browser page, thread or terminal from the sidebar. They appear together as
                workspace tabs.
              </div>
            )}
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
                          target={tab}
                          onHide={() => setState((previous) => closeWorkspaceTab(previous, key))}
                          onSelect={(target) => open({ ...target, kind: 'terminal' })}
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
            <Activity mode={active?.kind === 'browser' ? 'visible' : 'hidden'}>
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <BrowserPane
                  taskId={STUDIO_BROWSER_SCOPE}
                  shared
                  openLink={browserLink}
                  onLinkOpened={() => setBrowserLink(null)}
                  workspaceControl={{
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
                  }}
                />
              </div>
            </Activity>
          </div>
        </div>
      </section>
    </StudioHostProvider>
  )
}
