import { randomUUID } from '@dovo/protocol'
import { Effect } from 'effect'
import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect, useRef } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  RotateCw,
  Maximize2,
  Minimize2,
  Smartphone,
  PanelRightClose,
  SlidersHorizontal,
  Plus,
  MonitorUp,
  X,
} from 'lucide-react'
import {
  useWorkspace,
  useStudioHost,
  startPolling,
  useAppPreferences,
  updateAppPreferences,
  useRemoteBrowserProfiles,
} from '@dovo/studio-core'
import {
  previewUrl,
  previewPresets,
  previewDevicesSchema,
  previewResultSchema,
  responses,
  type PreviewDevice,
} from '@dovo/studio-core'
import { Button, IconButton, Input, DropdownMenu } from '@dovo/studio-ui'
import { RemoteBrowser } from './remote-browser'
import { DeviceList } from './device-list'
import { PhysicalControls } from './physical-controls'
const addresses = new Map<string, string>()
type BrowserTab = {
  id: string
  url: string
  title: string
  kind: 'web' | 'remote'
  profileId: string
}
type OpenLink = { id: string; url: string }
const savedTabs = new Map<string, { tabs: BrowserTab[]; active: string }>()
export function BrowserPane({
  taskId,
  onClose,
  openLink,
  onLinkOpened,
}: {
  taskId: string
  onClose?: () => void
  openLink?: OpenLink | null
  onLinkOpened?: () => void
}) {
  return (
    <PreviewPane
      taskId={taskId}
      onClose={onClose}
      mode="remote"
      openLink={openLink}
      onLinkOpened={onLinkOpened}
    />
  )
}
export function DevicesPane({ taskId, onClose }: { taskId: string; onClose?: () => void }) {
  return <PreviewPane taskId={taskId} onClose={onClose} mode="devices" />
}
function PreviewPane({
  taskId,
  onClose,
  mode,
  openLink,
  onLinkOpened,
}: {
  taskId: string
  onClose?: () => void
  mode: 'remote' | 'devices'
  openLink?: OpenLink | null
  onLinkOpened?: () => void
}) {
  const { connection } = useWorkspace()
  const scope = `${connection?.address ?? ''}:${taskId}`
  return (
    <BrowserContent
      key={`${scope}:${mode}`}
      scope={scope}
      taskId={taskId}
      onClose={onClose}
      initialMode={mode}
      openLink={openLink}
      onLinkOpened={onLinkOpened}
    />
  )
}
function BrowserContent({
  scope,
  initialMode,
  taskId,
  onClose,
  openLink,
  onLinkOpened,
}: {
  scope: string
  openLink?: OpenLink | null
  onLinkOpened?: () => void
  initialMode: 'remote' | 'devices'
  taskId: string
  onClose?: () => void
}) {
  const { connection, request, connected, snapshot } = useWorkspace(),
    { browser } = useStudioHost()
  const preferences = useAppPreferences()
  const profiles = preferences.browserProfiles.length
    ? preferences.browserProfiles
    : [{ id: 'default', name: 'Default' }]
  const remoteProfiles = useRemoteBrowserProfiles(undefined, initialMode !== 'devices')
  const agentAccess = preferences.browserAgentAccess[scope] ?? false
  const saved = savedTabs.get(scope)
  const initialUrl =
    saved?.tabs.find((tab) => tab.id === saved.active)?.url ?? addresses.get(scope) ?? ''
  const [input, setInput] = useApplicationState(initialUrl || 'http://localhost:3000')
  const [url, setUrl] = useApplicationState(initialUrl)
  const [history, setHistory] = useApplicationState({
    url: '',
    title: '',
    cdp: undefined as string | undefined,
    back: false,
    forward: false,
  })
  const [tabs, setTabs] = useApplicationState<BrowserTab[]>(
    () =>
      savedTabs.get(scope)?.tabs ?? [
        {
          id: randomUUID(),
          url: addresses.get(scope) ?? '',
          title: '',
          kind: browser ? 'web' : 'remote',
          profileId:
            browser &&
            profiles.some((profile) => profile.id === preferences.browserProfileByThread[scope])
              ? (preferences.browserProfileByThread[scope] ?? 'default')
              : 'default',
        },
      ],
  )
  const [activeTab, setActiveTab] = useApplicationState(
    () => savedTabs.get(scope)?.active ?? tabs[0].id,
  )
  const selectedTab = tabs.find((tab) => tab.id === activeTab) ?? tabs[0]
  const profileId = selectedTab.profileId ?? 'default'
  const browserKey = `${scope}:${activeTab}`
  const openedLink = useRef('')
  useEffect(() => {
    savedTabs.set(scope, { tabs, active: activeTab })
  }, [scope, tabs, activeTab])
  const selectTab = (tab: BrowserTab) => {
    setActiveTab(tab.id)
    setUrl(tab.url)
    setInput(tab.url)
    setHistory({ url: '', title: '', cdp: undefined, back: false, forward: false })
  }
  const newTab = (target = '', kind: BrowserTab['kind'] = 'web', profileId = 'default') => {
    const tab: BrowserTab = {
      id: randomUUID(),
      url: target,
      title: '',
      kind,
      profileId,
    }
    setTabs((previous) => [...previous, tab])
    selectTab(tab)
  }
  const editing = useRef(false)
  const mode =
    initialMode === 'devices'
      ? 'devices'
      : (tabs.find((tab) => tab.id === activeTab)?.kind ?? 'web')
  const tabProfiles = mode === 'remote' ? (remoteProfiles.profiles ?? []) : profiles
  useEffect(() => {
    if (!openLink || openedLink.current === openLink.id) return
    openedLink.current = openLink.id
    newTab(previewUrl(openLink.url))
    onLinkOpened?.()
  }, [openLink?.id, browser, onLinkOpened])
  const [preset, setPreset] = useApplicationState('fill'),
    [landscape, setLandscape] = useApplicationState(false)
  const [error, setError] = useApplicationState(''),
    [reload, setReload] = useApplicationState(0)
  const [turnReload, setTurnReload] = useApplicationState(0)
  const latestTurn = snapshot?.workspace.tasks.find((task) => task.id === taskId)?.turns?.at(-1)
  const seenTurn = useRef(latestTurn?.status === 'completed' ? latestTurn.id : '')
  useEffect(() => {
    if (!latestTurn || latestTurn.status !== 'completed' || seenTurn.current === latestTurn.id)
      return
    seenTurn.current = latestTurn.id
    if (
      !latestTurn.checkpoint ||
      (!latestTurn.checkpoint.files.length && !latestTurn.checkpoint.omitted.length)
    )
      return
    if (mode === 'remote') setTurnReload((value) => value + 1)
    if (mode === 'web' && url) {
      if (browser)
        void browser({ action: 'reload', key: browserKey }).catch((cause) =>
          setError(String(cause)),
        )
      else setReload((value) => value + 1)
    }
  }, [
    latestTurn?.id,
    latestTurn?.status,
    latestTurn?.checkpoint,
    mode,
    url,
    browser,
    scope,
    browserKey,
  ])
  const [devices, setDevices] = useApplicationState<PreviewDevice[]>([]),
    [diagnostics, setDiagnostics] = useApplicationState<string[]>([])
  const [liveDevice, setLiveDevice] = useApplicationState<PreviewDevice | undefined>(undefined)
  const [expanded, setExpanded] = useApplicationState(false)
  const [busy, setBusy] = useApplicationState(false),
    [image, setImage] = useApplicationState('')
  const pending = useRef(false),
    mount = useRef(true),
    slot = useRef<HTMLDivElement>(null)
  useEffect(() => {
    mount.current = true
    return () => {
      mount.current = false
    }
  }, [])
  const act = async (operation: () => Promise<unknown>) => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      await operation()
    } catch (e) {
      if (mount.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      pending.current = false
      if (mount.current) setBusy(false)
    }
  }
  const loadDevices = async () => {
    const result = await request(
      '/api/previews/devices',
      {
        taskId,
      },
      previewDevicesSchema,
    )
    if (mount.current) {
      setDevices(result.devices)
      setDiagnostics(result.diagnostics)
    }
  }
  useEffect(() => {
    if (initialMode === 'devices' && connected) void act(loadDevices)
  }, [initialMode, connected])
  const navigate = () => {
    try {
      const target = previewUrl(input, connection?.address)
      if (target === url) {
        if (browser)
          void act(() =>
            browser({
              action: 'reload',
              key: browserKey,
            }),
          )
        else setReload((n) => n + 1)
      }
      setTabs((previous) =>
        previous.map((tab) => (tab.id === activeTab ? { ...tab, url: target, title: '' } : tab)),
      )
      setUrl(target)
      setInput(target)
      addresses.set(scope, target)
      setError('')
    } catch (e) {
      setError(String(e))
    }
  }
  useEffect(() => {
    if (!browser || !url || mode !== 'web') return
    let alive = true
    const poll = Effect.tryPromise({
      try: () => browser({ action: 'status', key: browserKey }),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    }).pipe(
      Effect.tap((state) =>
        Effect.sync(() => {
          if (!alive || !state || !state.url.startsWith('http')) return
          setHistory({ ...state, title: state.title ?? '', cdp: state.cdp })
          if (!editing.current) setInput(state.url)
          addresses.set(scope, state.url)
          setTabs((previous) =>
            previous.map((tab) =>
              tab.id === activeTab && (tab.url !== state.url || tab.title !== state.title)
                ? { ...tab, url: state.url, title: state.title ?? '' }
                : tab,
            ),
          )
        }),
      ),
      Effect.asVoid,
    )
    const polling = startPolling(poll, {
      interval: 1000,
      onError: (error) => {
        if (alive) setError(error.message)
      },
    })
    return () => {
      alive = false
      void polling.stop()
    }
  }, [browser, url, mode, scope, browserKey])
  const size = previewPresets.find((p) => p.id === preset) ?? previewPresets[0]
  useEffect(() => {
    if (!browser || !url || mode !== 'web') return
    let alive = true
    const update = () => {
      const rect = slot.current?.getBoundingClientRect()
      const obscured = document.querySelector(
        'details[open], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
      )
      const command =
        rect && rect.width > 0 && rect.height > 0 && !obscured
          ? {
              action: 'show' as const,
              profileId,
              taskId,
              agentAccess,
              key: browserKey,
              url,
              viewport:
                preset === 'fill'
                  ? undefined
                  : {
                      width: landscape ? size.height : size.width,
                      height: landscape ? size.width : size.height,
                    },
              bounds: {
                x: Math.max(0, Math.round(rect.x)),
                y: Math.max(0, Math.round(rect.y)),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              },
            }
          : {
              action: 'hide' as const,
              key: browserKey,
            }
      void browser(command).catch((e) => {
        if (alive) setError(String(e))
      })
    }
    const resize = new ResizeObserver(update),
      mutations = new MutationObserver(update)
    if (slot.current) resize.observe(slot.current)
    mutations.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['open'],
    })
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    update()
    return () => {
      alive = false
      resize.disconnect()
      mutations.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      void browser({
        action: 'hide',
        key: browserKey,
      }).catch(() => {})
    }
  }, [
    browser,
    url,
    mode,
    scope,
    browserKey,
    preset,
    landscape,
    size,
    profileId,
    taskId,
    agentAccess,
  ])
  const deviceAction = (
    device: PreviewDevice,
    action: 'boot' | 'shutdown' | 'open' | 'screenshot' | 'devicehub',
  ) =>
    void act(async () => {
      const result = await request(
        '/api/previews/action',
        {
          taskId,
          id: device.id,
          action,
          url: input,
        },
        previewResultSchema,
      )
      if (mount.current && result.image) setImage(result.image)
      await loadDevices()
    })
  if (mode === 'devices' && liveDevice)
    return (
      <section
        className={
          expanded
            ? 'fixed inset-0 z-50 flex flex-col bg-background'
            : 'flex h-full min-h-0 flex-col'
        }
      >
        <header className="relative z-10 flex shrink-0 items-center gap-2 border-b px-2 py-1.5">
          <IconButton
            label="Back to devices"
            className="size-7"
            onClick={() => {
              setLiveDevice(undefined)
              setExpanded(false)
            }}
          >
            <ArrowLeft size={15} />
          </IconButton>
          <Smartphone size={14} className="shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-xs font-medium">{liveDevice.name}</span>
          {liveDevice.kind === 'physical' && liveDevice.platform === 'ios' && (
            <PhysicalControls taskId={taskId} device={liveDevice} />
          )}
          <IconButton
            label={expanded ? 'Exit expanded view' : 'Expand preview'}
            className="size-7"
            aria-pressed={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </IconButton>
          {onClose && (
            <IconButton label="Hide preview sidebar" className="size-7 shrink-0" onClick={onClose}>
              <PanelRightClose size={15} />
            </IconButton>
          )}
        </header>
        <RemoteBrowser key={`${scope}:${liveDevice.id}`} taskId={taskId} deviceId={liveDevice.id} />
      </section>
    )
  return (
    <section
      className="flex h-full min-h-0 flex-col"
      aria-label={initialMode === 'devices' ? 'Device previews' : 'Browser previews'}
    >
      {initialMode !== 'devices' && (
        <div
          role="tablist"
          aria-label="Browser tabs"
          className="flex shrink-0 items-center gap-1 overflow-x-auto border-b bg-sidebar px-2 py-1"
        >
          {tabs.map((tab) => (
            <div key={tab.id} className="flex shrink-0 items-center rounded bg-muted/50">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                className={`max-w-36 truncate rounded px-2 py-1 text-xs ${activeTab === tab.id ? 'bg-accent text-foreground' : 'text-muted-foreground'}`}
                title={`${tab.kind === 'remote' ? 'Remote · ' : ''}${tab.url || 'New tab'}`}
                onClick={() => selectTab(tab)}
              >
                {tab.kind === 'remote' && (
                  <MonitorUp
                    size={12}
                    aria-label="Remote tab"
                    className="mr-1.5 inline-block shrink-0 text-muted-foreground"
                  />
                )}
                {tab.title ||
                  tab.url.replace(/^https?:\/\//, '') ||
                  (tab.kind === 'remote' ? 'Remote tab' : 'New tab')}
              </button>
              <IconButton
                label={`Close tab ${tab.title || tab.url || 'New tab'}`}
                className="size-6"
                disabled={busy}
                onClick={() => {
                  const remaining = tabs.filter((item) => item.id !== tab.id)
                  const next: BrowserTab[] = remaining.length
                    ? remaining
                    : [
                        {
                          id: randomUUID(),
                          url: '',
                          title: '',
                          kind: 'web',
                          profileId: 'default',
                        },
                      ]
                  setTabs(next)
                  if (activeTab === tab.id) selectTab(next[0])
                  if (tab.kind === 'remote')
                    void act(() =>
                      request(
                        '/api/previews/browser/close',
                        { taskId, tabId: tab.id, profileId: tab.profileId },
                        responses.ok,
                      ),
                    )
                  else if (browser)
                    void act(() => browser({ action: 'close', key: `${scope}:${tab.id}` }))
                }}
              >
                <X size={12} />
              </IconButton>
            </div>
          ))}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <IconButton label="New browser tab" className="size-7 shrink-0">
                <Plus size={14} />
              </IconButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="start"
                className="z-50 min-w-44 rounded-lg border bg-popover p-1 text-sm shadow-lg"
              >
                {browser ? (
                  <DropdownMenu.Sub>
                    <DropdownMenu.SubTrigger className="flex cursor-pointer items-center justify-between rounded px-2 py-1.5 outline-none focus:bg-accent">
                      New tab<span aria-hidden>›</span>
                    </DropdownMenu.SubTrigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.SubContent className="z-50 min-w-44 rounded-lg border bg-popover p-1 text-sm shadow-lg">
                        {profiles.map((profile) => (
                          <DropdownMenu.Item
                            key={profile.id}
                            className="cursor-pointer rounded px-2 py-1.5 outline-none focus:bg-accent"
                            onSelect={() => newTab('', 'web', profile.id)}
                          >
                            {profile.name}
                          </DropdownMenu.Item>
                        ))}
                      </DropdownMenu.SubContent>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Sub>
                ) : (
                  <DropdownMenu.Item
                    className="cursor-pointer rounded px-2 py-1.5 outline-none focus:bg-accent"
                    onSelect={() => newTab()}
                  >
                    New tab
                  </DropdownMenu.Item>
                )}
                <DropdownMenu.Sub>
                  <DropdownMenu.SubTrigger
                    disabled={!connected || !remoteProfiles.profiles}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none focus:bg-accent data-[disabled]:opacity-50"
                  >
                    <MonitorUp size={14} />
                    New remote tab
                    <span aria-hidden className="ml-auto">
                      ›
                    </span>
                  </DropdownMenu.SubTrigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.SubContent className="z-50 min-w-44 rounded-lg border bg-popover p-1 text-sm shadow-lg">
                      {remoteProfiles.profiles?.map((profile) => (
                        <DropdownMenu.Item
                          key={profile.id}
                          className="cursor-pointer rounded px-2 py-1.5 outline-none focus:bg-accent"
                          onSelect={() => newTab('', 'remote', profile.id)}
                        >
                          {profile.name}
                        </DropdownMenu.Item>
                      ))}
                    </DropdownMenu.SubContent>
                  </DropdownMenu.Portal>
                </DropdownMenu.Sub>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      )}
      {initialMode !== 'devices' && (mode === 'remote' || browser) && (
        <div className="flex flex-wrap items-center gap-2 border-b px-2 py-1.5 text-xs">
          <select
            aria-label="Profile for this tab"
            className="min-w-0 flex-1 rounded border bg-background p-1"
            value={profileId}
            disabled={busy || (mode === 'remote' && (!remoteProfiles.profiles || !connected))}
            onChange={(event) => {
              const next = event.target.value
              setUrl(selectedTab.url)
              setInput(selectedTab.url)
              setHistory({ url: '', title: '', cdp: undefined, back: false, forward: false })
              setTabs((previous) =>
                previous.map((tab) => (tab.id === activeTab ? { ...tab, profileId: next } : tab)),
              )
              if (mode === 'remote')
                void act(() =>
                  request(
                    '/api/previews/browser/close',
                    { taskId, tabId: activeTab, profileId },
                    responses.ok,
                  ),
                )
            }}
          >
            {!tabProfiles.some((profile) => profile.id === profileId) && (
              <option value={profileId} disabled>
                {mode === 'remote' && !remoteProfiles.profiles
                  ? 'Loading remote profiles…'
                  : 'Unavailable profile'}
              </option>
            )}
            {tabProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
          {browser && mode === 'web' && (
            <Button
              variant={agentAccess ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 px-2 text-xs"
              aria-pressed={agentAccess}
              onClick={() =>
                updateAppPreferences({
                  browserAgentAccess: { ...preferences.browserAgentAccess, [scope]: !agentAccess },
                })
              }
            >
              Agent CDP
            </Button>
          )}
          {mode === 'web' && agentAccess && history.cdp && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() =>
                void navigator.clipboard
                  .writeText(history.cdp ?? '')
                  .catch((cause) => setError(String(cause)))
              }
            >
              Copy CDP
            </Button>
          )}
        </div>
      )}
      <div className="flex h-10 shrink-0 items-center gap-1 border-b px-2 text-xs">
        {initialMode === 'devices' ? (
          <span className="inline-flex items-center gap-1.5">
            <Smartphone size={14} />
            Devices
          </span>
        ) : (
          <span className="text-muted-foreground">
            {mode === 'remote' ? 'Remote browser' : 'Browser'}
          </span>
        )}
        <span className="flex-1" />
        {onClose && (
          <IconButton label="Hide preview sidebar" className="size-7 shrink-0" onClick={onClose}>
            <PanelRightClose size={15} />
          </IconButton>
        )}
        {mode === 'web' && (
          <details className="group/viewport relative">
            <summary
              className="flex size-7 cursor-pointer list-none items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
              aria-label="Viewport options"
              title="Viewport options"
            >
              <SlidersHorizontal size={15} />
            </summary>
            <div className="absolute right-0 top-8 z-20 flex w-52 flex-col gap-1 rounded-lg border bg-popover p-2 shadow-lg">
              {browser && url && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="justify-start text-xs"
                    onClick={() =>
                      void act(() => browser({ action: 'hard-reload', key: browserKey }))
                    }
                  >
                    Hard reload
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="justify-start text-xs"
                    onClick={() => void act(() => browser({ action: 'devtools', key: browserKey }))}
                  >
                    Open DevTools
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="justify-start text-xs"
                    onClick={() =>
                      void act(() =>
                        browser({ action: 'external', key: browserKey, url: history.url || url }),
                      )
                    }
                  >
                    Open in default browser
                  </Button>
                  <div className="h-px bg-border" />
                </>
              )}
              <label className="text-xs text-muted-foreground" htmlFor="responsive-viewport">
                Viewport
              </label>
              <select
                id="responsive-viewport"
                aria-label="Viewport"
                className="rounded border bg-background p-1.5 text-xs"
                value={preset}
                onChange={(e) => setPreset(e.target.value)}
              >
                {previewPresets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant="ghost"
                disabled={preset === 'fill'}
                onClick={() => setLandscape((v) => !v)}
              >
                Rotate
              </Button>
            </div>
          </details>
        )}
      </div>
      {mode === 'web' && (
        <form
          className="flex h-10 shrink-0 items-center gap-1 border-b px-2"
          onSubmit={(e) => {
            e.preventDefault()
            navigate()
          }}
        >
          {browser &&
            (['back', 'forward'] as const).map((action) => (
              <IconButton
                key={action}
                label={action === 'back' ? 'Back' : 'Forward'}
                type="button"
                disabled={!url || mode !== 'web' || !history[action]}
                onClick={() =>
                  void act(() =>
                    browser({
                      action,
                      key: browserKey,
                    }),
                  )
                }
              >
                {action === 'back' ? <ArrowLeft size={16} /> : <ArrowRight size={16} />}
              </IconButton>
            ))}
          <Input
            onFocus={() => {
              editing.current = true
            }}
            onBlur={() => {
              editing.current = false
            }}
            aria-label="Preview URL"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="http://localhost:3000"
            className="h-8 min-w-0 flex-1 border-transparent bg-transparent text-xs shadow-none focus:border-border"
          />
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" type="submit">
            Go
          </Button>
          <IconButton
            label="Reload preview"
            type="button"
            disabled={!url}
            onClick={() =>
              browser
                ? void act(() =>
                    browser({
                      action: 'reload',
                      key: browserKey,
                    }),
                  )
                : setReload((n) => n + 1)
            }
          >
            <RotateCw size={16} />
          </IconButton>
          {url && browser && (
            <IconButton
              type="button"
              label="Open preview externally"
              onClick={() =>
                void act(() =>
                  browser({
                    action: 'external',
                    key: browserKey,
                    url: history.url || url,
                  }),
                )
              }
            >
              <ExternalLink size={16} />
            </IconButton>
          )}
          {url && !browser && (
            <a
              aria-label="Open preview externally"
              href={history.url || url}
              target="_blank"
              rel="noreferrer"
              className="p-2"
            >
              <ExternalLink size={16} />
            </a>
          )}
        </form>
      )}
      {mode === 'remote' && remoteProfiles.error && (
        <p role="alert" className="p-3 text-xs text-destructive">
          {remoteProfiles.error}
        </p>
      )}
      {error && (
        <p role="alert" className="p-3 text-xs text-destructive">
          {error}
        </p>
      )}
      {tabs
        .filter((tab) => tab.kind === 'remote')
        .map((tab) => (
          <div
            key={tab.id}
            className={
              mode === 'remote' && activeTab === tab.id ? 'flex min-h-0 flex-1 flex-col' : 'hidden'
            }
          >
            <RemoteBrowser
              key={`${tab.id}:${tab.profileId}`}
              taskId={taskId}
              profileId={tab.profileId}
              initialUrl={tab.url}
              tabId={tab.id}
              active={mode === 'remote' && activeTab === tab.id}
              reloadToken={activeTab === tab.id ? turnReload : undefined}
              onState={(state) =>
                setTabs((previous) => {
                  const url = state.url === 'about:blank' ? '' : state.url
                  if (
                    !previous.some(
                      (item) =>
                        item.id === tab.id && (item.url !== url || item.title !== state.title),
                    )
                  )
                    return previous
                  return previous.map((item) =>
                    item.id === tab.id ? { ...item, url, title: state.title } : item,
                  )
                })
              }
            />
          </div>
        ))}
      {mode === 'web' ? (
        <div className="min-h-0 flex-1 overflow-auto bg-muted/30 p-3">
          {!url ? (
            <div className="p-6 text-sm text-muted-foreground">
              Start your project’s development server, then enter its address. Local addresses use
              the selected runtime’s hostname. Remote servers must listen on a reachable interface.
            </div>
          ) : (
            <>
              {!browser && (
                <p className="mb-2 text-xs text-muted-foreground">
                  Some sites block embedded previews. Use Open externally if the page is blank.
                </p>
              )}
              <div
                ref={slot}
                className="mx-auto overflow-hidden rounded-lg border bg-white"
                style={
                  !browser && size.width
                    ? {
                        width: landscape ? size.height : size.width,
                        height: landscape ? size.width : size.height,
                      }
                    : {
                        width: '100%',
                        height: '100%',
                        minHeight: 200,
                      }
                }
              >
                {!browser && (
                  <iframe
                    key={reload}
                    title="Task browser"
                    src={url}
                    className="h-full w-full border-0"
                    sandbox="allow-scripts allow-forms allow-same-origin"
                    referrerPolicy="no-referrer"
                  />
                )}
              </div>
            </>
          )}
        </div>
      ) : mode === 'devices' ? (
        <div className="min-h-0 flex-1 overflow-auto p-2">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Choose a device</p>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || !connected}
              onClick={() => void act(loadDevices)}
            >
              Refresh
            </Button>
          </div>
          {diagnostics.map((d) => (
            <p className="mb-3 text-xs text-muted-foreground" key={d}>
              {d}
            </p>
          ))}
          {!devices.length && !busy && (
            <p className="text-sm text-muted-foreground">
              No devices found. Connect a phone to the host or create a simulator.
            </p>
          )}
          <DeviceList
            devices={devices}
            host={snapshot?.runtimeHost ?? 'This computer'}
            busy={busy}
            connected={connected}
            onOpen={setLiveDevice}
            onAction={deviceAction}
          />
          {busy && (
            <p role="status" className="py-2 text-xs">
              Working…
            </p>
          )}
          {image && (
            <figure className="mt-4">
              <figcaption className="mb-2 text-xs text-muted-foreground">
                Captured screenshot · use Screenshot to refresh
              </figcaption>
              <img
                src={image}
                alt="Simulator screenshot"
                className="max-h-[650px] max-w-full rounded-lg border"
              />
            </figure>
          )}
        </div>
      ) : null}
    </section>
  )
}
