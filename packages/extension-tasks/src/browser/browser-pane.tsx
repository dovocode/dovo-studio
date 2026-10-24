import { randomUUID, runtimeComputerName } from '@dovo/protocol'
import { Effect } from 'effect'
import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect, useRef, useId } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Maximize2,
  Minimize2,
  Smartphone,
  PanelRightClose,
  Ellipsis,
  Globe2,
  ArrowUpRight,
  Plus,
  MonitorUp,
  Camera,
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
import {
  Button,
  IconButton,
  Input,
  DropdownMenu,
  ChoicePicker,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  Popover,
} from '@dovo/studio-ui'
import { useScreenshotAttachment } from './screenshot-attachment'
import { RemoteBrowser } from './remote-browser'
import { DeviceList } from './device-list'
import { PhysicalControls } from './physical-controls'
import { DeviceDeployment } from './device-deployment'
import { deviceHostSettingsResultSchema } from '@dovo/protocol'
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
  const { connection, request, connected, snapshot, runtimes, activeRuntimeId } = useWorkspace(),
    { browser } = useStudioHost()
  const screenshots = useScreenshotAttachment(taskId)
  const preferences = useAppPreferences()
  const profiles = preferences.browserProfiles.length
    ? preferences.browserProfiles
    : [{ id: 'default', name: 'Default' }]
  const remoteProfiles = useRemoteBrowserProfiles(undefined, initialMode !== 'devices')
  const agentAccess = preferences.browserAgentAccess[scope] ?? false
  const saved = savedTabs.get(scope)
  const initialUrl =
    saved?.tabs.find((tab) => tab.id === saved.active)?.url ?? addresses.get(scope) ?? ''
  const [input, setInput] = useApplicationState(initialUrl)
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
  const controlsId = useId()
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
  const [deviceHost, setDeviceHost] = useApplicationState('all')
  const filteredDevices = devices.filter(
    (device) =>
      deviceHost === 'all' ||
      (deviceHost === 'local' ? !device.hostId : device.hostId === deviceHost),
  )
  const [deviceHosts, setDeviceHosts] = useApplicationState<
    typeof deviceHostSettingsResultSchema.Type.hosts
  >([])
  const [hubEnabled, setHubEnabled] = useApplicationState<boolean | null>(null)
  const initializedDeviceHost = useRef(false)
  const [liveDevice, setLiveDevice] = useApplicationState<PreviewDevice | undefined>(undefined)
  const [deploymentDevice, setDeploymentDevice] = useApplicationState<PreviewDevice | undefined>(
    undefined,
  )
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
    const hosts = await request(
      '/api/device-hosts',
      undefined,
      deviceHostSettingsResultSchema,
      'GET',
    )
    if (!mount.current) return
    setHubEnabled(hosts.enabled ?? false)
    setDeviceHosts(hosts.hosts)
    if (!initializedDeviceHost.current) {
      initializedDeviceHost.current = true
      setDeviceHost(hosts.defaultHostId ?? 'all')
    }
    if (!hosts.enabled) {
      setDevices([])
      setDiagnostics([])
      return
    }
    const result = await request('/api/previews/devices', { taskId }, previewDevicesSchema)
    if (mount.current) {
      setDevices(result.devices)
      setDiagnostics(result.diagnostics)
    }
  }
  useEffect(() => {
    if (initialMode === 'devices' && connected) void act(loadDevices)
  }, [initialMode, connected])
  const navigate = (address = input) => {
    try {
      const target = previewUrl(address, connection?.address)
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
    let frame: number | undefined
    let previousCommand = ''
    const update = () => {
      frame = undefined
      if (!alive) return
      const rect = slot.current?.getBoundingClientRect()
      // Native views sit above the DOM. Hide them for visible overlays, but not
      // for disclosures retained in the hidden chat or panels elsewhere in the window.
      const obscured =
        rect &&
        [
          ...document.querySelectorAll<HTMLElement>(
            'details[open], dialog[open], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-preview-dragging="true"], [data-inline-artifact] [data-preview-overlay="true"]',
          ),
        ].some((element) => {
          if (
            (element.contains(slot.current) &&
              !element.matches('[data-preview-dragging="true"]')) ||
            !element.checkVisibility({ visibilityProperty: true })
          )
            return false
          const overlay = element.getBoundingClientRect()
          if (!overlay.width || !overlay.height) return false
          if (element.matches('dialog[open], [aria-modal="true"]')) return true
          return (
            overlay.left < rect.right &&
            overlay.right > rect.left &&
            overlay.top < rect.bottom &&
            overlay.bottom > rect.top
          )
        })
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
      const signature = JSON.stringify(command)
      if (signature === previousCommand) return
      previousCommand = signature
      void browser(command).catch((e) => {
        if (previousCommand === signature) previousCommand = ''
        if (alive) setError(String(e))
      })
    }
    const schedule = () => {
      frame ??= requestAnimationFrame(update)
    }
    const resize = new ResizeObserver(schedule),
      mutations = new MutationObserver(schedule)
    if (slot.current) resize.observe(slot.current)
    mutations.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        'open',
        'hidden',
        'style',
        'class',
        'role',
        'aria-modal',
        'data-preview-dragging',
        'data-preview-overlay',
      ],
    })
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    update()
    return () => {
      alive = false
      if (frame !== undefined) cancelAnimationFrame(frame)
      resize.disconnect()
      mutations.disconnect()
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
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
      if (action === 'screenshot' && !result.image)
        throw new Error('The device did not return a screenshot. Please try again.')
      if (mount.current && result.image) {
        setImage(result.image)
        if (action === 'screenshot') await screenshots.attach(result.image)
      }
      await loadDevices()
    })
  const closeTab = (tab: BrowserTab) => {
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
    if (activeTab === tab.id) selectTab(next[Math.min(tabs.indexOf(tab), next.length - 1)])
    if (tab.kind === 'remote')
      void act(() =>
        request(
          '/api/previews/browser/close',
          { taskId, tabId: tab.id, profileId: tab.profileId },
          responses.ok,
        ),
      )
    else if (browser) void act(() => browser({ action: 'close', key: `${scope}:${tab.id}` }))
  }
  const newTabMenu = (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <IconButton type="button" label="New browser tab" className="ml-auto size-7 shrink-0">
          <Plus size={14} />
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          collisionPadding={8}
          className="z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-44 overflow-y-auto rounded-lg border bg-popover p-1 text-sm shadow-lg"
        >
          <DropdownMenu.Label className="px-2 py-1 text-[0.6875rem] text-muted-foreground">
            New tab
          </DropdownMenu.Label>
          {browser ? (
            profiles.map((profile) => (
              <DropdownMenu.Item
                key={profile.id}
                aria-label={`New local tab · ${profile.name}`}
                className="cursor-pointer rounded px-2 py-1.5 outline-none focus:bg-accent"
                onSelect={() => newTab('', 'web', profile.id)}
              >
                {profile.name}
              </DropdownMenu.Item>
            ))
          ) : (
            <DropdownMenu.Item
              className="cursor-pointer rounded px-2 py-1.5 outline-none focus:bg-accent"
              onSelect={() => newTab()}
            >
              New tab
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Label className="px-2 py-1 text-[0.6875rem] text-muted-foreground">
            New remote tab
          </DropdownMenu.Label>
          {remoteProfiles.profiles?.map((profile) => (
            <DropdownMenu.Item
              key={profile.id}
              aria-label={`New remote tab · ${profile.name}`}
              disabled={!connected}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none focus:bg-accent data-[disabled]:opacity-50"
              onSelect={() => newTab('', 'remote', profile.id)}
            >
              <MonitorUp size={14} /> {profile.name}
            </DropdownMenu.Item>
          ))}
          {!remoteProfiles.profiles && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              {remoteProfiles.error || 'Loading remote profiles…'}
            </p>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
  const takeScreenshot = () =>
    void act(async () => {
      if (!browser) return
      const result = await browser({ action: 'screenshot', key: browserKey })
      if (!result?.image)
        throw new Error('Could not capture the browser. Update the desktop app and try again.')
      await screenshots.attach(result.image)
    })
  const browserOptions = (
    <Popover.Root>
      <Popover.Trigger asChild>
        <IconButton type="button" label="Browser options" className="size-8 shrink-0">
          <Ellipsis size={16} />
        </IconButton>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          collisionPadding={8}
          aria-label="Browser settings"
          className="z-50 flex max-h-[var(--radix-popover-content-available-height)] w-72 max-w-[calc(100vw-1rem)] flex-col gap-3 overflow-y-auto rounded-xl border bg-popover p-3 text-popover-foreground shadow-xl"
        >
          <div className="space-y-1 px-1">
            <h2 className="text-sm font-medium">Browser settings</h2>
            <p className="text-xs text-muted-foreground">
              {mode === 'remote'
                ? 'Runs on the connected computer'
                : browser
                  ? 'Runs on this computer'
                  : 'Embedded website preview'}
            </p>
          </div>
          {(mode === 'remote' || browser) && (
            <div className="flex flex-col gap-2 text-xs">
              <label htmlFor={`${controlsId}-profile`} className="text-xs text-muted-foreground">
                Browser profile
              </label>
              <select
                id={`${controlsId}-profile`}
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
                    previous.map((tab) =>
                      tab.id === activeTab ? { ...tab, profileId: next } : tab,
                    ),
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
                  type="button"
                  variant={agentAccess ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-7 px-2 text-xs"
                  aria-pressed={agentAccess}
                  onClick={() =>
                    updateAppPreferences({
                      browserAgentAccess: {
                        ...preferences.browserAgentAccess,
                        [scope]: !agentAccess,
                      },
                    })
                  }
                >
                  Agent browser access
                </Button>
              )}
              {mode === 'web' && agentAccess && history.cdp && (
                <Button
                  type="button"
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

          {mode === 'web' && (
            <div className="flex flex-col gap-1">
              {browser && url && (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="justify-start gap-2 text-xs"
                    disabled={busy || screenshots.busy || !connected}
                    onClick={takeScreenshot}
                  >
                    <Camera size={14} /> Take screenshot
                  </Button>
                  <Button
                    type="button"
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
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="justify-start text-xs"
                    onClick={() => void act(() => browser({ action: 'devtools', key: browserKey }))}
                  >
                    Open DevTools
                  </Button>
                  <Button
                    type="button"
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
              <label className="text-xs text-muted-foreground" htmlFor={`${controlsId}-viewport`}>
                Viewport
              </label>
              <select
                id={`${controlsId}-viewport`}
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
                type="button"
                size="sm"
                variant="ghost"
                disabled={preset === 'fill'}
                onClick={() => setLandscape((v) => !v)}
              >
                Rotate
              </Button>

              {!browser && url && (
                <a
                  aria-label="Open preview externally"
                  href={history.url || url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded px-2 py-1.5 text-xs hover:bg-accent"
                >
                  Open in default browser
                </a>
              )}
            </div>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="justify-start text-xs"
            disabled={busy}
            onClick={() => closeTab(selectedTab)}
          >
            Close current tab
          </Button>
          {onClose && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="justify-start text-xs"
              onClick={onClose}
            >
              Hide preview sidebar
            </Button>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
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
          <DeviceDeployment key={liveDevice.id} taskId={taskId} device={liveDevice} />
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
      className="@container/browser flex h-full min-h-0 flex-col"
      aria-label={initialMode === 'devices' ? 'Device previews' : 'Browser previews'}
    >
      {screenshots.editor}
      {screenshots.error && (
        <p role="alert" className="p-2 text-xs text-destructive">
          {screenshots.error}
        </p>
      )}
      {deploymentDevice && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setDeploymentDevice(undefined)
          }}
        >
          <DialogContent className="max-h-[85vh] overflow-auto">
            <DialogTitle>Run app · {deploymentDevice.name}</DialogTitle>
            <DialogDescription>
              {deploymentDevice.hostName ?? 'This computer'} · Install a build or connect its
              development server.
            </DialogDescription>
            <DeviceDeployment
              key={deploymentDevice.id}
              taskId={taskId}
              device={deploymentDevice}
              inline
            />
          </DialogContent>
        </Dialog>
      )}

      {initialMode !== 'devices' && tabs.length > 1 && (
        <div
          role="tablist"
          aria-label="Browser tabs"
          className="flex shrink-0 items-center gap-1 overflow-x-auto border-b bg-sidebar/60 px-2 pt-2 pb-1"
        >
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={`flex min-w-0 shrink-0 items-center rounded-lg border ${activeTab === tab.id ? 'border-border/60 bg-background shadow-sm' : 'border-transparent'}`}
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                tabIndex={activeTab === tab.id ? 0 : -1}
                className={`max-w-44 truncate rounded-lg px-2.5 py-2 text-xs ${activeTab === tab.id ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                onKeyDown={(event) => {
                  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                  event.preventDefault()
                  const index =
                    event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? tabs.length - 1
                        : (tabs.indexOf(tab) +
                            (event.key === 'ArrowRight' ? 1 : -1) +
                            tabs.length) %
                          tabs.length
                  selectTab(tabs[index])
                  const target = event.currentTarget
                    .closest('[role="tablist"]')
                    ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]
                  target?.focus({ preventScroll: true })
                  target?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
                }}
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
                onClick={() => closeTab(tab)}
              >
                <X size={12} />
              </IconButton>
            </div>
          ))}
        </div>
      )}
      {initialMode === 'devices' && (
        <div className="flex h-10 shrink-0 items-center gap-1 border-b px-2 text-xs">
          <span className="inline-flex flex-1 items-center gap-1.5">
            <Smartphone size={14} /> Devices
          </span>
          {onClose && (
            <IconButton label="Hide preview sidebar" className="size-7 shrink-0" onClick={onClose}>
              <PanelRightClose size={15} />
            </IconButton>
          )}
        </div>
      )}
      {mode === 'web' && (
        <form
          aria-label="Browser navigation"
          className="flex min-h-12 shrink-0 items-center gap-1 border-b bg-sidebar/50 px-2 py-2 @max-[480px]/browser:flex-wrap"
          onSubmit={(event) => {
            event.preventDefault()
            navigate()
          }}
        >
          {(['back', 'forward'] as const).map((action) => (
            <IconButton
              key={action}
              label={action === 'back' ? 'Back' : 'Forward'}
              type="button"
              className="size-7 shrink-0"
              disabled={!browser || !url || !history[action] || busy}
              onClick={() => {
                if (browser) void act(() => browser({ action, key: browserKey }))
              }}
            >
              {action === 'back' ? <ArrowLeft size={15} /> : <ArrowRight size={15} />}
            </IconButton>
          ))}
          <IconButton
            label="Reload preview"
            type="button"
            className="size-7 shrink-0"
            disabled={!url || busy}
            onClick={() =>
              browser
                ? void act(() => browser({ action: 'reload', key: browserKey }))
                : setReload((value) => value + 1)
            }
          >
            <RotateCw size={15} />
          </IconButton>
          <div className="flex h-8 min-w-0 flex-1 items-center gap-1 @max-[480px]/browser:order-first @max-[480px]/browser:basis-full [@media(pointer:coarse)]:h-11 rounded-lg border border-transparent bg-muted/70 pl-2 focus-within:border-ring/50 focus-within:ring-2 focus-within:ring-ring/10">
            <Globe2 size={13} className="shrink-0 text-muted-foreground" aria-hidden="true" />
            <Input
              type="text"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              onFocus={() => {
                editing.current = true
              }}
              onBlur={() => {
                editing.current = false
              }}
              aria-label="Preview URL"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Enter a URL or localhost:3000"
              className="h-full min-w-0 flex-1 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0"
            />
            <IconButton
              label="Go to address"
              type="submit"
              className="size-7 shrink-0"
              disabled={!input.trim() || busy}
            >
              <ArrowUpRight size={14} />
            </IconButton>
          </div>
          {newTabMenu}
          {browserOptions}
        </form>
      )}
      {mode === 'remote' && (
        <div className="flex min-h-10 shrink-0 items-center gap-1 border-b bg-sidebar/50 px-2 py-1">
          <MonitorUp size={14} className="mx-1 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-xs font-medium">
            {tabProfiles.find((profile) => profile.id === profileId)?.name ?? 'Host browser'}
          </span>
          {newTabMenu}
          {browserOptions}
        </div>
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
        <div className="min-h-0 flex-1 overflow-auto">
          {!url ? (
            <div className="flex min-h-full flex-col items-center justify-center px-6 py-10 text-center text-sm text-muted-foreground">
              <div className="mb-5 flex size-14 items-center justify-center rounded-2xl border border-border/60 bg-muted/40 text-foreground">
                <Globe2 size={24} strokeWidth={1.5} />
              </div>
              <h2 className="text-lg font-semibold tracking-tight text-foreground">
                Your project, live.
              </h2>
              <p className="mt-2 max-w-64 text-xs leading-relaxed">
                Open a website or preview your development server. Its browser stays with this
                thread.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {['localhost:3000', 'localhost:5173'].map((address) => (
                  <Button
                    key={address}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-2 text-xs font-normal"
                    onClick={() => navigate(address)}
                  >
                    <Globe2 size={12} />
                    {address}
                  </Button>
                ))}
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                Enter an address above and press Enter.
              </p>
            </div>
          ) : (
            <>
              {!browser && (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  Some sites block embedded previews. Use Open externally if the page is blank.
                </p>
              )}
              <div
                ref={slot}
                className="mx-auto overflow-hidden bg-background"
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
              type="button"
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
          {hubEnabled && deviceHosts.length > 0 && (
            <label className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
              Device host
              <ChoicePicker
                aria-label="Device host"
                value={deviceHost}
                disabled={busy}
                onValueChange={setDeviceHost}
                className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5 text-foreground"
              >
                <option value="all">All computers</option>
                <option value="local">This computer</option>
                {deviceHosts.map((host) => (
                  <option key={host.id} value={host.id}>
                    {host.name}
                  </option>
                ))}
              </ChoicePicker>
            </label>
          )}
          {hubEnabled === false && (
            <p className="mb-3 text-sm text-muted-foreground">
              Device Hub is off. Enable it in Settings → Computers → Device previews.
            </p>
          )}
          {hubEnabled && !filteredDevices.length && !busy && (
            <p className="text-sm text-muted-foreground">
              No devices found. Connect a phone to the host or create a simulator.
            </p>
          )}
          <DeviceList
            devices={filteredDevices}
            host={runtimeComputerName({
              profile: runtimes.find((entry) => entry.profile.id === activeRuntimeId)?.profile,
              snapshot,
            })}
            busy={busy}
            connected={connected}
            onOpen={setLiveDevice}
            onAction={deviceAction}
            onDeploy={setDeploymentDevice}
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
