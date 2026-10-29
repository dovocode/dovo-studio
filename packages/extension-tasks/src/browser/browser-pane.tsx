import { browserPageFavicon } from '@dovo/protocol'
import { flushSync } from 'react-dom'
import { nativeBrowserBounds, nativeBrowserOcclusion } from './native-browser-layout'
import { BrowserTabRow } from './browser-tab-row'
import { BrowserSiteControls } from './browser-site-controls'
import { BrowserExtensions } from './browser-extensions'
import { BrowserLibrary } from './browser-library'
import {
  readSharedBrowserTabs,
  readSharedBrowserLibrary,
  saveSharedBrowserLibrary,
  SHARED_BROWSER_LIBRARY_KEY,
  saveSharedBrowserTabs,
  recentBrowserTabs,
  reorderBrowserTabs,
  browserTabDragGroup,
  browserAddress,
  browserPageKey,
  rememberBrowserVisit,
  type BrowserTabs,
  type BrowserTab,
} from './shared-browser-tabs'
import { SharedBrowserActions } from './shared-browser-actions'
import { BrowserThreadPanel } from './browser-thread-panel'
import { WebsiteCustomizationEditor } from './website-customization-editor'
import { websiteCustomizationPrompt } from '@dovo/protocol'
import { ResizableSidebar } from '../detail/resizable-sidebar'
import {
  randomUUID,
  runtimeComputerName,
  browserLinkProfile,
  isPrivateBrowserProfile,
  browserTabCategory,
  wakeBrowserTab,
  settleBrowserTab,
  snoozeBrowserTab,
  tomorrowBrowserTabWake,
  cleanBrowserTabs,
  browserTabActivitySchema,
  type BrowserTabCategory,
  type BrowserTabState,
  type BrowserWebsiteCustomization,
} from '@dovo/protocol'
import { Effect } from 'effect'
import { useApplicationState } from '@dovo/studio-core/state'
import {
  useEffect,
  useRef,
  useId,
  useState,
  type DragEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import {
  Home,
  ChevronDown,
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
  MessageSquare,
  Paintbrush,
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
import { BrowserFindBar } from './browser-find-bar'
import { FloatingPreview, type PreviewPlacement } from '../detail/floating-preview'
import { deviceHostSettingsResultSchema } from '@dovo/protocol'
// A popped-out thread has its own renderer and must never share main-window tabs.
const threadBrowserWindowId = randomUUID()
const addresses = new Map<string, string>()
type OpenLink = { id: string; url: string; remote?: boolean }
type BrowserPreviewBackground = { tabId: string; url: string; title: string; image?: string }
const savedTabs = new Map<string, BrowserTabs>()
// Extension-created pages already have a native view. Keep its identity for this renderer session.
const nativeTabKeys = new Map<string, string>()
const restorableTab = (tab: BrowserTab) =>
  !tab.previewOf &&
  !isPrivateBrowserProfile(tab.profileId) &&
  (!tab.url || /^https?:\/\//i.test(tab.url))
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
    { browser, browserFrames, openBrowserWindow, onBrowserContextAction } = useStudioHost()
  const screenshots = useScreenshotAttachment(taskId)
  const runtimesRef = useRef(runtimes)
  runtimesRef.current = runtimes
  const preferences = useAppPreferences()
  const sortByActivity = preferences.browserSortByActivity !== false
  const [draggingTab, setDraggingTab] = useState<string | null>(null)
  const [tabDrop, setTabDrop] = useState<{ id: string; edge: 'before' | 'after' } | null>(null)
  const profiles = preferences.browserProfiles.length
    ? preferences.browserProfiles
    : [{ id: 'default', name: 'Default' }]
  const agentAccess = preferences.browserAgentAccess[scope] ?? false
  const previewLinks = useRef(true)
  previewLinks.current = preferences.browserLinkOpening !== 'tab'
  const [homeEditor, setHomeEditor] = useApplicationState<{ tabId: string; url: string } | null>(
    null,
  )
  const [homeError, setHomeError] = useApplicationState('')
  const [homeRequest, setHomeRequest] = useApplicationState<{ tabId: string; url: string } | null>(
    null,
  )
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
          runtimeId: (browser ? store.localRuntimeId : activeRuntimeId) ?? undefined,
          profileId:
            browser &&
            profiles.some((profile) => profile.id === preferences.browserProfileByThread[scope])
              ? (preferences.browserProfileByThread[scope] ?? 'default')
              : 'default',
        },
      ],
  )
  const [activeTab, setActiveTab] = useApplicationState(() => saved?.active ?? tabs[0].id)
  const activeTabRef = useRef(activeTab)
  activeTabRef.current = activeTab
  const [clock, setClock] = useApplicationState(() => Date.now())
  const [bookmarks, setBookmarks] = useApplicationState<BrowserTab[]>(() => library.bookmarks)
  const [closed, setClosed] = useApplicationState<BrowserTab[]>(() => saved?.closed ?? [])
  const [visits, setVisits] = useApplicationState<BrowserTab[]>(() => library.visits)
  const [openedTabs, setOpenedTabs] = useApplicationState(() => new Set([activeTab]))
  const currentTabs = useRef(tabs)
  currentTabs.current = tabs
  const selectedTab = tabs.find((tab) => tab.id === activeTab) ?? tabs[0]
  const tabRuntimeId = selectedTab.kind === 'web' ? store.localRuntimeId : selectedTab.runtimeId
  useEffect(() => {
    if (!shared || !browser || !store.localRuntimeId) return
    setTabs((previous) =>
      previous.map((tab) =>
        tab.kind === 'web' && tab.runtimeId !== store.localRuntimeId
          ? { ...tab, runtimeId: store.localRuntimeId ?? undefined }
          : tab,
      ),
    )
  }, [shared, browser, store.localRuntimeId])
  const regularTabs = tabs.filter((tab) => !tab.previewOf)
  const [threadPanels, setThreadPanels] = useApplicationState(
    () => new Set(tabs.filter((tab) => tab.thread).map((tab) => tab.id)),
  )
  const [customization, setCustomization] = useApplicationState<BrowserWebsiteCustomization | null>(
    null,
  )
  const [customizationInsert, setCustomizationInsert] = useApplicationState<{
    tabId: string
    id: string
    text: string
  } | null>(null)
  const [previewPlacement, setPreviewPlacement] = useApplicationState<PreviewPlacement>('floating')
  const [previewBackground, setPreviewBackground] =
    useApplicationState<BrowserPreviewBackground | null>(null)
  const previewImage = useRef<HTMLImageElement>(null)
  const previewRequest = useRef(0)
  const [pendingPreview, setPendingPreview] = useApplicationState<string | undefined>(undefined)
  useEffect(() => {
    if (!selectedTab.previewOf) setPreviewBackground(null)
    return () => {
      previewRequest.current++
    }
  }, [selectedTab.previewOf])
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
  const routingProfiles = useRef(profiles)
  routingProfiles.current = profiles
  const awakeCommands = useRef(new Map<string, string>())
  const [tabStates, setTabStates] = useState<BrowserTabState[]>([])
  useEffect(() => {
    if (!shared || !browser) return
    for (const tab of tabs) {
      if (tab.kind !== 'web' || !/^https?:\/\//i.test(tab.url)) continue
      const key = nativeKey(tab.id)
      if (!tab.keepAwake && !awakeCommands.current.has(key)) continue
      const command = {
        action: 'keep-awake' as const,
        key,
        enabled: !!tab.keepAwake,
        url: tab.url,
        profileId: tab.profileId,
      }
      const signature = JSON.stringify(command)
      if (awakeCommands.current.get(key) === signature) continue
      awakeCommands.current.set(key, signature)
      void browser(command).catch((cause) => {
        awakeCommands.current.delete(key)
        setError(`Could not update Keep awake: ${String(cause)}`)
      })
    }
  }, [browser, shared, tabs])
  const browserKey = nativeKey(activeTab)
  const [findOpen, setFindOpen] = useState(false)
  const [findRequest, setFindRequest] = useState(0)
  const [pageRevision, setPageRevision] = useState(0)
  useEffect(
    () =>
      onBrowserContextAction?.((action) => {
        if (action.action === 'close-find' && action.key === browserKey) setFindOpen(false)
        if (action.action === 'find' && action.key === browserKey) {
          setFindOpen(true)
          setFindRequest((value) => value + 1)
        }
      }),
    [onBrowserContextAction, browserKey],
  )
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
              // Picker metadata must fit the native command without changing the page.
              title: tab.title.slice(0, 200),
              url: tab.url.slice(0, 8192),
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
  const frozenImage = useRef<HTMLImageElement>(null)
  const previewSource = tabs.find((tab) => tab.id === previewBackground?.tabId)
  const previewSourceKey = previewSource?.kind === 'web' ? nativeKey(previewSource.id) : undefined
  useEffect(() => {
    if (!selectedTab.previewOf || !previewSourceKey || !browserFrames) return
    return browserFrames(previewSourceKey, (frame) => {
      if (previewImage.current) previewImage.current.src = frame.image
      else
        setPreviewBackground((previous) =>
          previous ? { ...previous, image: frame.image } : previous,
        )
    })
  }, [browserFrames, selectedTab.previewOf, previewSourceKey])
  const remote = useRef<RemoteBrowserControls>(null)
  const adoptedRemoteTabs = useRef(new Set<string>())
  const [remoteOnline, setRemoteOnline] = useApplicationState(false)
  const [streamDetails, setStreamDetails] = useApplicationState('')
  const [remoteLoading, setRemoteLoading] = useApplicationState(false)
  useEffect(() => {
    savedTabs.set(scope, { tabs, active: activeTab, closed })
  }, [scope, tabs, activeTab, closed])
  const selectTab = (tab: BrowserTab) => {
    previewRequest.current++
    setPendingPreview(undefined)
    if (tab.id === activeTab) return
    const now = Date.now()
    setTabs((previous) =>
      previous.map((item) =>
        item.id === tab.id
          ? wakeBrowserTab(item, now)
          : item.id === activeTab
            ? { ...item, lastActiveAt: now }
            : item,
      ),
    )
    setActiveTab(tab.id)
    setOpenedTabs((previous) => new Set([...previous, tab.id]))
    setRemoteOnline(false)
    setStreamDetails('')
    setUrl(tab.url)
    setInput(tab.url)
    setHistory({ url: '', title: '', cdp: undefined, back: false, forward: false })
  }
  const showLinkPreview = async (tab: BrowserTab, source = selectedTab) => {
    if (!previewLinks.current) {
      selectTab(tab)
      return
    }
    const attempt = ++previewRequest.current
    setPendingPreview(tab.id)
    // Nested previews retain the original page, rather than replacing it with the last overlay.
    if (!source.previewOf || !previewBackground) {
      let timeout: ReturnType<typeof setTimeout> | undefined
      let image: string | undefined
      try {
        image = await Promise.race([
          source.kind === 'web' && browser
            ? browser({ action: 'screenshot', key: nativeKey(source.id) }).then(
                (result) => result?.image,
              )
            : (remote.current?.capture() ?? Promise.resolve(undefined)),
          new Promise<undefined>((resolve) => {
            timeout = setTimeout(() => resolve(undefined), 500)
          }),
        ])
        if (image) {
          const decoded = new Image()
          decoded.src = image
          await decoded.decode()
        }
      } catch {
        // A loading or unavailable page must not block opening its link.
        image = undefined
      } finally {
        clearTimeout(timeout)
      }
      if (attempt !== previewRequest.current) return
      setPreviewBackground({ tabId: source.id, url: source.url, title: source.title, image })
    }
    if (attempt !== previewRequest.current) return
    setPreviewPlacement('floating')
    selectTab(tab)
  }
  const newTab = (
    target = '',
    kind: BrowserTab['kind'] = browser ? 'web' : 'remote',
    profileId = 'default',
    runtimeId = (kind === 'web' ? store.localRuntimeId : activeRuntimeId) ?? undefined,
    title = '',
    favicon?: string,
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
      favicon,
      kind,
      profileId,
      runtimeId: kind === 'web' ? (store.localRuntimeId ?? undefined) : runtimeId,
      visitedAt: target ? Date.now() : 0,
      lastActiveAt: Date.now(),
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
  useEffect(() => setFindOpen(false), [browserKey, mode])
  const tabProfiles = mode === 'remote' ? (remoteProfiles.profiles ?? []) : profiles
  useEffect(() => setCustomization(null), [activeTab, profileId])
  const websiteProfile = tabProfiles.find((profile) => profile.id === profileId)
  const websiteOrigin = (() => {
    try {
      const target = new URL(history.url || url)
      return /^https?:$/.test(target.protocol) ? target.origin : undefined
    } catch {
      return undefined
    }
  })()
  useEffect(() => setCustomization(null), [websiteOrigin])
  const customizeWebsite = () => {
    if (!websiteOrigin) return
    setCustomization(
      websiteProfile?.websites?.find((site) => site.origin === websiteOrigin) ?? {
        origin: websiteOrigin,
        enabled: true,
        css: '',
        script: '',
      },
    )
  }
  const customizeWithAgent = (website: BrowserWebsiteCustomization) => {
    setCustomization(null)
    setCustomizationInsert({
      tabId: activeTab,
      id: randomUUID(),
      text: websiteCustomizationPrompt(profileId, website, history.url || url),
    })
    setThreadPanels((previous) => new Set([...previous, activeTab]))
  }
  const saveWebsiteCustomization = async (website: BrowserWebsiteCustomization | null) => {
    if (!customization || !websiteProfile) throw new Error('This browser profile is unavailable.')
    const websites = [
      ...(websiteProfile.websites ?? []).filter((site) => site.origin !== customization.origin),
      ...(website ? [website] : []),
    ]
    const next = tabProfiles.map((profile) =>
      profile.id === profileId ? { ...profile, websites } : profile,
    )
    if (mode === 'web') {
      updateAppPreferences({ browserProfiles: next })
      if (browser) await browser({ action: 'reload', key: browserKey })
    } else {
      await remoteProfiles.save(next)
      setTurnReload((previous) => previous + 1)
    }
  }
  useEffect(() => {
    if (!openLink || openedLink.current === openLink.id) return
    if (
      !newTab(
        previewUrl(openLink.url),
        browser && !openLink.remote ? 'web' : 'remote',
        browser && !openLink.remote
          ? (browserLinkProfile(openLink.url, profiles) ?? 'default')
          : 'default',
      )
    )
      return
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
      let source = selectedTab
      const seen = new Set<string>()
      while (source.previewOf && !seen.has(source.id)) {
        seen.add(source.id)
        const parent = tabs.find((tab) => tab.id === source.previewOf)
        if (!parent) break
        source = parent
      }
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
            : (restorable.find((tab) => tab.id === source.id)?.id ??
              restorable[0]?.id ??
              fallback.id),
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
    selectedTab.previewOf,
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
      if (shared && mode === 'remote' && !remoteProfiles.profiles)
        throw new Error(
          remoteProfiles.error || 'Browser profiles are still loading on this computer.',
        )
      const target = shared
        ? browserAddress(
            address,
            (websiteProfile ?? tabProfiles.find((profile) => profile.id === 'default'))?.search,
          )
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
    if (
      !browser ||
      (!shared && ((!url && !nativeTabKeys.has(`${scope}:${activeTab}`)) || mode !== 'web'))
    )
      return
    let alive = true
    const poll = Effect.tryPromise({
      try: () =>
        browser({
          action: 'status',
          key: browserKey,
          ...(shared ? { tabCount: currentTabs.current.length } : {}),
        }),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    }).pipe(
      Effect.tap((state) =>
        Effect.sync(() => {
          if (!alive || !state) return
          setPageRevision(state.documentRevision ?? 0)
          if (shared) {
            if (state.tabStates) setTabStates(state.tabStates)
            if (state.faviconUpdates?.length) {
              setTabs((previous) =>
                previous.map((tab) => {
                  const update = state.faviconUpdates?.find(
                    (item) => item.key === nativeKey(tab.id) && item.url === tab.url,
                  )
                  return update && tab.favicon !== (update.favicon ?? undefined)
                    ? { ...tab, favicon: update.favicon ?? undefined }
                    : tab
                }),
              )
            }
            const previousSelected = currentTabs.current.find((tab) => tab.id === activeTab)
            const closedKeys = new Set(state.closedTabs ?? [])
            const closedIds = new Set(
              currentTabs.current
                .filter((tab) => closedKeys.has(nativeKey(tab.id)))
                .map((tab) => tab.id),
            )
            const remaining = currentTabs.current.filter((tab) => !closedIds.has(tab.id))
            const incoming = (state.movedTabs ?? [])
              .map(({ key, tab }) => {
                nativeTabKeys.set(`${scope}:${tab.id}`, key)
                return tab
              })
              .filter((tab) => !remaining.some((item) => item.id === tab.id))
            const additions = (state.createdTabs ?? []).filter(
              (tab) =>
                !tab.url ||
                /^https?:\/\//i.test(tab.url) ||
                /^chrome-extension:\/\/[a-p]{32}\//.test(tab.url),
            )
            const capacity = Math.max(0, 100 - remaining.length - incoming.length)
            const identities = new Map(
              additions.slice(0, capacity).map((tab) => [tab.key, randomUUID()]),
            )
            const adopted = additions.slice(0, capacity).map((tab) => {
              const id = identities.get(tab.key)!
              nativeTabKeys.set(`${scope}:${id}`, tab.key)
              return {
                id,
                url: tab.url,
                title: '',
                kind: 'web' as const,
                runtimeId: store.localRuntimeId ?? undefined,
                profileId: tab.profileId,
                visitedAt: 0,
                previewOf:
                  previewLinks.current && tab.openerKey
                    ? (identities.get(tab.openerKey) ??
                      currentTabs.current.find((item) => nativeKey(item.id) === tab.openerKey)
                        ?.id ??
                      activeTab)
                    : undefined,
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
            if (closedKeys.size || adopted.length || incoming.length) {
              const fallback: BrowserTab = {
                id: randomUUID(),
                url: '',
                title: '',
                kind: 'web',
                profileId: 'default',
              }
              const next = [...remaining, ...incoming, ...adopted]
              currentTabs.current = next.length ? next : [fallback]
              setTabs((previous) => {
                const kept = previous.filter((tab) => !closedIds.has(tab.id))
                const next = [...kept, ...incoming, ...adopted].slice(0, 100)
                return next.length ? next : [fallback]
              })
              if (closedKeys.has(browserKey))
                selectTab(
                  currentTabs.current.find((tab) => tab.id === previousSelected?.previewOf) ??
                    currentTabs.current[0],
                )
              let foreground = -1
              additions.slice(0, capacity).forEach((tab, index) => {
                if (tab.active || (previewLinks.current && tab.openerKey)) foreground = index
              })
              if (foreground >= 0) {
                void showLinkPreview(adopted[foreground], previousSelected)
              }
              for (const [key, value] of nativeTabKeys)
                if (closedKeys.has(value)) nativeTabKeys.delete(key)
              if (incoming.length) selectTab(incoming[incoming.length - 1])
            }
            if (state.focusedTabKey) {
              const target = currentTabs.current.find(
                (tab) => nativeKey(tab.id) === state.focusedTabKey,
              )
              if (target && target.id !== activeTab) {
                if (state.openedLinks?.length) {
                  const additions = state.openedLinks
                    .slice(0, Math.max(0, 100 - currentTabs.current.length))
                    .map((url) => ({
                      id: randomUUID(),
                      url,
                      title: '',
                      kind: 'web' as const,
                      profileId:
                        browserLinkProfile(url, routingProfiles.current, profileId) ?? profileId,
                      visitedAt: 0,
                      previewOf: previewLinks.current ? activeTab : undefined,
                    }))
                  setTabs((previous) => [...previous, ...additions])
                }
                selectTab(target)
                return
              }
            }
            if (
              incoming.length ||
              closedKeys.has(browserKey) ||
              additions
                .slice(0, capacity)
                .some((tab) => tab.active || (previewLinks.current && tab.openerKey))
            )
              return
          }
          if (mode !== 'web') return
          if (
            !/^https?:\/\//i.test(state.url) &&
            state.url !== 'about:blank' &&
            !nativeTabKeys.has(`${scope}:${activeTab}`)
          )
            return
          if (shared && state.openedLinks?.length) {
            const links = state.openedLinks
            const additions = links
              .slice(0, Math.max(0, 100 - currentTabs.current.length))
              .map((target) => ({
                id: randomUUID(),
                url: target,
                title: '',
                kind: 'web' as const,
                profileId:
                  browserLinkProfile(target, routingProfiles.current, profileId) ?? profileId,
                visitedAt: 0,
                previewOf: previewLinks.current ? activeTab : undefined,
              }))
            if (additions.length) {
              setTabs((previous) => [...previous, ...additions])
              void showLinkPreview(additions[additions.length - 1])
              return
            }
          }
          setHistory({ ...state, title: state.title ?? '', cdp: state.cdp })
          // window.open('', name) can navigate after the preview is adopted.
          if (!url && /^https?:\/\//i.test(state.url)) setUrl(state.url)
          if (!editing.current) setInput(state.url === 'about:blank' ? '' : state.url)
          addresses.set(scope, state.url)
          setTabs((previous) =>
            !previous.some(
              (tab) =>
                tab.id === activeTab &&
                (tab.url !== state.url ||
                  tab.title !== (state.title ?? '') ||
                  tab.favicon !== browserPageFavicon(tab, state.url, state.favicon)),
            )
              ? previous
              : previous.map((tab) =>
                  tab.id === activeTab &&
                  (tab.url !== state.url ||
                    tab.title !== state.title ||
                    tab.favicon !== browserPageFavicon(tab, state.url, state.favicon))
                    ? {
                        ...tab,
                        url: state.url === 'about:blank' ? '' : state.url,
                        title: state.title ?? '',
                        favicon: browserPageFavicon(tab, state.url, state.favicon),
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
    if (!browser || mode !== 'web') return
    return () => {
      // Leaving this tab/Studio section is distinct from reconfiguring its URL or viewport.
      void browser({ action: 'hide', key: browserKey }).catch(() => {})
    }
  }, [browser, browserKey, mode])
  useEffect(() => {
    if (!browser || (!url && !nativeTabKeys.has(`${scope}:${activeTab}`)) || mode !== 'web') return
    let alive = true
    let frame: number | undefined
    let previousCommand = ''
    let revision = 0
    let stopFrames: (() => void) | undefined
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
              ...(obscured ? { occluded: true } : {}),
              ...(occlusion === 'tooltip' ? { preserveFocus: true } : {}),
            }
      const signature = JSON.stringify(command)
      if (signature === previousCommand) return
      previousCommand = signature
      const attempt = ++revision
      void (async () => {
        if (command.action === 'hide' && obscured && rect?.width && rect.height) {
          // Native views sit above HTML menus. Keep their replacement live while occluded.
          stopFrames ??= browserFrames?.(browserKey, (frame) => {
            if (!alive) return
            if (frozenImage.current) frozenImage.current.src = frame.image
            else flushSync(() => setFrozenPage({ key: browserKey, url, image: frame.image }))
          })
          // Keep the live page until its replacement has decoded and committed. Hiding first
          // exposes the empty native slot for at least one frame whenever a menu opens.
          let timeout: ReturnType<typeof setTimeout> | undefined
          try {
            const captured = await Promise.race([
              browser({ action: 'screenshot', key: browserKey }),
              new Promise<undefined>((resolve) => {
                timeout = setTimeout(() => resolve(undefined), 500)
              }),
            ])
            if (captured?.image && alive && revision === attempt) {
              const image = new Image()
              image.src = captured.image
              await image.decode()
              if (alive && revision === attempt)
                flushSync(() => setFrozenPage({ key: browserKey, url, image: captured.image! }))
            }
          } catch {
            /* A hung or loading page must not prevent access to Studio's menus. */
          } finally {
            clearTimeout(timeout)
          }
        }
        if (!alive || revision !== attempt) return
        await browser(command)
        if (!alive || revision !== attempt) return
        if (command.action === 'show' || !obscured) {
          // Restore native visibility before ending the underlay; a false hidden transition
          // here could trigger the site's automatic picture-in-picture when a menu closes.
          stopFrames?.()
          stopFrames = undefined
        }
        // Keep the fallback behind the native page while its compositor resumes painting.
        if (command.action === 'show')
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              if (alive && revision === attempt) setFrozenPage(null)
            }),
          )
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
      stopFrames?.()
      if (frame !== undefined) cancelAnimationFrame(frame)
      resize.disconnect()
      mutations.disconnect()
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
      void browser({
        action: 'hide',
        key: browserKey,
        occluded: true,
      }).catch(() => {})
    }
  }, [
    browser,
    browserFrames,
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
  const disposeTab = async (tab: BrowserTab) => {
    if (tab.kind === 'remote') {
      const owner = runtimesRef.current.find((entry) => entry.profile.id === tab.runtimeId)
      if (shared && !owner?.connected)
        throw new Error('This tab’s computer is offline. Its session will expire automatically.')
      const call: typeof request =
        shared && owner
          ? (path, input, schema, method) =>
              store.readRuntime(owner.profile, path, input, schema, method)
          : request
      await call(
        '/api/previews/browser/close',
        { taskId, tabId: tab.id, profileId: tab.profileId },
        responses.ok,
      )
    } else if (browser) {
      const key = nativeKey(tab.id)
      nativeTabKeys.delete(`${scope}:${tab.id}`)
      await browser({ action: 'close', key })
    }
  }
  const removeTab = (tab: BrowserTab, dispose = true) => {
    if (tab.pinned && dispose) return
    if (dispose && shared && restorableTab(tab))
      setClosed((previous) => [tab, ...previous].slice(0, 20))
    const remaining = currentTabs.current.filter((item) => item.id !== tab.id)
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
    currentTabs.current = next
    setTabs(next)
    if (activeTab === tab.id)
      selectTab(
        next.find((item) => item.id === tab.previewOf) ??
          next[Math.min(tabs.indexOf(tab), next.length - 1)],
      )
    if (dispose)
      void disposeTab(tab).catch((cause) => setError(`Could not close tab: ${String(cause)}`))
  }
  const closeTab = (tab: BrowserTab) => removeTab(tab)
  const protectedTabIds = async (candidates: readonly BrowserTab[]) => {
    const protectedIds = new Set<string>()
    // Unknown activity must preserve a page rather than risk ending a call.
    const activity = await browser?.({ action: 'tab-activity', key: 'studio-tab-cleanup' }).catch(
      () => undefined,
    )
    for (const tab of candidates)
      if (
        tab.keepAwake ||
        (tab.kind === 'web' &&
          (!activity?.protectedKeys || activity.protectedKeys.includes(nativeKey(tab.id))))
      )
        protectedIds.add(tab.id)
    await Promise.all(
      candidates
        .filter((tab) => tab.kind === 'remote')
        .map(async (tab) => {
          const owner = runtimesRef.current.find((entry) => entry.profile.id === tab.runtimeId)
          if (!owner?.connected) {
            protectedIds.add(tab.id)
            return
          }
          try {
            const status = await store.readRuntime(
              owner.profile,
              '/api/previews/browser/activity',
              { taskId, tabId: tab.id, profileId: tab.profileId },
              browserTabActivitySchema,
            )
            if (status.active) protectedIds.add(tab.id)
          } catch {
            protectedIds.add(tab.id)
          }
        }),
    )
    return protectedIds
  }
  // Unused previews close, but a call or shared page becomes a regular tab and stays alive.
  useEffect(() => {
    const retained = new Set<string>(pendingPreview ? [pendingPreview] : [])
    let tab = tabs.find((item) => item.id === activeTab)
    while (tab && !retained.has(tab.id)) {
      retained.add(tab.id)
      tab = tabs.find((item) => item.id === tab?.previewOf)
    }
    const discarded = tabs.filter((tab) => tab.previewOf && !retained.has(tab.id))
    if (!discarded.length) return
    let cancelled = false
    void protectedTabIds(discarded).then((protectedIds) => {
      if (cancelled) return
      const ids = new Set(discarded.map((tab) => tab.id))
      const updated = currentTabs.current.flatMap((tab) =>
        !ids.has(tab.id)
          ? [tab]
          : protectedIds.has(tab.id)
            ? [{ ...tab, previewOf: undefined }]
            : [],
      )
      currentTabs.current = updated
      setTabs(updated)
      for (const tab of discarded)
        if (!protectedIds.has(tab.id))
          void disposeTab(tab).catch((cause) =>
            setError(`Could not close preview: ${String(cause)}`),
          )
    })
    return () => {
      cancelled = true
    }
  }, [tabs, activeTab, pendingPreview])
  useEffect(() => {
    if (!shared) return
    let stopped = false,
      running = false
    const settings = {
      browserAutoSettleMinutes: preferences.browserAutoSettleMinutes ?? 0,
      browserCloseSettledMinutes: preferences.browserCloseSettledMinutes ?? 0,
    }
    const sweep = async () => {
      if (running) return
      running = true
      try {
        const now = Date.now()
        setClock(now)
        const before = currentTabs.current
        const planned = cleanBrowserTabs(before, settings, activeTabRef.current, now)
        const candidates = before.filter(
          (tab) =>
            planned.closeIds.includes(tab.id) ||
            planned.tabs.find((item) => item.id === tab.id)?.settledAt !== tab.settledAt,
        )
        const protectedIds = candidates.length
          ? await protectedTabIds(candidates)
          : new Set<string>()
        if (candidates.length) {
          for (const tab of currentTabs.current)
            if (!candidates.includes(tab)) protectedIds.add(tab.id)
        }
        if (stopped) return
        const current = currentTabs.current
        const result = cleanBrowserTabs(current, settings, activeTabRef.current, now, protectedIds)
        if (
          result.tabs.length === current.length &&
          result.tabs.every((tab, index) => tab === current[index])
        )
          return
        const closing = current.filter((tab) => result.closeIds.includes(tab.id))
        currentTabs.current = result.tabs
        setTabs(result.tabs)
        const restorable = closing.filter(restorableTab)
        if (restorable.length) setClosed((previous) => [...restorable, ...previous].slice(0, 20))
        for (const tab of closing)
          void disposeTab(tab).catch((cause) =>
            setError(`Could not close settled tab: ${String(cause)}`),
          )
      } catch (cause) {
        if (!stopped) setError(`Tab cleanup failed: ${String(cause)}`)
      } finally {
        running = false
      }
    }
    void sweep()
    const timer = setInterval(() => void sweep(), 30000)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [
    shared,
    browser,
    preferences.browserAutoSettleMinutes,
    preferences.browserCloseSettledMinutes,
  ])
  const moveTab = (tab: BrowserTab, until?: number) => {
    const now = Date.now()
    const next = currentTabs.current.map((item) =>
      item.id === tab.id
        ? until
          ? snoozeBrowserTab(item, until, now)
          : settleBrowserTab(item, now)
        : item,
    )
    currentTabs.current = next
    setTabs(next)
    if (tab.id !== activeTab) return
    const available = recentBrowserTabs(next, sortByActivity).filter((item) => item.id !== tab.id)
    const target =
      available.find((item) => browserTabCategory(item, now) === 'active') ?? available[0]
    if (target) selectTab(target)
    else
      newTab(
        '',
        tab.kind,
        isPrivateBrowserProfile(tab.profileId) ? 'default' : tab.profileId,
        tab.runtimeId,
      )
  }
  const openSavedPage = (tab: BrowserTab) => {
    const existing = tabs.find((item) => browserPageKey(item) === browserPageKey(tab))
    if (existing) selectTab(existing)
    else newTab(tab.url, tab.kind, tab.profileId, tab.runtimeId, tab.title, tab.favicon)
  }
  const reopenTab = () => {
    const tab = closed[0]
    if (!tab) return
    if (newTab(tab.url, tab.kind, tab.profileId, tab.runtimeId, tab.title, tab.favicon))
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
  const tabShortcut = (key: 't' | 'w' | 'd', shift: boolean) => {
    if (key === 't') {
      if (shift) reopenTab()
      else {
        newTab('', selectedTab.kind, selectedTab.profileId, selectedTab.runtimeId)
        requestAnimationFrame(() => addressField.current?.focus())
      }
    }
    if (key === 'w') closeTab(selectedTab)
    if (key === 'd') toggleBookmark()
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
      if (key === 't' || key === 'w' || key === 'd') tabShortcut(key, event.shiftKey)
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
  const [browserWindows, setBrowserWindows] = useApplicationState<{ id: number; title: string }[]>(
    [],
  )
  const loadBrowserWindows = () => {
    if (browser && shared)
      void browser({ action: 'browser-windows', key: browserKey })
        .then((result) => setBrowserWindows(result?.windows ?? []))
        .catch((cause) => setError(String(cause)))
  }
  const togglePin = (tab: BrowserTab) => {
    setTabs((previous) =>
      previous.map((item) =>
        item.id === tab.id
          ? {
              ...wakeBrowserTab(item),
              pinned: !item.pinned,
              homeUrl: item.pinned ? undefined : item.url,
              previewOf: undefined,
            }
          : item,
      ),
    )
  }
  const returnHome = (tab: BrowserTab) => {
    if (!tab.homeUrl) return
    selectTab(tab)
    setHomeRequest({ tabId: tab.id, url: tab.homeUrl })
  }
  useEffect(() => {
    if (homeRequest?.tabId !== activeTab) return
    navigate(homeRequest.url)
    setHomeRequest(null)
  }, [homeRequest, activeTab])
  const editHome = (tab: BrowserTab) => {
    setHomeError('')
    setHomeEditor({ tabId: tab.id, url: tab.homeUrl ?? tab.url })
  }
  const clearTabDrag = () => {
    setDraggingTab(null)
    setTabDrop(null)
  }
  const tabDragGroup = (tab: BrowserTab) => browserTabDragGroup(tab, sortByActivity, clock)
  const acceptsTabDrop = (target: BrowserTab) => {
    const source = tabs.find((tab) => tab.id === draggingTab)
    return (
      !busy &&
      !!source &&
      source.id !== target.id &&
      !!tabDragGroup(source) &&
      tabDragGroup(source) === tabDragGroup(target)
    )
  }
  const tabDropEdge = (event: DragEvent<HTMLDivElement>, tab: BrowserTab) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return tab.pinned
      ? event.clientX < rect.left + rect.width / 2
        ? 'before'
        : 'after'
      : event.clientY < rect.top + rect.height / 2
        ? 'before'
        : 'after'
  }
  const renderTab = (tab: BrowserTab) => (
    <BrowserTabRow
      key={tab.id}
      tab={tab}
      state={
        tab.kind === 'web' ? tabStates.find((state) => state.key === nativeKey(tab.id)) : undefined
      }
      onMute={
        browser && tab.kind === 'web'
          ? () => {
              const state = tabStates.find((state) => state.key === nativeKey(tab.id))
              void act(async () => {
                const result = await browser({
                  action: 'set-audio-muted',
                  key: nativeKey(tab.id),
                  muted: !state?.muted,
                })
                if (result?.tabStates) setTabStates(result.tabStates)
              })
            }
          : undefined
      }
      active={activeTab === tab.id}
      busy={busy}
      reorder={
        !busy && tabDragGroup(tab)
          ? {
              dragging: draggingTab === tab.id,
              edge: tabDrop?.id === tab.id ? tabDrop.edge : undefined,
              onDragStart: (event) => {
                if (
                  event.target instanceof Element &&
                  event.target.closest('button') &&
                  !event.target.closest('[data-browser-tab-select]')
                ) {
                  event.preventDefault()
                  return
                }
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('application/x-dovo-browser-tab', tab.id)
                event.dataTransfer.setDragImage(event.currentTarget, 16, 16)
                setDraggingTab(tab.id)
              },
              onDragOver: (event) => {
                if (!acceptsTabDrop(tab)) {
                  setTabDrop(null)
                  return
                }
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                setTabDrop({ id: tab.id, edge: tabDropEdge(event, tab) })
              },
              onDrop: (event) => {
                event.preventDefault()
                event.stopPropagation()
                if (draggingTab && acceptsTabDrop(tab)) {
                  const sourceId = draggingTab,
                    edge = tabDropEdge(event, tab)
                  setTabs((previous) =>
                    reorderBrowserTabs(previous, sourceId, tab.id, edge, sortByActivity, clock),
                  )
                }
                clearTabDrag()
              },
              onDragEnd: clearTabDrag,
              onMove: (direction) => {
                const group = recentBrowserTabs(tabs, false).filter(
                  (item) => tabDragGroup(item) === tabDragGroup(tab),
                )
                const target = group[group.indexOf(tab) + (direction === 'previous' ? -1 : 1)]
                if (target)
                  setTabs((previous) =>
                    reorderBrowserTabs(
                      previous,
                      tab.id,
                      target.id,
                      direction === 'previous' ? 'before' : 'after',
                      sortByActivity,
                      clock,
                    ),
                  )
              },
            }
          : undefined
      }
      windows={browserWindows}
      onMenuOpen={loadBrowserWindows}
      onKeepAwake={
        browser && shared && tab.kind === 'web' && /^https?:\/\//i.test(tab.url)
          ? () =>
              setTabs((previous) =>
                previous.map((item) =>
                  item.id === tab.id
                    ? { ...wakeBrowserTab(item), previewOf: undefined, keepAwake: !item.keepAwake }
                    : item,
                ),
              )
          : undefined
      }
      onSelect={() => selectTab(tab)}
      onPin={() => togglePin(tab)}
      onHome={tab.pinned && tab.homeUrl ? () => returnHome(tab) : undefined}
      onEditHome={tab.pinned ? () => editHome(tab) : undefined}
      onSettle={() => moveTab(tab)}
      onSnooze={() => moveTab(tab, tomorrowBrowserTabWake())}
      onClose={() => closeTab(tab)}
      onMove={
        browser && shared
          ? (targetWindowId) =>
              void act(async () => {
                await browser({
                  action: 'move-tab',
                  key: nativeKey(tab.id),
                  tab: { ...tab, title: tab.title.slice(0, 4096) },
                  targetWindowId,
                })
                nativeTabKeys.delete(`${scope}:${tab.id}`)
                removeTab(tab, false)
              })
          : undefined
      }
    />
  )
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
          onCloseAutoFocus={(event) => {
            if (findOpen) event.preventDefault()
          }}
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
              <label htmlFor={`${controlsId}-links`} className="text-xs font-medium">
                Open links in
              </label>
              <select
                id={`${controlsId}-links`}
                aria-label="Open links in"
                className="w-full rounded-md border bg-background p-2 text-xs"
                value={preferences.browserLinkOpening ?? 'preview'}
                onChange={(event) =>
                  updateAppPreferences({
                    browserLinkOpening: event.target.value === 'tab' ? 'tab' : 'preview',
                  })
                }
              >
                <option value="preview">Link preview</option>
                <option value="tab">New tab</option>
              </select>
              <label className="flex items-center gap-2 text-xs font-medium">
                <input
                  type="checkbox"
                  checked={sortByActivity}
                  onChange={(event) =>
                    updateAppPreferences({ browserSortByActivity: event.target.checked })
                  }
                />
                Order tabs by activity
              </label>
              <p className="text-xs text-muted-foreground">
                Pinned tabs always keep their manual order. Turn this off to drag other tabs into
                order.
              </p>
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
                  const target = history.url || selectedTab.url || url
                  setUrl(target)
                  setInput(target)
                  addresses.set(scope, target)
                  setHistory({ url: '', title: '', cdp: undefined, back: false, forward: false })
                  setTabs((previous) =>
                    previous.map((tab) =>
                      tab.id === activeTab ? { ...tab, url: target, profileId: next } : tab,
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
                  <Popover.Close asChild>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="justify-start text-xs"
                      onClick={() => setFindOpen(true)}
                    >
                      Find on page
                    </Button>
                  </Popover.Close>
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
          {shared && (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="justify-start text-xs"
                disabled={busy}
                onClick={() => moveTab(selectedTab)}
              >
                Settle tab
              </Button>
              <details className="text-xs">
                <summary className="cursor-pointer rounded px-3 py-2">Snooze tab</summary>
                {(
                  [
                    [60, 'Snooze for 1 hour'],
                    [240, 'Snooze for 4 hours'],
                    [0, 'Snooze until tomorrow'],
                  ] as const
                ).map(([minutes, label]) => (
                  <Button
                    key={label}
                    size="sm"
                    variant="ghost"
                    className="w-full justify-start text-xs"
                    disabled={busy}
                    onClick={() =>
                      moveTab(
                        selectedTab,
                        minutes ? Date.now() + minutes * 60000 : tomorrowBrowserTabWake(),
                      )
                    }
                  >
                    {label}
                  </Button>
                ))}
              </details>
            </>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="justify-start gap-2 text-xs"
            onClick={() => togglePin(selectedTab)}
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
      {selectedTab.pinned && selectedTab.homeUrl && (
        <IconButton
          label="Return to tab home"
          type="button"
          className="size-8 shrink-0"
          disabled={busy}
          onClick={() => returnHome(selectedTab)}
        >
          <Home size={15} />
        </IconButton>
      )}
      <div className="studio-browser-address flex h-9 min-w-0 flex-1 items-center @max-[480px]/browser:order-first @max-[480px]/browser:basis-full [@media(pointer:coarse)]:h-12">
        <span className="flex w-9 shrink-0 justify-center [@media(pointer:coarse)]:w-11">
          {shared && mode === 'web' ? (
            <BrowserSiteControls
              key={`${browserKey}:${history.url || url}`}
              tabKey={browserKey}
              url={history.url || url}
              profileName={
                profiles.find((profile) => profile.id === profileId)?.name ??
                (isPrivateBrowserProfile(profileId) ? 'Private' : 'Unavailable profile')
              }
            />
          ) : (
            <Globe2 size={15} className="text-muted-foreground" aria-hidden="true" />
          )}
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
      {shared && (
        <>
          <IconButton
            type="button"
            label="Thread for this tab"
            aria-pressed={threadPanels.has(activeTab)}
            onClick={() =>
              setThreadPanels((previous) => {
                const next = new Set(previous)
                if (next.has(activeTab)) next.delete(activeTab)
                else next.add(activeTab)
                return next
              })
            }
          >
            <MessageSquare size={15} />
          </IconButton>
          <IconButton
            type="button"
            label="Customize website"
            disabled={!websiteOrigin || !websiteProfile || isPrivateBrowserProfile(profileId)}
            onClick={customizeWebsite}
          >
            <Paintbrush size={15} />
          </IconButton>
        </>
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
      threadPanel={
        shared && mode !== 'devices' && threadPanels.has(activeTab) ? (
          <BrowserThreadPanel
            key={selectedTab.id}
            runtimeId={tabRuntimeId}
            thread={selectedTab.thread}
            onThread={(thread) => {
              if (!tabRuntimeId || thread.runtimeId !== tabRuntimeId) {
                setError('Choose a thread on this tab’s computer.')
                return
              }
              setTabs((previous) =>
                previous.map((tab) => (tab.id === activeTab ? { ...tab, thread } : tab)),
              )
            }}
            onClose={() =>
              setThreadPanels((previous) => {
                const next = new Set(previous)
                next.delete(activeTab)
                return next
              })
            }
            onBrowser={(target) =>
              newTab(target, selectedTab.kind, profileId, selectedTab.runtimeId)
            }
            insert={customizationInsert?.tabId === activeTab ? customizationInsert : null}
            onInserted={() => setCustomizationInsert(null)}
            websiteOrigin={
              websiteProfile && !isPrivateBrowserProfile(profileId) ? websiteOrigin : undefined
            }
            onProposal={(proposal) => setCustomization(proposal)}
          />
        ) : undefined
      }
      editor={
        customization && (
          <WebsiteCustomizationEditor
            key={`${activeTab}:${profileId}:${customization.origin}:${customization.css}:${customization.script}`}
            website={customization}
            profileName={websiteProfile?.name ?? profileId}
            onClose={() => setCustomization(null)}
            onSave={saveWebsiteCustomization}
            onAgent={customizeWithAgent}
          />
        )
      }
      preview={
        selectedTab.previewOf
          ? {
              title: selectedTab.url.replace(/^https?:\/\//, '').split('/')[0] || 'Link',
              placement: previewPlacement,
              background: previewBackground,
              imageRef: previewImage,
              onPlacementChange: (placement) =>
                placement === 'inline' ? closeTab(selectedTab) : setPreviewPlacement(placement),
              onClose: () => closeTab(selectedTab),
              onReturnToOpener: () => {
                const opener = currentTabs.current.find(
                  (tab) => tab.id === previewBackground?.tabId,
                )
                if (opener) selectTab(opener)
                else closeTab(selectedTab)
              },
              onPromote: () =>
                setTabs((previous) =>
                  previous.map((tab) =>
                    tab.id === activeTab ? { ...tab, previewOf: undefined } : tab,
                  ),
                ),
            }
          : undefined
      }
      sidebar={
        shared ? (
          <ResizableSidebar
            preference="browserSidebarWidth"
            side="left"
            label="Browser tabs"
            maxFraction={0.4}
            maxWidth={480}
            aria-label="Recent browser tabs"
            className="flex shrink-0 flex-col border-r bg-sidebar"
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
            <div className="flex min-h-0 flex-1 flex-col">
              {(['active', 'snoozed', 'settled'] as const).map((category) => (
                <BrowserTabGroup
                  key={category}
                  category={category}
                  count={
                    regularTabs.filter((tab) => browserTabCategory(tab, clock) === category).length
                  }
                >
                  {category === 'active' && (
                    <div
                      aria-label="Pinned browser tabs"
                      className="mb-2 grid grid-cols-[repeat(auto-fill,minmax(4rem,1fr))] gap-1.5"
                    >
                      {recentBrowserTabs(tabs, sortByActivity)
                        .filter((tab) => tab.pinned)
                        .map(renderTab)}
                    </div>
                  )}
                  {recentBrowserTabs(tabs, sortByActivity)
                    .filter((tab) => !tab.pinned && browserTabCategory(tab, clock) === category)
                    .map(renderTab)}
                </BrowserTabGroup>
              ))}
            </div>
          </ResizableSidebar>
        ) : null
      }
    >
      {homeEditor && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setHomeEditor(null)
          }}
        >
          <DialogContent>
            <DialogTitle>Edit pinned tab home</DialogTitle>
            <DialogDescription>
              Return to this address whenever you want to start fresh in this pinned tab.
            </DialogDescription>
            <form
              className="mt-4 space-y-4"
              onSubmit={(event) => {
                event.preventDefault()
                try {
                  const homeUrl = browserAddress(
                    homeEditor.url,
                    (websiteProfile ?? tabProfiles.find((profile) => profile.id === 'default'))
                      ?.search,
                  )
                  if (!homeUrl) throw new Error('Enter a home URL.')
                  setTabs((previous) =>
                    previous.map((tab) =>
                      tab.id === homeEditor.tabId ? { ...tab, homeUrl } : tab,
                    ),
                  )
                  setHomeEditor(null)
                } catch (cause) {
                  setHomeError(cause instanceof Error ? cause.message : String(cause))
                }
              }}
            >
              <label className="flex flex-col gap-2 text-xs">
                Home URL
                <Input
                  autoFocus
                  value={homeEditor.url}
                  onChange={(event) => {
                    setHomeEditor({ ...homeEditor, url: event.target.value })
                    setHomeError('')
                  }}
                />
              </label>
              {homeError && (
                <p role="alert" className="text-xs text-destructive">
                  {homeError}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setHomeEditor(null)}>
                  Cancel
                </Button>
                <Button type="submit">Save home</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}
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

      {!shared && initialMode !== 'devices' && regularTabs.length > 1 && (
        <div
          role="tablist"
          aria-label="Browser tabs"
          className="flex shrink-0 items-center gap-1 overflow-x-auto border-b bg-sidebar/60 px-2 pt-2 pb-1"
        >
          {regularTabs.map((tab) => (
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
                        ? regularTabs.length - 1
                        : (regularTabs.indexOf(tab) +
                            (event.key === 'ArrowRight' ? 1 : -1) +
                            regularTabs.length) %
                          regularTabs.length
                  selectTab(regularTabs[index])
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
      {mode === 'web' && browser && url && (
        <BrowserFindBar
          key={browserKey}
          browser={browser}
          browserKey={browserKey}
          url={url}
          open={findOpen}
          onOpenChange={setFindOpen}
          globalShortcut={shared}
          focusRequest={findRequest}
          pageRevision={pageRevision}
        />
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
                onShortcut={
                  shared
                    ? (key, shift) => {
                        if (activeTab === tab.id) tabShortcut(key, shift)
                      }
                    : undefined
                }
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
                      favicon: undefined,
                      pinned: false,
                      homeUrl: undefined,
                      previewOf: previewLinks.current ? tab.id : undefined,
                    }))
                    currentTabs.current = [...currentTabs.current, ...adopted]
                    setTabs((previous) => [
                      ...previous,
                      ...adopted.filter((child) => !previous.some((item) => item.id === child.id)),
                    ])
                    if (adopted.length) {
                      void showLinkPreview(adopted[adopted.length - 1], tab)
                    }
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
                          item.id === tab.id &&
                          (item.url !== url ||
                            item.title !== state.title ||
                            item.favicon !== browserPageFavicon(item, url, state.favicon)),
                      )
                    )
                      return previous
                    return previous.map((item) =>
                      item.id === tab.id
                        ? {
                            ...item,
                            url,
                            title: state.title,
                            favicon: browserPageFavicon(item, url, state.favicon),
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
                    ref={frozenImage}
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

function BrowserTabGroup({
  category,
  count,
  children,
}: {
  category: BrowserTabCategory
  count: number
  children: ReactNode
}) {
  if (category === 'active')
    return (
      <div aria-label="Active browser tabs" className="min-h-0 flex-1 overflow-y-auto p-2">
        {children}
      </div>
    )
  return (
    <details className="studio-list-section mb-1 shrink-0">
      <summary className="studio-list-section-header">
        <ChevronDown size={11} className="studio-list-section-chevron" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">
          {category === 'snoozed' ? 'Snoozed tabs' : 'Settled tabs'}
        </span>
        <span>{count}</span>
      </summary>
      <div className="max-h-[35vh] overflow-y-auto p-2">{children}</div>
    </details>
  )
}
function BrowserLayout({
  sidebar,
  devices,
  children,
  preview,
  threadPanel,
  editor,
}: {
  sidebar: React.ReactNode
  threadPanel?: React.ReactNode
  editor?: React.ReactNode
  devices: boolean
  children: React.ReactNode
  preview?: {
    title: string
    placement: PreviewPlacement
    background: BrowserPreviewBackground | null
    imageRef: RefObject<HTMLImageElement | null>
    onPlacementChange: (placement: PreviewPlacement) => void
    onClose: () => void
    onReturnToOpener: () => void
    onPromote: () => void
  }
}) {
  const sidebarState = useNavigationSidebar()
  return (
    <section
      className="@container/browser relative flex h-full min-h-0 min-w-0"
      aria-label={devices ? 'Device previews' : 'Browser previews'}
    >
      {!sidebarState?.collapsed && sidebar}
      <div
        className="relative isolate flex min-h-0 min-w-0 flex-1 overflow-hidden"
        data-browser-viewport
      >
        {preview && (
          <button
            type="button"
            data-browser-preview-background
            aria-label="Return to opener"
            onClick={preview.onReturnToOpener}
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background text-left focus-visible:outline-2 focus-visible:outline-ring"
          >
            <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4 text-xs text-muted-foreground">
              <Globe2 size={14} />
              <span className="truncate">
                {preview.background?.url || preview.background?.title}
              </span>
            </div>
            {preview.background?.image && (
              <img
                alt=""
                ref={preview.imageRef}
                src={preview.background.image}
                className="min-h-0 w-full flex-1 object-fill"
              />
            )}
          </button>
        )}
        <FloatingPreview
          title={preview ? 'Link' : 'Browser'}
          displayTitle={preview?.title}
          minimalFrame={!!preview}
          placement={preview?.placement ?? 'inline'}
          onPlacementChange={(placement) => preview?.onPlacementChange(placement)}
          onClose={preview?.onClose}
          expandedReturnPlacement={preview ? 'floating' : 'inline'}
          returnLabel="Back to tab"
          inlineClassName="min-w-0 flex-1"
          hideInlineHeader
          startCentered={!!preview}
          contained
          actions={
            preview && (
              <IconButton
                label="Open in new tab"
                className="size-7 shrink-0"
                onClick={preview.onPromote}
              >
                <ArrowUpRight size={14} />
              </IconButton>
            )
          }
        >
          {children}
        </FloatingPreview>
      </div>
      {threadPanel && (
        <ResizableSidebar
          preference="toolsSidebarWidth"
          side="right"
          label="Browser tab thread"
          maxFraction={0.6}
          maxWidth={640}
          className="z-20 @max-[800px]/browser:absolute @max-[800px]/browser:inset-0 @max-[800px]/browser:!w-full @max-[800px]/browser:!max-w-full"
        >
          {threadPanel}
        </ResizableSidebar>
      )}
      {editor}
    </section>
  )
}
