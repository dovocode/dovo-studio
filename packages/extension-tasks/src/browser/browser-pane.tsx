import { nativeBrowserBounds, nativeBrowserOcclusion } from './native-browser-layout'
import { RuntimeIcon } from '@dovo/studio-ui/runtime-icon'
import { BrowserFavicon } from './browser-favicon'
import { BrowserProfileLabel } from './browser-profile-label'
import { BrowserExtensions } from './browser-extensions'
import { BrowserLibrary } from './browser-library'
import {
  readSharedBrowserTabs,
  readSharedBrowserLibrary,
  saveSharedBrowserLibrary,
  SHARED_BROWSER_LIBRARY_KEY,
  saveSharedBrowserTabs,
  recentBrowserTabs,
  browserAddress,
  browserPageKey,
  rememberBrowserVisit,
  type BrowserTabs,
  type BrowserTab,
} from './shared-browser-tabs'
import { SharedBrowserActions } from './shared-browser-actions'
import { randomUUID, runtimeComputerName, isPrivateBrowserProfile } from '@dovo/protocol'
import { Effect } from 'effect'
import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect, useRef, useId, type ReactNode } from 'react'
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
  Keyboard,
  X,
  Star,
  Pin,
  PinOff,
} from 'lucide-react'
import {
  useWorkspace,
  useStudioHost,
  startPolling,
  useAppPreferences,
  updateAppPreferences,
  useRemoteBrowserProfiles,
  WorkspaceScope,
} from '@dovo/studio-core'
import {
  browserSelectionSchema,
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
  useNavigationSidebar,
} from '@dovo/studio-ui'
import { useScreenshotAttachment } from './screenshot-attachment'
import { RemoteBrowser, type RemoteBrowserControls } from './remote-browser'
import { DeviceList } from './device-list'
import { PhysicalControls } from './physical-controls'
import { DeviceDeployment } from './device-deployment'
import { deviceHostSettingsResultSchema } from '@dovo/protocol'
// A popped-out thread has its own renderer and must never share main-window tabs.
const threadBrowserWindowId = randomUUID()
const addresses = new Map<string, string>()
type OpenLink = { id: string; url: string }
const savedTabs = new Map<string, BrowserTabs>()
// Extension-created pages already have a native view. Keep its identity for this renderer session.
const nativeTabKeys = new Map<string, string>()
const restorableTab = (tab: BrowserTab) =>
  !isPrivateBrowserProfile(tab.profileId) && (!tab.url || /^https?:\/\//i.test(tab.url))
export function BrowserPane({
  taskId,
  onClose,
  openLink,
  onLinkOpened,
  shared = false,
}: {
  taskId: string
  onClose?: () => void
  openLink?: OpenLink | null
  onLinkOpened?: () => void
  shared?: boolean
}) {
  return (
    <PreviewPane
      taskId={taskId}
      onClose={onClose}
      mode="remote"
      openLink={openLink}
      onLinkOpened={onLinkOpened}
      shared={shared}
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
  shared = false,
}: {
  taskId: string
  onClose?: () => void
  mode: 'remote' | 'devices'
  openLink?: OpenLink | null
  onLinkOpened?: () => void
  shared?: boolean
}) {
  const { connection } = useWorkspace()
  const { browserWindowId, threadWindow } = useStudioHost()
  // Pop-out threads must not overwrite the main browser workspace.
  const [storageWindowId] = useApplicationState(
    () => browserWindowId ?? (threadWindow ? threadBrowserWindowId : undefined),
  )
  const scope = shared
    ? `studio:browser:${storageWindowId ?? 'main'}`
    : `${connection?.address ?? ''}:${taskId}`
  return (
    <BrowserContent
      key={`${scope}:${mode}`}
      scope={scope}
      storageWindowId={storageWindowId}
      taskId={taskId}
      onClose={onClose}
      initialMode={mode}
      openLink={openLink}
      onLinkOpened={onLinkOpened}
      shared={shared}
    />
  )
}
function BrowserContent({
  scope,
  storageWindowId,
  initialMode,
  taskId,
  onClose,
  openLink,
  onLinkOpened,
  shared = false,
}: {
  scope: string
  storageWindowId?: string
  openLink?: OpenLink | null
  onLinkOpened?: () => void
  shared?: boolean
  initialMode: 'remote' | 'devices'
  taskId: string
  onClose?: () => void
}) {
  const store = useWorkspace()
  const { connection, request, connected, snapshot, runtimes, activeRuntimeId } = store,
    { browser, openBrowserWindow } = useStudioHost()
  const screenshots = useScreenshotAttachment(taskId)
  const preferences = useAppPreferences()
  const profiles = preferences.browserProfiles.length
    ? preferences.browserProfiles
    : [{ id: 'default', name: 'Default' }]
  const agentAccess = preferences.browserAgentAccess[scope] ?? false
  const [restored] = useApplicationState(() =>
    shared ? readSharedBrowserTabs(storageWindowId) : {},
  )
  const saved = savedTabs.get(scope) ?? restored.state
  const [library] = useApplicationState(() =>
    shared ? readSharedBrowserLibrary() : { bookmarks: [], visits: [], error: undefined },
  )
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
      saved?.tabs ?? [
        {
          id: randomUUID(),
          url: addresses.get(scope) ?? '',
          title: '',
          kind: browser ? 'web' : 'remote',
          runtimeId: activeRuntimeId ?? undefined,
          profileId:
            browser &&
            profiles.some((profile) => profile.id === preferences.browserProfileByThread[scope])
              ? (preferences.browserProfileByThread[scope] ?? 'default')
              : 'default',
        },
      ],
  )
  const [activeTab, setActiveTab] = useApplicationState(() => saved?.active ?? tabs[0].id)
  const [bookmarks, setBookmarks] = useApplicationState<BrowserTab[]>(() => library.bookmarks)
  const [closed, setClosed] = useApplicationState<BrowserTab[]>(() => saved?.closed ?? [])
  const [visits, setVisits] = useApplicationState<BrowserTab[]>(() => library.visits)
  const [openedTabs, setOpenedTabs] = useApplicationState(() => new Set([activeTab]))
  const currentTabs = useRef(tabs)
  currentTabs.current = tabs
  const selectedTab = tabs.find((tab) => tab.id === activeTab) ?? tabs[0]
  const selectedRuntime = selectedTab.runtimeId
    ? runtimes.find((entry) => entry.profile.id === selectedTab.runtimeId)
    : undefined
  const remoteConnected = shared ? !!selectedRuntime?.connected : connected
  const remoteProfiles = useRemoteBrowserProfiles(
    shared ? selectedRuntime?.profile : undefined,
    initialMode !== 'devices' && (!shared || (!!selectedRuntime && selectedTab.kind === 'remote')),
  )
  const tabRequest: typeof request = (path, input, schema, method) =>
    shared && selectedTab.kind === 'remote'
      ? selectedRuntime?.connected
        ? store.readRuntime(selectedRuntime.profile, path, input, schema, method)
        : Promise.reject(new Error('This tab’s computer is offline or no longer paired.'))
      : request(path, input, schema, method)
  const profileId = selectedTab.profileId ?? 'default'
  const nativeKey = (id: string) => nativeTabKeys.get(`${scope}:${id}`) ?? `${scope}:${id}`
  const browserKey = nativeKey(activeTab)
  useEffect(() => {
    if (!browser || !shared) return
    const sources = tabs.flatMap((tab) => {
      const owner = runtimes.find((entry) => entry.profile.id === tab.runtimeId)
      return tab.kind === 'remote' &&
        owner?.connected &&
        owner.profile.connection &&
        /^https?:\/\//i.test(tab.url)
        ? [
            {
              key: nativeKey(tab.id),
              tabId: tab.id,
              profileId: tab.profileId,
              title: tab.title,
              url: tab.url,
              connection: owner.profile.connection,
            },
          ]
        : []
    })
    void browser({ action: 'remote-media-sources', key: 'studio-media', sources }).catch((cause) =>
      setError(`Remote sharing sources could not be updated: ${String(cause)}`),
    )
  }, [browser, shared, tabs, runtimes])
  const openedLink = useRef('')
  const controlsId = useId()
  const [frozenPage, setFrozenPage] = useApplicationState<{
    key: string
    url: string
    image: string
  } | null>(null)
  const remote = useRef<RemoteBrowserControls>(null)
  const adoptedRemoteTabs = useRef(new Set<string>())
  const [remoteOnline, setRemoteOnline] = useApplicationState(false)
  const [streamDetails, setStreamDetails] = useApplicationState('')
  const [remoteLoading, setRemoteLoading] = useApplicationState(false)
  useEffect(() => {
    savedTabs.set(scope, { tabs, active: activeTab, closed })
  }, [scope, tabs, activeTab, closed])
  const selectTab = (tab: BrowserTab) => {
    if (tab.id === activeTab) return
    setActiveTab(tab.id)
    setOpenedTabs((previous) => new Set([...previous, tab.id]))
    setRemoteOnline(false)
    setStreamDetails('')
    setUrl(tab.url)
    setInput(tab.url)
    setHistory({ url: '', title: '', cdp: undefined, back: false, forward: false })
  }
  const newTab = (
    target = '',
    kind: BrowserTab['kind'] = browser ? 'web' : 'remote',
    profileId = 'default',
    runtimeId = activeRuntimeId ?? undefined,
    title = '',
  ) => {
    if (shared && tabs.length >= 100) {
      setError('Close a tab before opening more than 100 tabs.')
      return
    }
    if (isPrivateBrowserProfile(profileId)) profileId = `private-${randomUUID()}`
    const tab: BrowserTab = {
      id: randomUUID(),
      url: target,
      title,
      kind,
      profileId,
      runtimeId,
      visitedAt: target ? Date.now() : 0,
    }
    setTabs((previous) => [...previous, tab])
    selectTab(tab)
    return tab
  }
  const editing = useRef(false)
  const addressField = useRef<HTMLInputElement>(null)
  const mode =
    initialMode === 'devices'
      ? 'devices'
      : (tabs.find((tab) => tab.id === activeTab)?.kind ?? 'web')
  const tabProfiles = mode === 'remote' ? (remoteProfiles.profiles ?? []) : profiles
  useEffect(() => {
    if (!openLink || openedLink.current === openLink.id) return
    if (!newTab(previewUrl(openLink.url))) return
    openedLink.current = openLink.id
    onLinkOpened?.()
  }, [openLink?.id, browser, onLinkOpened, tabs.length])
  const [preset, setPreset] = useApplicationState('fill'),
    [landscape, setLandscape] = useApplicationState(false)
  const [error, setError] = useApplicationState(restored.error ?? library.error ?? ''),
    [reload, setReload] = useApplicationState(0)
  useEffect(() => {
    if (!shared) return
    try {
      // Extension pages require their existing native view; never restore stale extension URLs.
      const restorable = tabs.filter(restorableTab)
      const fallback: BrowserTab = {
        id: 'empty',
        url: '',
        title: '',
        kind: browser ? 'web' : 'remote',
        profileId: 'default',
        runtimeId: activeRuntimeId ?? undefined,
      }
      saveSharedBrowserTabs(
        {
          tabs: restorable.length ? restorable : [fallback],
          active: restorable.some((tab) => tab.id === activeTab)
            ? activeTab
            : (restorable[0]?.id ?? fallback.id),
          closed: closed.filter(restorableTab),
        },
        storageWindowId,
      )
    } catch {
      setError('Could not save browser tabs. They will remain in this session.')
    }
  }, [shared, tabs, activeTab, closed, storageWindowId, browser, activeRuntimeId])
  const lastLibrary = useRef({ bookmarks, visits })
  useEffect(() => {
    if (!shared) return
    const prior = lastLibrary.current
    if (prior.bookmarks === bookmarks && prior.visits === visits) return
    const latest = readSharedBrowserLibrary()
    if (latest.error) {
      setError(latest.error)
      return
    }
    const merged = {
      bookmarks: prior.bookmarks === bookmarks ? latest.bookmarks : bookmarks,
      visits: prior.visits === visits ? latest.visits : visits,
    }
    try {
      saveSharedBrowserLibrary(merged)
      lastLibrary.current = merged
      setBookmarks(merged.bookmarks)
      setVisits(merged.visits)
    } catch {
      setError('Could not save bookmarks and history. Keep this window open.')
    }
  }, [shared, bookmarks, visits])
  useEffect(() => {
    if (!shared) return
    const changed = (event: StorageEvent) => {
      if (event.key !== SHARED_BROWSER_LIBRARY_KEY) return
      const latest = readSharedBrowserLibrary()
      if (latest.error) {
        setError(latest.error)
        return
      }
      lastLibrary.current = latest
      setBookmarks(latest.bookmarks)
      setVisits(latest.visits)
    }
    window.addEventListener('storage', changed)
    return () => window.removeEventListener('storage', changed)
  }, [shared])
  useEffect(() => {
    if (shared && /^https?:\/\//i.test(selectedTab.url))
      setVisits((previous) => rememberBrowserVisit(previous, selectedTab))
  }, [
    shared,
    selectedTab.id,
    selectedTab.url,
    selectedTab.title,
    selectedTab.kind,
    selectedTab.profileId,
    selectedTab.runtimeId,
  ])
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
      const target = shared
        ? browserAddress(address)
        : previewUrl(address, mode === 'remote' ? undefined : connection?.address)
      if (mode === 'remote') remote.current?.input({ type: 'navigate', url: target })
      else if (target === url) {
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
        previous.map((tab) =>
          tab.id === activeTab
            ? {
                ...tab,
                url: target,
                title: '',
                ...(shared && tab.url !== target
                  ? {
                      visitedAt: Math.max(
                        Date.now(),
                        ...tabs.map((item) => (item.visitedAt ?? 0) + 1),
                      ),
                    }
                  : {}),
              }
            : tab,
        ),
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
    if (!browser || (!url && !nativeTabKeys.has(`${scope}:${activeTab}`)) || mode !== 'web') return
    let alive = true
    const poll = Effect.tryPromise({
      try: () => browser({ action: 'status', key: browserKey }),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    }).pipe(
      Effect.tap((state) =>
        Effect.sync(() => {
          if (!alive || !state) return
          if (shared) {
            const closedKeys = new Set(state.closedTabs ?? [])
            const closedIds = new Set(
              currentTabs.current
                .filter((tab) => closedKeys.has(nativeKey(tab.id)))
                .map((tab) => tab.id),
            )
            const remaining = currentTabs.current.filter((tab) => !closedIds.has(tab.id))
            const additions = (state.createdTabs ?? []).filter(
              (tab) =>
                !tab.url ||
                /^https?:\/\//i.test(tab.url) ||
                /^chrome-extension:\/\/[a-p]{32}\//.test(tab.url),
            )
            const capacity = Math.max(0, 100 - remaining.length)
            const adopted = additions.slice(0, capacity).map((tab) => {
              const id = randomUUID()
              nativeTabKeys.set(`${scope}:${id}`, tab.key)
              return {
                id,
                url: tab.url,
                title: '',
                kind: 'web' as const,
                profileId: tab.profileId,
                visitedAt: 0,
              }
            })
            const rejected = (state.createdTabs ?? []).filter(
              (tab) => !additions.slice(0, capacity).includes(tab),
            )
            for (const tab of rejected)
              void browser({ action: 'close', key: tab.key }).catch((cause) =>
                setError(`Could not close an extra extension tab: ${String(cause)}`),
              )
            if (rejected.length) setError('Close a tab before opening more extension tabs.')
            if (closedKeys.size || adopted.length) {
              const fallback: BrowserTab = {
                id: randomUUID(),
                url: '',
                title: '',
                kind: 'web',
                profileId: 'default',
              }
              const next = [...remaining, ...adopted]
              currentTabs.current = next.length ? next : [fallback]
              setTabs((previous) => {
                const kept = previous.filter((tab) => !closedIds.has(tab.id))
                const next = [...kept, ...adopted].slice(0, 100)
                return next.length ? next : [fallback]
              })
              if (closedKeys.has(browserKey)) selectTab(currentTabs.current[0])
              let foreground = -1
              additions.slice(0, capacity).forEach((tab, index) => {
                if (tab.active) foreground = index
              })
              if (foreground >= 0) selectTab(adopted[foreground])
              for (const [key, value] of nativeTabKeys)
                if (closedKeys.has(value)) nativeTabKeys.delete(key)
            }
            if (
              closedKeys.has(browserKey) ||
              additions.slice(0, capacity).some((tab) => tab.active)
            )
              return
          }
          if (
            !/^https?:\/\//i.test(state.url) &&
            state.url !== 'about:blank' &&
            !nativeTabKeys.has(`${scope}:${activeTab}`)
          )
            return
          if (shared && state.openedLinks?.length) {
            // Page-created tabs open in the background and share one bounded update.
            // Polling closes over older state, so enforce the cap against current tabs.
            const links = state.openedLinks
            setTabs((previous) => [
              ...previous,
              ...links.slice(0, Math.max(0, 100 - previous.length)).map((target) => ({
                id: randomUUID(),
                url: target,
                title: '',
                kind: 'web' as const,
                profileId,
                visitedAt: 0,
              })),
            ])
          }
          setHistory({ ...state, title: state.title ?? '', cdp: state.cdp })
          if (!editing.current) setInput(state.url === 'about:blank' ? '' : state.url)
          addresses.set(scope, state.url)
          setTabs((previous) =>
            !previous.some(
              (tab) =>
                tab.id === activeTab &&
                (tab.url !== state.url ||
                  tab.title !== (state.title ?? '') ||
                  tab.favicon !== state.favicon),
            )
              ? previous
              : previous.map((tab) =>
                  tab.id === activeTab &&
                  (tab.url !== state.url ||
                    tab.title !== state.title ||
                    tab.favicon !== state.favicon)
                    ? {
                        ...tab,
                        url: state.url === 'about:blank' ? '' : state.url,
                        title: state.title ?? '',
                        favicon: state.favicon,
                        ...(shared && tab.url !== state.url
                          ? {
                              visitedAt: Math.max(
                                Date.now(),
                                ...previous.map((item) => (item.visitedAt ?? 0) + 1),
                              ),
                            }
                          : {}),
                      }
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
  }, [browser, url, mode, scope, browserKey, profileId, shared])
  const size = previewPresets.find((p) => p.id === preset) ?? previewPresets[0]
  useEffect(() => {
    if (!browser || (!url && !nativeTabKeys.has(`${scope}:${activeTab}`)) || mode !== 'web') return
    let alive = true
    let frame: number | undefined
    let previousCommand = ''
    let revision = 0
    const update = () => {
      frame = undefined
      if (!alive) return
      const rect = slot.current && nativeBrowserBounds(slot.current)
      const occlusion = slot.current && rect && nativeBrowserOcclusion(slot.current, rect)
      const obscured = !!occlusion
      const command =
        rect && !obscured
          ? {
              action: 'show' as const,
              workspaceBrowser: shared,
              profileId,
              taskId: shared ? undefined : taskId,
              agentAccess: shared ? false : agentAccess,
              key: browserKey,
              url: url || 'about:blank',
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
              ...(occlusion === 'tooltip' ? { preserveFocus: true } : {}),
            }
      const signature = JSON.stringify(command)
      if (signature === previousCommand) return
      previousCommand = signature
      const attempt = ++revision
      if (command.action === 'hide' && obscured && rect?.width && rect.height) {
        // Capturing can stall on a busy page. Never leave the native layer above a menu
        // while waiting, and never apply a frame after that menu has already closed.
        void browser({ action: 'screenshot', key: browserKey })
          .then((captured) => {
            if (alive && revision === attempt && captured?.image)
              setFrozenPage({ key: browserKey, url, image: captured.image })
          })
          .catch(() => {
            /* A loading page may not have a frame. The native layer must still hide. */
          })
      }
      void (async () => {
        if (!alive || revision !== attempt) return
        await browser(command)
        if (alive && revision === attempt && command.action === 'show') setFrozenPage(null)
      })().catch((e) => {
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
        'data-state',
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
    if (tab.pinned) return
    if (shared && restorableTab(tab)) setClosed((previous) => [tab, ...previous].slice(0, 20))
    const remaining = tabs.filter((item) => item.id !== tab.id)
    const next: BrowserTab[] = remaining.length
      ? remaining
      : [
          {
            id: randomUUID(),
            url: '',
            title: '',
            kind: browser ? 'web' : 'remote',
            runtimeId: activeRuntimeId ?? undefined,
            profileId: 'default',
          },
        ]
    setTabs(next)
    if (activeTab === tab.id) selectTab(next[Math.min(tabs.indexOf(tab), next.length - 1)])
    if (tab.kind === 'remote')
      void act(() => {
        const owner = runtimes.find((entry) => entry.profile.id === tab.runtimeId)
        if (shared && !owner?.connected)
          throw new Error('This tab’s computer is offline. Its session will expire automatically.')
        const call: typeof request =
          shared && owner
            ? (path, input, schema, method) =>
                store.readRuntime(owner.profile, path, input, schema, method)
            : request
        return call(
          '/api/previews/browser/close',
          { taskId, tabId: tab.id, profileId: tab.profileId },
          responses.ok,
        )
      })
    else if (browser) {
      const key = nativeKey(tab.id)
      nativeTabKeys.delete(`${scope}:${tab.id}`)
      void act(() => browser({ action: 'close', key }))
    }
  }
  const openSavedPage = (tab: BrowserTab) => {
    const existing = tabs.find((item) => browserPageKey(item) === browserPageKey(tab))
    if (existing) selectTab(existing)
    else newTab(tab.url, tab.kind, tab.profileId, tab.runtimeId, tab.title)
  }
  const reopenTab = () => {
    const tab = closed[0]
    if (!tab) return
    if (newTab(tab.url, tab.kind, tab.profileId, tab.runtimeId, tab.title))
      setClosed((previous) => previous.slice(1))
  }
  const bookmarked = bookmarks.some((tab) => browserPageKey(tab) === browserPageKey(selectedTab))
  const toggleBookmark = () => {
    if (!selectedTab.url || !restorableTab(selectedTab)) return
    if (!bookmarked && bookmarks.length >= 100) {
      setError('Remove a bookmark before saving more than 100 pages.')
      return
    }
    setBookmarks((previous) =>
      bookmarked
        ? previous.filter((tab) => browserPageKey(tab) !== browserPageKey(selectedTab))
        : [...previous, { ...selectedTab }],
    )
  }
  useEffect(() => {
    if (!shared) return
    const shortcuts = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.defaultPrevented) return
      if (
        event.target instanceof Element &&
        event.target.closest('[role="dialog"], [role="alertdialog"], [role="menu"]')
      )
        return
      const key = event.key.toLowerCase()
      if (!['l', 't', 'w', 'd', 'r', 'n'].includes(key)) return
      if (key === 'n' && !openBrowserWindow) return
      event.preventDefault()
      if (key === 'l') {
        addressField.current?.focus()
        addressField.current?.select()
      }
      if (key === 't') {
        if (event.shiftKey) reopenTab()
        else {
          newTab('', selectedTab.kind, selectedTab.profileId, selectedTab.runtimeId)
          requestAnimationFrame(() => addressField.current?.focus())
        }
      }
      if (key === 'w') closeTab(selectedTab)
      if (key === 'd') toggleBookmark()
      if (key === 'n' && openBrowserWindow) void act(openBrowserWindow)
      if (key === 'r') {
        if (mode === 'remote') remote.current?.input({ type: 'reload' })
        else if (browser && url)
          void act(() =>
            browser({ action: event.shiftKey ? 'hard-reload' : 'reload', key: browserKey }),
          )
      }
    }
    window.addEventListener('keydown', shortcuts)
    return () => window.removeEventListener('keydown', shortcuts)
  })
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
          {shared && openBrowserWindow && (
            <>
              <DropdownMenu.Item
                className="cursor-pointer rounded px-2 py-1.5 outline-none focus:bg-accent"
                onSelect={() => void act(openBrowserWindow)}
              >
                New browser window
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="my-1 h-px bg-border" />
            </>
          )}
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
          <DropdownMenu.Item
            className="cursor-pointer rounded px-2 py-1.5 outline-none focus:bg-accent"
            onSelect={() =>
              newTab('', selectedTab.kind, `private-${randomUUID()}`, selectedTab.runtimeId)
            }
          >
            New private tab
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Label className="px-2 py-1 text-[0.6875rem] text-muted-foreground">
            New remote tab
          </DropdownMenu.Label>
          {shared
            ? runtimes.map((entry) => (
                <DropdownMenu.Item
                  key={entry.profile.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none focus:bg-accent data-[disabled]:opacity-50"
                  disabled={!entry.connected}
                  onSelect={() => newTab('', 'remote', 'default', entry.profile.id)}
                >
                  <MonitorUp size={14} /> {runtimeComputerName(entry)}
                  {!entry.connected ? ' · Offline' : ''}
                </DropdownMenu.Item>
              ))
            : remoteProfiles.profiles?.map((profile) => (
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
          {!shared && !remoteProfiles.profiles && (
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
      if (mode === 'remote') {
        remote.current?.screenshot()
        return
      }
      if (!browser) return
      const result = await browser({ action: 'screenshot', key: browserKey })
      if (!result?.image)
        throw new Error('Could not capture the browser. Update the desktop app and try again.')
      await screenshots.attach(result.image)
    })
  useEffect(() => {
    if (mode === 'remote' && remoteOnline) remote.current?.viewport(preset, landscape)
  }, [mode, activeTab, preset, landscape, remoteOnline])
  const browserOptions = (pageActions?: ReactNode) => (
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
          {mode === 'remote' && (
            <div className="space-y-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => remote.current?.performance()}
              >
                Connection details
              </Button>
              {streamDetails && (
                <p role="status" className="text-xs text-muted-foreground">
                  {streamDetails}
                </p>
              )}
            </div>
          )}
          {shared && (
            <div className="space-y-2">
              <p className="text-xs font-medium">Browser location</p>
              <p className="text-xs text-muted-foreground">
                Location stays with this tab. Open another tab to use a different computer.
              </p>
              <p className="text-xs">
                {mode === 'web'
                  ? 'Local · this device'
                  : `Remote · ${selectedRuntime ? runtimeComputerName(selectedRuntime) : 'Unavailable computer'}`}
              </p>
            </div>
          )}
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
                disabled={
                  busy ||
                  isPrivateBrowserProfile(profileId) ||
                  (mode === 'remote' && (!remoteProfiles.profiles || !remoteConnected))
                }
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
                      tabRequest(
                        '/api/previews/browser/close',
                        { taskId, tabId: activeTab, profileId },
                        responses.ok,
                      ),
                    )
                }}
              >
                {!tabProfiles.some((profile) => profile.id === profileId) && (
                  <option value={profileId} disabled>
                    {isPrivateBrowserProfile(profileId)
                      ? 'Private · temporary'
                      : mode === 'remote' && !remoteProfiles.profiles
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
              {!shared && browser && mode === 'web' && (
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
              {!shared && mode === 'web' && agentAccess && history.cdp && (
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

          {(mode === 'web' || mode === 'remote') && (
            <div className="flex flex-col gap-1">
              {!shared && mode === 'remote' && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="justify-start gap-2 text-xs"
                  disabled={!remoteOnline || screenshots.busy || shared}
                  onClick={takeScreenshot}
                >
                  <Camera size={14} /> Take screenshot
                </Button>
              )}
              {mode === 'web' && browser && url && (
                <>
                  {!shared && (
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
                  )}
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
          {pageActions}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="justify-start gap-2 text-xs"
            onClick={() =>
              setTabs((previous) =>
                previous.map((tab) =>
                  tab.id === activeTab ? { ...tab, pinned: !tab.pinned } : tab,
                ),
              )
            }
          >
            {selectedTab.pinned ? <PinOff size={14} /> : <Pin size={14} />}
            {selectedTab.pinned ? 'Unpin tab' : 'Pin tab'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="justify-start text-xs"
            disabled={busy || selectedTab.pinned}
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
  const renderNavigation = (pageActions?: ReactNode) => (
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
          className="size-8 shrink-0"
          disabled={
            busy || !history[action] || (mode === 'remote' ? !remoteOnline : !browser || !url)
          }
          onClick={() => {
            if (mode === 'remote') remote.current?.input({ type: action })
            else if (browser) void act(() => browser({ action, key: browserKey }))
          }}
        >
          {action === 'back' ? <ArrowLeft size={15} /> : <ArrowRight size={15} />}
        </IconButton>
      ))}
      <IconButton
        label={mode === 'remote' && !remoteOnline ? 'Reconnect' : 'Reload'}
        type="button"
        className="size-8 shrink-0"
        aria-busy={mode === 'remote' && remoteLoading}
        disabled={busy || (mode !== 'remote' && !url)}
        onClick={() =>
          mode === 'remote'
            ? remoteOnline
              ? remote.current?.input({ type: 'reload' })
              : remote.current?.reconnect()
            : browser
              ? void act(() => browser({ action: 'reload', key: browserKey }))
              : setReload((value) => value + 1)
        }
      >
        <RotateCw size={15} />
      </IconButton>
      <div className="studio-browser-address flex h-9 min-w-0 flex-1 items-center @max-[480px]/browser:order-first @max-[480px]/browser:basis-full [@media(pointer:coarse)]:h-12">
        <span className="flex w-9 shrink-0 justify-center [@media(pointer:coarse)]:w-11">
          <Globe2 size={15} className="text-muted-foreground" aria-hidden="true" />
        </span>
        <Input
          type="text"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onFocus={(event) => {
            editing.current = true
            event.currentTarget.select()
          }}
          onBlur={() => {
            editing.current = false
          }}
          ref={addressField}
          aria-label="Preview URL"
          disabled={mode === 'remote' && !remoteOnline}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={shared ? 'Search or enter address' : 'Enter website address'}
          className="h-full min-w-0 flex-1 border-0 bg-transparent px-0 text-center text-[13px] shadow-none focus:text-left focus-visible:outline-none focus-visible:ring-0 [@media(pointer:coarse)]:text-base"
        />
        <IconButton
          label="Go to address"
          type="submit"
          className="size-8 shrink-0 rounded-full [@media(pointer:coarse)]:size-11"
          disabled={!input.trim() || busy || (mode === 'remote' && !remoteOnline)}
        >
          <ArrowUpRight size={14} />
        </IconButton>
      </div>
      {mode === 'remote' && (
        <IconButton
          type="button"
          label="Keyboard"
          className="size-8 shrink-0"
          disabled={!remoteOnline}
          onClick={() => remote.current?.keyboard()}
        >
          <Keyboard size={16} />
        </IconButton>
      )}
      {shared && (
        <IconButton
          type="button"
          label={bookmarked ? 'Remove bookmark' : 'Bookmark page'}
          className="size-8 shrink-0"
          disabled={!selectedTab.url || !restorableTab(selectedTab)}
          aria-pressed={bookmarked}
          onClick={toggleBookmark}
        >
          <Star size={15} fill={bookmarked ? 'currentColor' : 'none'} />
        </IconButton>
      )}
      {shared && mode === 'web' && !isPrivateBrowserProfile(profileId) && (
        <BrowserExtensions
          key={`${profileId}:${browserKey}`}
          profileId={profileId}
          tabKey={browserKey}
          hasPage={!!url}
          profileName={
            profiles.find((profile) => profile.id === profileId)?.name ?? 'Unavailable profile'
          }
          pageUrl={history.url || url}
          onBrowseStore={() => newTab('https://chromewebstore.google.com/', 'web', profileId)}
        />
      )}
      {newTabMenu}
      {browserOptions(pageActions)}
    </form>
  )
  const navigation = shared ? (
    <SharedBrowserActions
      tabKey={browserKey}
      url={history.url || url}
      title={history.title}
      enabled={!!url && (mode === 'web' ? !!browser : remoteOnline)}
      capture={async () => {
        if (mode === 'web' && browser) {
          const value = await browser({ action: 'selection', key: browserKey })
          if (!value)
            throw new Error('Browser tab is unavailable. Update the desktop app if needed.')
          return { text: value.selection ?? '', url: value.url, title: value.title ?? '' }
        }
        return tabRequest(
          '/api/previews/browser/selection',
          { taskId, tabId: activeTab, profileId },
          browserSelectionSchema,
        )
      }}
    >
      {renderNavigation}
    </SharedBrowserActions>
  ) : (
    renderNavigation()
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
    <BrowserLayout
      devices={initialMode === 'devices'}
      sidebar={
        shared ? (
          <aside
            aria-label="Recent browser tabs"
            className="flex w-56 max-w-[35vw] shrink-0 flex-col border-r bg-sidebar"
          >
            <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3 text-sm font-medium">
              <Globe2 size={16} /> Browser {newTabMenu}
            </div>
            <div className="border-b px-2 py-1">
              <BrowserLibrary
                bookmarks={bookmarks}
                closed={closed}
                visits={visits}
                onOpen={openSavedPage}
                onReopen={reopenTab}
                onRemoveBookmark={(tab) =>
                  setBookmarks((previous) =>
                    previous.filter((item) => browserPageKey(item) !== browserPageKey(tab)),
                  )
                }
                onClearHistory={() => setVisits([])}
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {recentBrowserTabs(tabs).map((tab) => {
                const owner =
                  tab.kind === 'remote'
                    ? runtimes.find((entry) => entry.profile.id === tab.runtimeId)
                    : undefined
                const computer =
                  tab.kind === 'web'
                    ? 'This computer'
                    : owner
                      ? runtimeComputerName(owner)
                      : 'Unavailable computer'
                return (
                  <div
                    key={tab.id}
                    className={`group flex min-w-0 items-center rounded-xl border border-transparent ${activeTab === tab.id ? 'bg-accent/70' : 'hover:bg-accent/40'}`}
                  >
                    <button
                      type="button"
                      aria-current={activeTab === tab.id ? 'page' : undefined}
                      className="min-w-0 flex-1 space-y-1 px-2.5 py-2 text-left"
                      onClick={() => selectTab(tab)}
                      title={tab.url || 'New tab'}
                    >
                      <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium leading-5">
                        <BrowserFavicon tab={tab} />
                        <span className="truncate">
                          {tab.title || tab.url.replace(/^https?:\/\//, '') || 'New tab'}
                        </span>
                      </span>
                      <span className="flex min-w-0 items-center gap-1 text-xs leading-4 text-muted-foreground">
                        <RuntimeIcon
                          icon={owner?.snapshot?.runtimeIcon}
                          className="size-3 shrink-0"
                          aria-hidden="true"
                        />
                        <span className="truncate" title={computer}>
                          {tab.kind === 'web' ? 'Local' : 'Remote'} · {computer}
                        </span>
                      </span>
                      <span className="block truncate pl-4 text-xs leading-4 text-muted-foreground">
                        <BrowserProfileLabel tab={tab} />
                        {owner && !owner.connected ? ' · Offline' : ''}
                      </span>
                    </button>
                    <IconButton
                      label={`${tab.pinned ? 'Unpin' : 'Pin'} tab ${tab.title || tab.url || 'New tab'}`}
                      className={`size-7 shrink-0 ${tab.pinned ? 'text-primary' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'}`}
                      onClick={() =>
                        setTabs((previous) =>
                          previous.map((item) =>
                            item.id === tab.id ? { ...item, pinned: !item.pinned } : item,
                          ),
                        )
                      }
                    >
                      {tab.pinned ? <PinOff size={12} /> : <Pin size={12} />}
                    </IconButton>
                    {!tab.pinned && (
                      <IconButton
                        label={`Close tab ${tab.title || tab.url || 'New tab'}`}
                        className="size-7 shrink-0"
                        disabled={busy}
                        onClick={() => closeTab(tab)}
                      >
                        <X size={12} />
                      </IconButton>
                    )}
                  </div>
                )
              })}
            </div>
          </aside>
        ) : null
      }
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

      {!shared && initialMode !== 'devices' && tabs.length > 1 && (
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
                {tab.pinned && (
                  <Pin size={12} aria-label="Pinned tab" className="mr-1 inline-block" />
                )}
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
              {!tab.pinned && (
                <IconButton
                  label={`Close tab ${tab.title || tab.url || 'New tab'}`}
                  className="size-6"
                  disabled={busy}
                  onClick={() => closeTab(tab)}
                >
                  <X size={12} />
                </IconButton>
              )}
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
      {(mode === 'web' || mode === 'remote') && navigation}
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
        .filter((tab) => tab.kind === 'remote' && (!shared || openedTabs.has(tab.id)))
        .map((tab) => (
          <div
            key={tab.id}
            className={
              mode === 'remote' && activeTab === tab.id ? 'flex min-h-0 flex-1 flex-col' : 'hidden'
            }
          >
            <BrowserOwner shared={shared} runtimeId={tab.runtimeId}>
              <RemoteBrowser
                key={`${tab.id}:${tab.profileId}`}
                taskId={taskId}
                ref={activeTab === tab.id ? remote : undefined}
                externalNavigation
                onFocusAddress={() => {
                  addressField.current?.focus()
                  addressField.current?.select()
                }}
                onPerformance={setStreamDetails}
                onConnection={(online) => {
                  if (activeTab === tab.id) {
                    setRemoteOnline(online)
                    if (!online) setStreamDetails('')
                  }
                }}
                profileId={tab.profileId}
                initialUrl={tab.url}
                tabId={tab.id}
                active={mode === 'remote' && activeTab === tab.id}
                reloadToken={activeTab === tab.id ? turnReload : undefined}
                onClosed={() => closeTab(tab)}
                onState={(state) => {
                  const additions = (state.createdTabs ?? []).filter((child) => {
                    const key = JSON.stringify([tab.runtimeId, child.id])
                    if (adoptedRemoteTabs.current.has(key)) return false
                    adoptedRemoteTabs.current.add(key)
                    return !currentTabs.current.some((item) => item.id === child.id)
                  })
                  if (shared && additions.length) {
                    const capacity = Math.max(0, 100 - currentTabs.current.length)
                    const source = runtimes.find((runtime) => runtime.profile.id === tab.runtimeId)
                    for (const child of additions.slice(capacity)) {
                      if (source?.connected)
                        void store
                          .readRuntime(
                            source.profile,
                            '/api/previews/browser/close',
                            { taskId, tabId: child.id, profileId: tab.profileId },
                            responses.ok,
                          )
                          .catch((error) => setError(String(error)))
                    }
                    if (additions.length > capacity)
                      setError('Close a tab before opening more browser tabs.')
                    const adopted = additions.slice(0, capacity).map((child) => ({
                      ...tab,
                      id: child.id,
                      url: child.url,
                      title: '',
                      pinned: false,
                    }))
                    currentTabs.current = [...currentTabs.current, ...adopted]
                    setTabs((previous) => [
                      ...previous,
                      ...adopted.filter((child) => !previous.some((item) => item.id === child.id)),
                    ])
                    if (adopted.length) selectTab(adopted[adopted.length - 1])
                  }
                  if (activeTab === tab.id && !additions.length) {
                    setHistory({ ...state, cdp: undefined })
                    setRemoteLoading(state.loading)
                    setUrl(state.url === 'about:blank' ? '' : state.url)
                    if (!editing.current) setInput(state.url === 'about:blank' ? '' : state.url)
                  }
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
                      item.id === tab.id
                        ? {
                            ...item,
                            url,
                            title: state.title,
                            ...(shared && item.url !== url
                              ? {
                                  visitedAt: Math.max(
                                    Date.now(),
                                    ...previous.map((entry) => (entry.visitedAt ?? 0) + 1),
                                  ),
                                }
                              : {}),
                          }
                        : item,
                    )
                  })
                }}
              />
            </BrowserOwner>
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
                {shared
                  ? 'Open a website, then copy a selection or add it to a thread draft. Tabs stay independent of threads.'
                  : 'Open a website or preview your development server. Its browser stays with this thread.'}
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
                className="relative mx-auto overflow-hidden bg-background"
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
                {browser && frozenPage?.key === browserKey && frozenPage.url === url && (
                  <img
                    aria-hidden
                    alt=""
                    src={frozenPage.image}
                    className="pointer-events-none absolute inset-0 size-full object-fill"
                  />
                )}
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
    </BrowserLayout>
  )
}

function BrowserOwner({
  shared,
  runtimeId,
  children,
}: {
  shared: boolean
  runtimeId?: string
  children: React.ReactNode
}) {
  const { runtimes } = useWorkspace()
  if (!shared) return children
  const owner = runtimes.find((entry) => entry.profile.id === runtimeId)
  if (!owner)
    return (
      <p role="status" className="p-4 text-sm text-muted-foreground">
        This tab’s computer is no longer paired.
      </p>
    )
  return <WorkspaceScope profile={owner.profile}>{children}</WorkspaceScope>
}

function BrowserLayout({
  sidebar,
  devices,
  children,
}: {
  sidebar: React.ReactNode
  devices: boolean
  children: React.ReactNode
}) {
  const sidebarState = useNavigationSidebar()
  return (
    <section
      className="@container/browser flex h-full min-h-0 min-w-0"
      aria-label={devices ? 'Device previews' : 'Browser previews'}
    >
      {!sidebarState?.collapsed && sidebar}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </section>
  )
}
