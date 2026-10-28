import { DOCUMENT_PIP_NAME, authorizeDocumentPip } from './browser-document-pip.js'
import { loadBrowserFaviconModule } from './browser-favicon.js'
import {
  selectedBrowserText,
  isPrivateBrowserProfile,
  type BrowserWorkspaceTab,
} from '@dovo/protocol'
import { createBrowserCdp } from './browser-cdp.js'
import { decode } from '@dovo/protocol'
import { app, BrowserWindow, WebContentsView, ipcMain, shell, Menu, clipboard } from 'electron'
import { trustedRendererUrl } from './renderer-trust.js'
import { createBrowserExtensions, workspacePartition } from './browser-extensions.js'
import { createBrowserMedia, type MediaTab } from './browser-media.js'
import { browserPermissions, forgetPrivateBrowserPermissions } from './browser-permissions.js'
import {
  configureBrowserLanguage,
  websiteCustomization,
  websiteLinkProfile,
} from './browser-language.js'
import { openThreadMedia } from './browser-thread-media.js'
import { randomUUID } from 'node:crypto'
import { browserCommandSchema, previewUrl } from '@dovo/protocol'
const { createBrowserFaviconLoader } = loadBrowserFaviconModule(
  app.isPackaged ? process.resourcesPath : undefined,
)

type Entry = {
  windowId: number
  window: BrowserWindow
  inactiveAt?: number
  key: string
  profileId: string
  agentAccess: boolean
  /** Shared Browser activity view; thread-side previews keep denying popups and shortcuts. */
  workspace: boolean
  openedLinks: string[]
  favicon?: string | null
  /** Reported once by the next `status`; native POST loads have no other channel to the UI. */
  navigationError?: string
  popups: Set<BrowserWindow>
  documentPip?: BrowserWindow
  taskId?: string
  cdp?: string
  view: WebContentsView
  contents: Electron.WebContents
  browserSession: Electron.Session
  url: string
  /** Extension page an extension opened here; the renderer adopts the tab with this exact URL. */
  extensionUrl?: string
  /** Created by Chromium itself, retaining target names, opener and deferred navigation. */
  pageCreated?: boolean
  /** Navigation readiness, without waiting for page subresources. */
  loading?: Promise<void>
  /** Restore page focus after a passive tooltip, unless Studio receives deliberate input. */
  restoreFocus?: boolean
  keepAwake?: boolean
  videoPictureInPicture?: boolean
  fullscreenBounds?: Electron.Rectangle
  fullscreenWindowWasFullscreen?: boolean
  /** Page-initiated navigation awaiting its method-aware request check. */
  routeNavigation?: string
}
const MAX_OPENED_LINKS = 20
const MAX_POPUPS = 2
const MAX_EXTENSION_TAB_EVENTS = 20
const SELECTION_TIMEOUT = 3000
/** Absolute HTTP(S) only, without credentials; other schemes never reach a tab or popup. */
function openableUrl(input: string) {
  if (input.length > 4096) return
  try {
    const url = new URL(input)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return
    return url.href
  } catch {
    return
  }
}
/** A newer navigation replaced this one; that is not a failure to report. */
const isAborted = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === 'ERR_ABORTED'
/** A live renderer can be shown while images or other subresources are still loading. */
async function loadUntilReady(entry: Entry, url: string) {
  entry.routeNavigation = undefined
  const contents = entry.view.webContents
  let domReady = false
  let onReady = () => {}
  let onDestroyed = () => {}
  const ready = new Promise<void>((resolve, reject) => {
    onReady = () => {
      domReady = true
      resolve()
    }
    onDestroyed = () => reject(new Error('The browser page was closed.'))
    contents.on('dom-ready', onReady)
    contents.on('destroyed', onDestroyed)
  })
  try {
    await Promise.race([
      ready,
      contents.loadURL(url).catch((error: unknown) => {
        // The show request may already have finished at DOM readiness. Surface later
        // navigation failures through status instead of losing them with the race.
        if (domReady && !isAborted(error) && entry.url === url && !contents.isDestroyed())
          entry.navigationError = error instanceof Error ? error.message : String(error)
        throw error
      }),
    ])
  } finally {
    contents.removeListener('dom-ready', onReady)
    contents.removeListener('destroyed', onDestroyed)
  }
}
const POST_REFUSED =
  'This form could not be opened. Only small text form submissions are supported.'
const POST_FAILED = 'The form submission could not be loaded.'
const queueLink = (entry: Entry, input: string) => {
  const url = openableUrl(input)
  if (url && entry.openedLinks.length < MAX_OPENED_LINKS) entry.openedLinks.push(url)
}
const httpOnly = (contents: Electron.WebContents, allow?: (url: string) => boolean) => {
  const guard = (event: { preventDefault: () => void }, url: string) => {
    if (!openableUrl(url) && !allow?.(url)) event.preventDefault()
  }
  contents.on('will-navigate', guard)
  contents.on('will-redirect', guard)
}
/** Script popups with window features (OAuth, payment) keep their opener; tabs go to Studio. */
const popupRequest = (details: Electron.HandlerDetails) =>
  details.disposition === 'new-window' &&
  details.features.trim() !== '' &&
  !/(?:^|[\s,])noopener(?:[\s,=]|$)/i.test(details.features)
const primaryModifier = (input: Electron.Input) =>
  !input.alt &&
  (process.platform === 'darwin' ? input.meta && !input.control : input.control && !input.meta)
const tabShortcut = (input: Electron.Input) => {
  if (input.type !== 'keyDown' || !primaryModifier(input)) return
  const key = input.key.toLowerCase()
  if (key === 't' || (!input.shift && ['l', 'w', 'd', 'r', 'n'].includes(key))) return key
}
/** App-menu accelerators would act on the Studio window; pages keep only editing and Quit. */
const syncMenuShortcuts = (contents: Electron.WebContents, input: Electron.Input) => {
  if (input.type !== 'keyDown') return
  const menu =
    primaryModifier(input) && ['a', 'c', 'v', 'x', 'z', 'y', 'q'].includes(input.key.toLowerCase())
  contents.setIgnoreMenuShortcuts(!menu)
}
const MAX_POST_BYTES = 1024 * 1024
const POST_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain']
/** Form POSTs keep their body in the same tab; file parts, large bodies and odd headers are refused. */
function postNavigation(details: Electron.HandlerDetails): Electron.LoadURLOptions | undefined {
  const body = details.postBody
  if (!body) return
  const type = body.contentType.trim().toLowerCase()
  if (!POST_TYPES.includes(type)) return
  const multipart = type === 'multipart/form-data'
  if (multipart !== !!body.boundary) return
  if (
    body.boundary &&
    !/^[\w'()+,./:=?-][\w'()+,./:=? -]{0,68}[\w'()+,./:=?-]$/.test(body.boundary)
  )
    return
  let size = 0
  for (const part of body.data) {
    if (part.type !== 'rawData') return
    size += part.bytes.length
    if (size > MAX_POST_BYTES) return
  }
  return {
    postData: body.data,
    extraHeaders: `Content-Type: ${type}${multipart ? `; boundary=${body.boundary}` : ''}\n`,
    ...(openableUrl(details.referrer.url) ? { httpReferrer: details.referrer } : {}),
  }
}
export function registerBrowser(
  indexPath: string,
  directory?: string,
  preload?: string,
  browserWindows?: { create: () => Promise<BrowserWindow>; list: () => BrowserWindow[] },
) {
  let cdp: Awaited<ReturnType<typeof createBrowserCdp>> | undefined
  let cdpPending: Promise<Awaited<ReturnType<typeof createBrowserCdp>>> | undefined
  // Identity distinguishes overlapping shows of the same tab after resize or a menu closes.
  const activeViews = new Map<number, { key: string }>()
  const registered = new WeakSet<BrowserWindow>()
  const workspaces = new Set<BrowserWindow>()
  const tabCounts = new Map<number, number>()
  const views = new Map<string, Entry>()
  const routingSessions = new Set<Electron.Session>()
  const focusedTabs = new Map<number, string>()
  const awakeRequests = new Map<string, object>()
  let disposed = false
  const reportVisibility = (entry: Entry) => {
    if (entry.workspace && !entry.contents.isDestroyed())
      entry.contents.send(
        'browser:document-pip-visibility',
        entry.view.getVisible() && !entry.window.isMinimized() && entry.window.isVisible(),
      )
  }
  const setVisible = (entry: Entry, visible: boolean) => {
    const changed = entry.view.getVisible() !== visible
    entry.view.setVisible(visible)
    if (changed) reportVisibility(entry)
  }
  const focusTab = (entry: Entry) => {
    if (
      entry.window.isDestroyed() ||
      entry.contents.isDestroyed() ||
      views.get(JSON.stringify([entry.windowId, entry.key])) !== entry
    )
      return
    focusedTabs.set(entry.windowId, entry.key)
    if (entry.window.isMinimized()) entry.window.restore()
    entry.window.webContents.send('browser:focus-workspace')
    entry.window.show()
    entry.window.focus()
  }
  const callTabs = (windowId: number) => {
    const captures = media.snapshot(windowId).captures ?? []
    return [...views.values()].flatMap((entry) => {
      if (entry.windowId !== windowId || !entry.workspace || entry.contents.isDestroyed()) return []
      const url = openableUrl(entry.contents.getURL())
      const host = url ? new URL(url).hostname : ''
      const teams = ['teams.microsoft.com', 'teams.cloud.microsoft', 'teams.live.com'].includes(
        host,
      )
      const pictureInPicture = !!(entry.videoPictureInPicture || entry.documentPip)
      return teams || pictureInPicture || captures.some((capture) => capture.key === entry.key)
        ? [
            {
              key: entry.key,
              title: entry.contents.getTitle().slice(0, 500),
              url: url ?? '',
              profileId: entry.profileId,
              teams,
              pictureInPicture,
            },
          ]
        : []
    })
  }
  const focusStudio = (entry: Entry) => {
    if (
      !entry.contents.isDestroyed() &&
      entry.contents.isFocused() &&
      !entry.window.webContents.isDestroyed()
    )
      entry.window.webContents.focus()
  }
  const fitFullscreen = (entry: Entry) => {
    if (!entry.fullscreenBounds || entry.window.isDestroyed()) return
    const { width, height } = entry.window.contentView.getBounds()
    entry.view.setBounds({ x: 0, y: 0, width, height })
  }
  const exitFullscreen = (entry: Entry, closing = false) => {
    if (!entry.fullscreenBounds) return
    if (closing) {
      if (!entry.fullscreenWindowWasFullscreen && !entry.window.isDestroyed())
        entry.window.setFullScreen(false)
      entry.fullscreenBounds = undefined
      entry.fullscreenWindowWasFullscreen = undefined
      return
    }
    if (!entry.contents.isDestroyed())
      void entry.contents
        .executeJavaScript('document.fullscreenElement && document.exitFullscreen()')
        .catch((error: unknown) => {
          console.error('Could not exit browser fullscreen.', error)
        })
  }
  const closePopups = (entry: Entry) => {
    for (const popup of entry.popups) if (!popup.isDestroyed()) popup.close()
    entry.popups.clear()
  }
  /** Extension-opened and extension-closed tabs, drained by any `status` in that window. */
  const windowTabs = new Map<
    number,
    {
      created: {
        key: string
        url: string
        profileId: string
        active?: boolean
        openerKey?: string
      }[]
      closed: string[]
      moved: { key: string; tab: BrowserWorkspaceTab }[]
      favicons: { key: string; url: string; favicon: string | null }[]
    }
  >()
  const tabEvents = (windowId: number) => {
    let events = windowTabs.get(windowId)
    if (!events)
      windowTabs.set(windowId, (events = { created: [], closed: [], moved: [], favicons: [] }))
    return events
  }
  const drainTabEvents = (windowId: number, consumeMoves: boolean) => {
    const events = windowTabs.get(windowId)
    const createdTabs = events?.created.splice(0) ?? []
    const closedTabs = events?.closed.splice(0) ?? []
    // A thread preview can poll in the same Studio window while Browser is opening.
    const movedTabs = consumeMoves ? (events?.moved.splice(0) ?? []) : []
    const faviconUpdates = consumeMoves ? (events?.favicons.splice(0) ?? []) : []
    if (movedTabs.length) tabCounts.set(windowId, (tabCounts.get(windowId) ?? 1) + movedTabs.length)
    return {
      ...(createdTabs.length ? { createdTabs } : {}),
      ...(closedTabs.length ? { closedTabs } : {}),
      ...(movedTabs.length ? { movedTabs } : {}),
      ...(faviconUpdates.length ? { faviconUpdates } : {}),
    }
  }
  /** The Studio window that last showed each shared-browser profile hosts its extension tabs. */
  const profileWindows = new Map<string, { window: BrowserWindow; key: string }>()
  const mediaTab = (entry: Entry): MediaTab => ({
    key: entry.key,
    windowId: entry.windowId,
    profileId: entry.profileId,
    contents: entry.view.webContents,
  })
  const media = createBrowserMedia({
    openThread: preload ? (target) => openThreadMedia(target, indexPath, preload) : undefined,
    tabFor: (contents) => {
      for (const entry of views.values())
        // Handlers can receive a different wrapper object for the same page; compare by ID.
        if (entry.workspace && entry.view.webContents.id === contents.id) return mediaTab(entry)
    },
    canFullscreen: (contents) =>
      [...views.values()].some(
        (entry) =>
          entry.workspace &&
          entry.contents.id === contents.id &&
          entry.view.getVisible() &&
          activeViews.get(entry.windowId)?.key === JSON.stringify([entry.windowId, entry.key]),
      ),
    prepareFullscreen: (contents) => {
      const entry = [...views.values()].find((item) => item.contents.id === contents.id)
      if (entry && !entry.fullscreenBounds)
        entry.fullscreenWindowWasFullscreen = entry.window.isFullScreen()
    },
    tabs: () => [...views.values()].filter((e) => e.workspace).map(mediaTab),
  })
  const extensions = createBrowserExtensions({
    create: async (profileId, details) => {
      const url =
        details.url &&
        (openableUrl(details.url) ??
          (extensions.ownsUrl(profileId, details.url) ? details.url : undefined))
      if (!url) throw new Error('Dovo extensions can open web pages and their own pages only.')
      const requested =
        details.windowId === undefined ? undefined : BrowserWindow.fromId(details.windowId)
      const window =
        requested && registered.has(requested) && !requested.isDestroyed()
          ? requested
          : profileWindows.get(profileId)?.window
      if (!window || window.isDestroyed())
        throw new Error('Open this browser profile in Dovo first.')
      const events = tabEvents(window.id)
      if (events.created.length >= MAX_EXTENSION_TAB_EVENTS)
        throw new Error('Too many tabs are waiting to open.')
      // Renderer keys are `${scope}:${tabId}`; reuse the profile's scope so the pane adopts the
      // key as an ordinary tab ID. Scopes may contain colons, tab IDs never do.
      const last = profileWindows.get(profileId)
      const scope =
        last?.window === window && last.key.lastIndexOf(':') > 0
          ? last.key.slice(0, last.key.lastIndexOf(':'))
          : 'extension-tab'
      const key = `${scope}:${randomUUID()}`
      const entry = createEntry(window, JSON.stringify([window.id, key]), key, profileId, true)
      entry.inactiveAt = Date.now()
      entry.url = url
      if (!openableUrl(url)) entry.extensionUrl = url
      entry.loading = loadUntilReady(entry, url).catch((error: unknown) => {
        if (!isAborted(error))
          entry.navigationError = 'The page an extension opened could not be loaded.'
      })
      events.created.push({ key, url, profileId })
      return [entry.view.webContents, window]
    },
    close: (contents) => {
      for (const [key, entry] of views) {
        if (entry.view.webContents !== contents) continue
        if (activeViews.get(entry.windowId)?.key === key) activeViews.delete(entry.windowId)
        releaseView(key)
        const events = tabEvents(entry.windowId)
        if (events.closed.length < MAX_EXTENSION_TAB_EVENTS) events.closed.push(entry.key)
        return
      }
    },
    window: (profileId) => {
      const window = profileWindows.get(profileId)?.window
      return window && !window.isDestroyed() ? window : undefined
    },
    find: (window, key, profileId) => {
      const entry = views.get(JSON.stringify([window.id, key]))
      return entry?.workspace &&
        entry.profileId === profileId &&
        !entry.view.webContents.isDestroyed()
        ? entry.view.webContents
        : undefined
    },
  })
  const clearPrivateProfile = (profileId: string, browserSession: Electron.Session) => {
    if (
      !isPrivateBrowserProfile(profileId) ||
      [...views.values()].some((entry) => entry.profileId === profileId)
    )
      return
    forgetPrivateBrowserPermissions(profileId)
    void Promise.all([
      browserSession.clearStorageData(),
      browserSession.clearCache(),
      browserSession.closeAllConnections(),
    ]).catch((error: unknown) => console.error('Could not clear private browser data.', error))
  }
  const releaseView = (key: string) => {
    const entry = views.get(key)
    if (!entry) return
    exitFullscreen(entry, true)
    focusStudio(entry)
    views.delete(key)
    awakeRequests.delete(key)
    if (activeViews.get(entry.windowId)?.key === key) activeViews.delete(entry.windowId)
    cdp?.remove(key)
    if (entry.workspace) {
      extensions.removeTab(entry.profileId, entry.contents)
      media.releaseTab(entry.contents)
    }
    closePopups(entry)
    entry.window.contentView.removeChildView(entry.view)
    if (!entry.contents.isDestroyed()) entry.contents.close()
    clearPrivateProfile(entry.profileId, entry.browserSession)
  }
  const prune = () => {
    const inactive = [...views].filter(
      ([key, entry]) =>
        entry.inactiveAt !== undefined &&
        !isPrivateBrowserProfile(entry.profileId) &&
        !cdp?.connected(key) &&
        !entry.keepAwake &&
        !entry.videoPictureInPicture &&
        !entry.documentPip &&
        !(entry.workspace && media.keepAlive(entry.view.webContents)),
    )
    inactive.sort((a, b) => a[1].inactiveAt! - b[1].inactiveAt!)
    const counts = new Map<number, number>()
    for (const [, entry] of inactive)
      counts.set(entry.windowId, (counts.get(entry.windowId) ?? 0) + 1)
    for (const [key, entry] of inactive) {
      if ((counts.get(entry.windowId) ?? 0) <= 4 && Date.now() - entry.inactiveAt! < 5 * 60_000)
        continue
      releaseView(key)
      counts.set(entry.windowId, counts.get(entry.windowId)! - 1)
    }
  }
  const reap = setInterval(prune, 30_000)
  reap.unref()
  const releaseWindow = (window: BrowserWindow, detach: boolean) => {
    workspaces.delete(window)
    tabCounts.delete(window.id)
    activeViews.delete(window.id)
    windowTabs.delete(window.id)
    focusedTabs.delete(window.id)
    for (const key of awakeRequests.keys())
      if (key.startsWith(`[${window.id},`)) awakeRequests.delete(key)
    media.releaseWindow(window.id)
    for (const [profileId, owner] of profileWindows)
      if (owner.window === window) profileWindows.delete(profileId)
    for (const [key, current] of views) {
      if (current.windowId !== window.id) continue
      exitFullscreen(current, true)
      views.delete(key)
      awakeRequests.delete(key)
      cdp?.remove(key)
      if (current.workspace) {
        extensions.removeTab(current.profileId, current.contents)
        media.releaseTab(current.contents)
      }
      closePopups(current)
      if (detach) window.contentView.removeChildView(current.view)
      if (!current.contents.isDestroyed()) current.contents.close()
      clearPrivateProfile(current.profileId, current.browserSession)
    }
  }
  const registerWindow = (window: BrowserWindow) => {
    if (!registered.has(window)) {
      registered.add(window)
      const resizeFullscreen = () => {
        for (const entry of views.values()) if (entry.window === window) fitFullscreen(entry)
      }
      const visibilityChanged = () => {
        for (const entry of views.values()) if (entry.window === window) reportVisibility(entry)
      }
      window.on('minimize', visibilityChanged)
      window.on('restore', visibilityChanged)
      window.on('hide', visibilityChanged)
      window.on('show', visibilityChanged)
      window.on('resize', resizeFullscreen)
      window.on('enter-full-screen', resizeFullscreen)
      window.contentView.on('bounds-changed', resizeFullscreen)
      window.once('closed', () => releaseWindow(window, false))
      // A renderer reload loses its tab IDs. Release their main-process owners too.
      window.webContents.on('did-start-navigation', (event) => {
        if (event.isMainFrame && !event.isSameDocument) releaseWindow(window, true)
      })
      window.webContents.on('render-process-gone', () => releaseWindow(window, true))
      const cancelFocusRestore = () => {
        for (const entry of views.values())
          if (entry.windowId === window.id) entry.restoreFocus = false
      }
      window.webContents.on('before-mouse-event', (_event, input) => {
        if (input.type === 'mouseDown') cancelFocusRestore()
      })
      window.webContents.on('before-input-event', (_event, input) => {
        if (input.type === 'keyDown' && input.key !== 'Escape') cancelFocusRestore()
      })
    }
  }
  /** One native page per renderer tab key; extension-opened tabs use the same construction. */
  const openProfileLink = async (
    window: BrowserWindow,
    url: string,
    profileId: string,
    source?: Entry,
  ) => {
    await extensions.prepare(profileId)
    if (
      disposed ||
      window.isDestroyed() ||
      (source &&
        (source.contents.isDestroyed() ||
          views.get(JSON.stringify([source.windowId, source.key])) !== source))
    )
      return
    const events = tabEvents(window.id)
    if (
      events.created.length >= MAX_EXTENSION_TAB_EVENTS ||
      [...views.values()].filter((entry) => entry.windowId === window.id).length >= 100
    )
      throw new Error('Close a tab before opening more links.')
    const key = `routed:${randomUUID()}`
    const child = createEntry(window, JSON.stringify([window.id, key]), key, profileId, true)
    child.inactiveAt = Date.now()
    setVisible(child, false)
    child.url = url
    child.loading = loadUntilReady(child, url).catch((cause: unknown) => {
      if (!isAborted(cause))
        child.navigationError = cause instanceof Error ? cause.message : String(cause)
    })
    events.created.push({
      key,
      url,
      profileId,
      active: true,
      ...(source ? { openerKey: source.key } : {}),
    })
    return true
  }
  const routeProfileLink = (source: Entry, url: string) => {
    const profileId = websiteLinkProfile(source.profileId, url)
    if (!profileId || profileId === source.profileId) return false
    void openProfileLink(source.window, url, profileId, source).catch((cause: unknown) => {
      source.navigationError = `Could not open the link in its browser profile: ${String(cause)}`
    })
    return true
  }
  const createEntry = (
    window: BrowserWindow,
    viewKey: string,
    key: string,
    profileId: string,
    workspace: boolean,
    options?: Electron.WebContentsViewConstructorOptions,
  ) => {
    const view = new WebContentsView({
      ...options,
      webPreferences: {
        ...options?.webPreferences,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        // The session preload supplies Document PiP through a same-origin native popup.
        // Keep Electron's broken native implementation disabled (electron#39633).
        disableBlinkFeatures: 'DocumentPictureInPictureAPI',
        partition: workspace
          ? workspacePartition(profileId)
          : `${isPrivateBrowserProfile(profileId) ? '' : 'persist:'}dovo-preview:${profileId}`,
      },
    })
    view.setVisible(false)
    const created: Entry = {
      windowId: window.id,
      window,
      key,
      profileId,
      agentAccess: false,
      workspace,
      openedLinks: [],
      popups: new Set(),
      view,
      contents: view.webContents,
      browserSession: view.webContents.session,
      url: '',
    }
    if (workspace && !routingSessions.has(created.browserSession)) {
      const browserSession = created.browserSession
      routingSessions.add(browserSession)
      // webRequest is unavailable to installed extensions. Keep one listener per
      // owned session, and only consider navigations marked by will-navigate.
      browserSession.webRequest.onBeforeRequest((details, respond) => {
        if (details.resourceType !== 'mainFrame' || details.webContentsId === undefined) {
          respond({})
          return
        }
        const source = [...views.values()].find(
          (entry) => entry.contents.id === details.webContentsId,
        )
        const navigation = source?.routeNavigation
        if (source) source.routeNavigation = undefined
        const routed =
          !!source &&
          source.workspace &&
          !source.contents.isDestroyed() &&
          navigation !== undefined &&
          navigation.split('#')[0] === details.url.split('#')[0] &&
          details.method === 'GET' &&
          routeProfileLink(source, navigation)
        // Stop the navigation before cancelling its request so Chromium keeps
        // the opener document instead of committing a blocked-request page.
        if (routed) source.contents.stop()
        respond({ cancel: routed })
      })
    }
    view.webContents.once('destroyed', () => {
      const currentKey = JSON.stringify([created.windowId, created.key])
      if (views.get(currentKey) !== created) return
      if (
        activeViews.get(created.windowId)?.key === currentKey &&
        !created.window.webContents.isDestroyed()
      )
        created.window.webContents.focus()
      releaseView(currentKey)
      if (created.workspace) {
        const events = tabEvents(created.windowId)
        if (events.closed.length < MAX_EXTENSION_TAB_EVENTS) events.closed.push(created.key)
      }
    })
    view.webContents.on('render-process-gone', (_event, details) => {
      if (details.reason !== 'clean-exit')
        created.navigationError = 'This page stopped unexpectedly. Reload to try again.'
    })
    view.webContents.ipc.on('browser:notification-click', (event) => {
      if (created.workspace && event.senderFrame === view.webContents.mainFrame) focusTab(created)
    })
    view.webContents.ipc.on('browser:video-pip', (event, active: unknown) => {
      if (!created.workspace || !event.senderFrame || typeof active !== 'boolean') return
      created.videoPictureInPicture = active
      view.webContents.setBackgroundThrottling(
        !active && !created.keepAwake && !created.documentPip,
      )
    })
    view.webContents.on('enter-html-full-screen', () => {
      if (
        !created.workspace ||
        activeViews.get(created.windowId)?.key !==
          JSON.stringify([created.windowId, created.key]) ||
        !view.getVisible()
      ) {
        void view.webContents
          .executeJavaScript('document.fullscreenElement && document.exitFullscreen()')
          .catch((error: unknown) => console.error('Could not exit browser fullscreen.', error))
        return
      }
      created.fullscreenBounds ??= view.getBounds()
      fitFullscreen(created)
    })
    view.webContents.on('leave-html-full-screen', () => {
      if (!created.fullscreenBounds) return
      view.setBounds(created.fullscreenBounds)
      created.fullscreenBounds = undefined
      created.fullscreenWindowWasFullscreen = undefined
    })
    view.webContents.on('did-navigate', () => {
      if (created.documentPip && !created.documentPip.isDestroyed()) created.documentPip.close()
      created.videoPictureInPicture = false
      view.webContents.setBackgroundThrottling(!created.keepAwake)
    })
    // Service-worker clients.focus() and Chromium's native notification focus follow this path.
    view.webContents.on('focus', () => {
      if (
        created.workspace &&
        !view.getVisible() &&
        openableUrl(created.contents.getURL()) &&
        !windowTabs.get(created.windowId)?.created.some((tab) => tab.key === created.key)
      )
        focusTab(created)
    })
    // Websites such as Teams reject Electron-branded user agents despite a supported engine.
    // Only website views use Chromium's UA; Studio and runtime request identities are unchanged.
    const userAgent = view.webContents
      .getUserAgent()
      .replace(/\s+(?:Electron|DovoStudio|Dovo-Studio)\/[^\s]+/g, '')
    view.webContents.setUserAgent(userAgent)
    configureBrowserLanguage(view.webContents.session, profileId, userAgent)
    view.webContents.on('dom-ready', () => {
      const contents = view.webContents
      reportVisibility(created)
      if (!/^https?:\/\//i.test(contents.getURL())) return
      void contents
        .executeJavaScriptInIsolatedWorld(1001, [
          { code: websiteCustomization(profileId, contents.getURL()) },
        ])
        .catch((error: unknown) => console.error('Could not apply website customization', error))
    })
    let faviconCandidates: string[] = []
    let navigationRevision = 0
    const faviconLoader = createBrowserFaviconLoader(
      (url, signal) => view.webContents.session.fetch(url, { signal, credentials: 'include' }),
      (favicon) => {
        if (view.webContents.isDestroyed()) return
        created.favicon = favicon
        if (!created.workspace) return
        const events = tabEvents(created.windowId)
        events.favicons = events.favicons.filter((item) => item.key !== created.key)
        events.favicons.push({ key: created.key, url: view.webContents.getURL(), favicon })
      },
    )
    view.webContents.once('destroyed', () => faviconLoader.reset())
    view.webContents.on('did-start-navigation', (_event, _url, inPlace, isMainFrame) => {
      if (!isMainFrame || inPlace) return
      navigationRevision++
      faviconLoader.reset()
      faviconCandidates = []
      created.favicon = undefined
    })
    view.webContents.on('page-favicon-updated', (_event, icons) => {
      faviconCandidates = icons
      void faviconLoader.load(view.webContents.getURL(), icons)
    })
    view.webContents.on('did-finish-load', () => {
      void faviconLoader.load(view.webContents.getURL(), faviconCandidates)
    })
    view.webContents.on('will-navigate', (_event, url) => {
      if (created.workspace) created.routeNavigation = openableUrl(url)
    })
    view.webContents.on('did-stop-loading', () => {
      created.routeNavigation = undefined
    })
    view.webContents.on('context-menu', (_event, params) => {
      if (
        !created.workspace ||
        views.get(JSON.stringify([created.windowId, created.key])) !== created
      )
        return
      const navigation = view.webContents.navigationHistory
      const items: Electron.MenuItemConstructorOptions[] = []
      if (
        params.mediaType === 'video' &&
        (params.mediaFlags.canShowPictureInPicture ||
          params.mediaFlags.isShowingPictureInPicture) &&
        params.frame &&
        params.frame === view.webContents.mainFrame
      ) {
        const frame = params.frame
        const frameUrl = frame.url
        const revision = navigationRevision
        const { x, y } = params
        items.push(
          {
            label: params.mediaFlags.isShowingPictureInPicture
              ? 'Exit Picture-in-Picture'
              : 'Picture-in-Picture',
            click: () => {
              if (
                view.webContents.isDestroyed() ||
                view.webContents.mainFrame !== frame ||
                frame.url !== frameUrl ||
                navigationRevision !== revision
              )
                return
              const script = `(async () => {
              const videos = Array.from(document.querySelectorAll('video')).filter((video) => {
                const rect = video.getBoundingClientRect()
                return rect.width > 0 && rect.height > 0 && ${x} >= rect.left && ${x} < rect.right && ${y} >= rect.top && ${y} < rect.bottom
              })
              if (videos.length !== 1) throw new Error('Could not identify the selected video.')
              if (document.pictureInPictureElement === videos[0]) await document.exitPictureInPicture()
              else await videos[0].requestPictureInPicture()
              return true
            })()`
              void frame.executeJavaScript(script, true).catch((error: unknown) => {
                console.error('Could not change picture-in-picture.', error)
              })
            },
          },
          { type: 'separator' },
        )
      }
      items.push(
        { label: 'Back', enabled: navigation.canGoBack(), click: () => navigation.goBack() },
        {
          label: 'Forward',
          enabled: navigation.canGoForward(),
          click: () => navigation.goForward(),
        },
        { label: 'Reload', click: () => view.webContents.reload() },
        { type: 'separator' },
      )
      if (params.linkURL && openableUrl(params.linkURL))
        items.push(
          {
            label: 'Open link in new tab',
            click: () => {
              if (!routeProfileLink(created, params.linkURL)) queueLink(created, params.linkURL)
            },
          },
          { label: 'Copy link address', click: () => clipboard.writeText(params.linkURL) },
          { type: 'separator' },
        )
      const text =
        params.formControlType === 'input-password' ? '' : params.selectionText.slice(0, 32000)
      if (text)
        items.push(
          { label: 'Copy', click: () => clipboard.writeText(text) },
          {
            label: 'Add selection to thread…',
            click: () =>
              created.window.webContents.send('browser:context-action', {
                key,
                action: 'selection',
                text,
                url: view.webContents.getURL().slice(0, 4096),
                title: view.webContents.getTitle().slice(0, 500),
              }),
          },
        )
      if (params.isEditable)
        items.push({ role: 'cut', enabled: !!text }, { role: 'paste' }, { role: 'selectAll' })
      items.push(
        { type: 'separator' },
        { label: 'Copy page address', click: () => clipboard.writeText(view.webContents.getURL()) },
        {
          label: 'Add page to thread…',
          click: () =>
            created.window.webContents.send('browser:context-action', {
              key,
              action: 'page',
              text: '',
              url: view.webContents.getURL().slice(0, 4096),
              title: view.webContents.getTitle().slice(0, 500),
            }),
        },
      )
      const page = openableUrl(view.webContents.getURL())
      if (page) {
        const origin = new URL(page).origin
        const permissions = browserPermissions(profileId)
        items.push(
          { type: 'separator' },
          {
            label: `Allow notifications from ${origin}`,
            type: 'checkbox',
            checked: permissions.notification(origin) === true,
            click: (item) => permissions.setNotification(origin, item.checked),
          },
        )
      }
      Menu.buildFromTemplate(items).popup({ window: created.window })
    })
    view.webContents.setIgnoreMenuShortcuts(workspace)
    const pipWindowOptions = workspace
      ? authorizeDocumentPip(
          view.webContents,
          () =>
            (!view.getVisible() || created.window.isMinimized() || !created.window.isVisible()) &&
            browserPermissions(profileId).site(new URL(view.webContents.getURL()).origin)
              .permissions['automatic-pip'] === 'allow',
        )
      : () => undefined
    view.webContents.setWindowOpenHandler((details) => {
      if (
        !created.workspace ||
        views.get(JSON.stringify([created.windowId, created.key])) !== created
      )
        return { action: 'deny' }
      const pipOptions = pipWindowOptions(details)
      if (pipOptions) {
        for (const entry of views.values())
          if (entry.documentPip && !entry.documentPip.isDestroyed()) entry.documentPip.close()
        return { action: 'allow', overrideBrowserWindowOptions: pipOptions }
      }
      if (details.frameName?.startsWith(DOCUMENT_PIP_NAME)) return { action: 'deny' }
      if (details.postBody) {
        // Never replay a form POST as a GET tab; load it here, or refuse it visibly.
        const url = openableUrl(details.url)
        const options = url && postNavigation(details)
        if (!url || !options) created.navigationError = POST_REFUSED
        else
          created.view.webContents.loadURL(url, options).catch((error: unknown) => {
            // A newer navigation by the user aborts this one; that is not a failure.
            if (!isAborted(error)) created.navigationError = POST_FAILED
          })
        return { action: 'deny' }
      }
      if (popupRequest(details) && openableUrl(details.url)) {
        if (created.popups.size >= MAX_POPUPS) return { action: 'deny' }
        // The popup keeps the opener's session (profile) and sandbox; it never gets Node.
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            parent: created.window,
            autoHideMenuBar: true,
            webPreferences: {
              sandbox: true,
              contextIsolation: true,
              nodeIntegration: false,
              disableBlinkFeatures: 'DocumentPictureInPictureAPI',
              nodeIntegrationInSubFrames: false,
              webviewTag: false,
            },
          },
        }
      }
      if (openableUrl(details.url) && routeProfileLink(created, details.url))
        return { action: 'deny' }
      if (
        details.disposition !== 'other' &&
        (openableUrl(details.url) || details.url === 'about:blank' || details.url === '')
      ) {
        const events = tabEvents(created.windowId)
        if (
          events.created.length >= MAX_EXTENSION_TAB_EVENTS ||
          [...views.values()].filter((entry) => entry.windowId === created.windowId).length >= 100
        )
          return { action: 'deny' }
        return {
          action: 'allow',
          createWindow: (options) => {
            const childKey = `${created.key.slice(0, created.key.lastIndexOf(':') + 1)}${randomUUID()}`
            const child = createEntry(
              created.window,
              JSON.stringify([created.windowId, childKey]),
              childKey,
              profileId,
              true,
              options,
            )
            child.pageCreated = true
            child.inactiveAt = Date.now()
            child.url = openableUrl(details.url) ?? 'about:blank'
            events.created.push({
              key: childKey,
              url: child.url === 'about:blank' ? '' : child.url,
              profileId,
              active: details.disposition !== 'background-tab',
              openerKey: created.key,
            })
            return child.view.webContents
          },
        }
      }
      return { action: 'deny' }
    })
    view.webContents.on('did-create-window', (popup, details) => {
      if (
        views.get(JSON.stringify([created.windowId, created.key])) !== created ||
        !created.workspace
      ) {
        popup.close()
        return
      }
      const documentPip = details?.frameName?.startsWith(`${DOCUMENT_PIP_NAME}:`)
      if (documentPip) {
        created.documentPip = popup
        view.webContents.setBackgroundThrottling(false)
        // A PiP document must never navigate away from its inherited origin.
        popup.webContents.on('will-navigate', (event) => event.preventDefault())
        popup.webContents.on('will-redirect', (event) => event.preventDefault())
        if (String(Reflect.get(details.options ?? {}, 'dovo-disallow-return')) !== '1')
          popup.webContents.on('context-menu', () => {
            Menu.buildFromTemplate([
              {
                label: 'Return to tab',
                click: () => {
                  focusTab(created)
                  popup.close()
                },
              },
            ]).popup({ window: popup })
          })
      }
      created.popups.add(popup)
      popup.once('closed', () => {
        created.popups.delete(popup)
        if (created.documentPip === popup) {
          created.documentPip = undefined
          if (!view.webContents.isDestroyed())
            view.webContents.setBackgroundThrottling(
              !created.keepAwake && !created.videoPictureInPicture,
            )
        }
      })
      httpOnly(popup.webContents)
      popup.webContents.setIgnoreMenuShortcuts(true)
      popup.webContents.on('before-input-event', (_event, input) =>
        syncMenuShortcuts(popup.webContents, input),
      )
      popup.webContents.setWindowOpenHandler((details) => {
        if (details.postBody) created.navigationError = POST_REFUSED
        else queueLink(created, details.url)
        return { action: 'deny' }
      })
    })
    view.webContents.on('before-mouse-event', (_event, input) => {
      // A site-isolated redirect or extension popup may leave keyboard focus in another
      // renderer. Give the page focus on deliberate clicks, never on polling or resizing.
      if (
        input.type === 'mouseDown' &&
        activeViews.get(created.windowId)?.key === JSON.stringify([created.windowId, created.key])
      )
        view.webContents.focus()
    })
    view.webContents.on('before-input-event', (event, input) => {
      if (!created.workspace) return
      syncMenuShortcuts(view.webContents, input)
      const key = tabShortcut(input)
      if (!key) return
      // Native views take keyboard focus from the Studio DOM; replay tab shortcuts there.
      event.preventDefault()
      const main = created.window.webContents
      if (input.isAutoRepeat || main.isDestroyed()) return
      const modifiers: Array<'meta' | 'control' | 'shift'> = [
        process.platform === 'darwin' ? 'meta' : 'control',
        ...(input.shift ? (['shift'] as const) : []),
      ]
      const keyCode = input.shift ? key.toUpperCase() : key
      main.focus()
      main.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
      main.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
    })
    if (workspace) {
      // Shared-browser pages may ask to share a tab or use the camera/microphone, never silently.
      media.attachSession(view.webContents.session, profileId)
      media.attachTab(view.webContents)
    } else {
      view.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) =>
        callback(false),
      )
      view.webContents.session.setPermissionCheckHandler(() => false)
    }
    httpOnly(
      view.webContents,
      workspace
        ? (url) =>
            (created.pageCreated && url === 'about:blank') || extensions.ownsUrl(profileId, url)
        : undefined,
    )
    window.contentView.addChildView(view)
    views.set(viewKey, created)
    if (workspace) extensions.addTab(profileId, view.webContents, window)
    registerWindow(window)
    return created
  }
  const trustedWindow = (event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    // Studio windows differ only by hash (#thread=…, #browser-window=…); paths, queries and
    // foreign origins stay untrusted.
    if (
      !window ||
      !event.senderFrame ||
      event.senderFrame !== event.sender.mainFrame ||
      !trustedRendererUrl(
        event.senderFrame.url,
        indexPath,
        process.env.VITE_DEV_SERVER_URL || undefined,
      )
    )
      throw new Error('Untrusted browser request')
    if (!workspaces.has(window) && !new URL(event.senderFrame.url).hash.startsWith('#thread=')) {
      workspaces.add(window)
    }
    registerWindow(window)
    return window
  }
  ipcMain.handle('browser:extensions', async (event, raw: unknown) =>
    extensions.handle(trustedWindow(event), raw),
  )
  /**
   * Turning experimental Browser off must stop extensions now, not when hidden tabs expire.
   * Connection storage owns this channel's reply; this listener only re-reads the saved setting.
   */
  const syncExtensions = async () => {
    if (await extensions.sync()) {
      for (const entry of views.values())
        if (entry.workspace && !entry.view.webContents.isDestroyed())
          configureBrowserLanguage(
            entry.view.webContents.session,
            entry.profileId,
            entry.view.webContents.getUserAgent(),
          )
      return
    }
    awakeRequests.clear()
    media.reset()
    // Content scripts outlive their extension in already-open pages, so close those pages too.
    for (const [key, entry] of views) {
      if (!entry.workspace) continue
      if (activeViews.get(entry.windowId)?.key === key) activeViews.delete(entry.windowId)
      releaseView(key)
    }
    windowTabs.clear()
  }
  ipcMain.on('app:settings-write', (event) => {
    try {
      trustedWindow(event)
    } catch {
      return
    }
    setImmediate(() => {
      syncExtensions().catch((error: unknown) => {
        console.error('Browser extensions could not apply the Browser setting.', error)
      })
    })
  })
  /** Retain external links until the workspace can adopt their native or remote destination. */
  const openWorkspaceTab = async (
    window: BrowserWindow,
    key: string,
    input: BrowserWorkspaceTab,
  ) => {
    const tab = { ...input, url: previewUrl(input.url) }
    if (tab.kind === 'remote' && !tab.runtimeId)
      throw new Error('Choose a computer for this remote browser tab.')
    const events = tabEvents(window.id)
    const checkCapacity = () => {
      if ((tabCounts.get(window.id) ?? 1) + events.moved.length + events.created.length >= 100)
        throw new Error('Close a tab before opening more links.')
    }
    checkCapacity()
    if (tab.kind === 'web') await extensions.prepare(tab.profileId)
    if (disposed || window.isDestroyed()) throw new Error('The browser window has closed.')
    checkCapacity()
    registerWindow(window)
    workspaces.add(window)
    if (tab.kind === 'web') {
      const viewKey = JSON.stringify([window.id, key])
      if (views.has(viewKey)) throw new Error('This browser tab is already open.')
      const page = createEntry(window, viewKey, key, tab.profileId, true)
      page.inactiveAt = Date.now()
      setVisible(page, false)
      page.url = tab.url
      page.loading = loadUntilReady(page, tab.url).catch((cause: unknown) => {
        if (!isAborted(cause))
          page.navigationError = cause instanceof Error ? cause.message : String(cause)
      })
    }
    // Reuse the workspace's retained handoff queue for both native and remote
    // tabs. Thread previews cannot consume it before Browser mounts.
    events.moved.push({ key, tab })
  }
  ipcMain.handle('preview:browser', async (event, raw: unknown) => {
    const window = trustedWindow(event)
    const command = decode(browserCommandSchema, raw)
    if (command.action === 'open-tab') return openWorkspaceTab(window, command.key, command.tab)
    if (command.action === 'external') {
      await shell.openExternal(previewUrl(command.url))
      return
    }
    const viewKey = JSON.stringify([window.id, command.key])
    let entry = views.get(viewKey)
    if (command.action === 'keep-awake') {
      const request = {}
      awakeRequests.set(viewKey, request)
      if (!entry && command.enabled) {
        const url = previewUrl(command.url)
        await extensions.prepare(command.profileId)
        if (awakeRequests.get(viewKey) !== request || window.isDestroyed()) return
        entry = views.get(viewKey)
        if (!entry) {
          entry = createEntry(window, viewKey, command.key, command.profileId, true)
          entry.inactiveAt = Date.now()
          setVisible(entry, false)
          entry.url = url
          entry.loading = loadUntilReady(entry, url)
        }
      }
      if (!entry) return
      if (!entry.workspace || entry.profileId !== command.profileId)
        throw new Error('The tab changed before Keep awake could be updated.')
      entry.keepAwake = command.enabled
      entry.contents.setBackgroundThrottling(
        !command.enabled && !entry.videoPictureInPicture && !entry.documentPip,
      )
      await entry.loading
      return
    }
    if (command.action === 'status' && command.tabCount !== undefined)
      tabCounts.set(window.id, command.tabCount)
    if (command.action === 'browser-windows') {
      const windows = [...new Set([...workspaces, ...(browserWindows?.list() ?? [])])]
        .filter((other) => other !== window && !other.isDestroyed())
        .map((other) => {
          const page = views.get(activeViews.get(other.id)?.key ?? '')
          const title = page?.view.webContents.getTitle() || other.getTitle() || 'Dovo Browser'
          return { id: other.id, title: `${title} · Window ${other.id}` }
        })
      return { url: '', back: false, forward: false, windows }
    }
    if (command.action === 'move-tab') {
      const validateSource = () => {
        if (
          window.isDestroyed() ||
          views.get(viewKey) !== entry ||
          (entry &&
            (!entry.workspace ||
              entry.profileId !== command.tab.profileId ||
              command.tab.kind !== 'web' ||
              entry.view.webContents.isDestroyed()))
        )
          throw new Error('The browser tab changed before it could be moved.')
        if (
          entry &&
          (media.keepAlive(entry.view.webContents) ||
            entry.videoPictureInPicture ||
            entry.documentPip)
        )
          throw new Error(
            'Stop this tab’s active media or sharing before moving it to another window.',
          )
        if (entry?.fullscreenBounds)
          throw new Error('Exit website fullscreen before moving this tab to another window.')
      }
      // Reject a busy or stale source before creating an otherwise empty destination.
      validateSource()
      const target =
        command.targetWindowId === undefined
          ? await browserWindows?.create()
          : [...workspaces, ...(browserWindows?.list() ?? [])].find(
              (other) => other.id === command.targetWindowId,
            )
      if (!target || target === window || target.isDestroyed())
        throw new Error('The destination browser window is unavailable.')
      // Loading a new window yields; the source may have closed or started sharing meanwhile.
      validateSource()
      if ((tabCounts.get(target.id) ?? 1) + tabEvents(target.id).moved.length >= 100)
        throw new Error('The destination browser window has reached its 100-tab limit.')
      registerWindow(target)
      awakeRequests.delete(viewKey)
      if (entry) {
        closePopups(entry)
        if (activeViews.get(window.id)?.key === viewKey) activeViews.delete(window.id)
        setVisible(entry, false)
        window.contentView.removeChildView(entry.view)
        views.delete(viewKey)
        extensions.removeTab(entry.profileId, entry.view.webContents)
        entry.windowId = target.id
        entry.window = target
        entry.inactiveAt = Date.now()
        entry.restoreFocus = false
        views.set(JSON.stringify([target.id, command.key]), entry)
        target.contentView.addChildView(entry.view)
        extensions.addTab(entry.profileId, entry.view.webContents, target)
        profileWindows.set(entry.profileId, { window: target, key: command.key })
      }
      tabEvents(target.id).moved.push({
        key: command.key,
        tab: entry
          ? {
              ...command.tab,
              url:
                entry.view.webContents.getURL() === 'about:blank'
                  ? ''
                  : entry.view.webContents.getURL(),
              title: entry.view.webContents.getTitle().slice(0, 4096),
              favicon: entry.favicon ?? undefined,
            }
          : command.tab,
      })
      if (target.isMinimized()) target.restore()
      target.webContents.send('browser:focus-workspace')
      target.show()
      target.focus()
      return
    }
    if (command.action === 'close') {
      awakeRequests.delete(viewKey)
      if (activeViews.get(window.id)?.key === viewKey) activeViews.delete(window.id)
      if (entry) {
        releaseView(viewKey)
      }
      return
    }
    if (command.action === 'hide') {
      if (activeViews.get(window.id)?.key === viewKey) activeViews.delete(window.id)
      if (entry?.key === command.key) {
        exitFullscreen(entry)
        entry.restoreFocus = !!(
          command.preserveFocus &&
          (entry.restoreFocus || entry.view.webContents.isFocused())
        )
        // Studio must receive Escape while the native page is hidden. Remember page
        // focus and return it only if the user has not interacted with Studio meanwhile.
        focusStudio(entry)
        entry.inactiveAt ??= Date.now()
        setVisible(entry, false)
        prune()
      }
      return
    }
    if (command.action === 'show') {
      const profileId = command.profileId ?? 'default'
      const workspace = !!command.workspaceBrowser
      // Adopting an extension-opened tab keeps its extension page; every other URL must be web.
      const url =
        (entry?.extensionUrl === command.url ||
          (entry?.pageCreated && command.url === 'about:blank')) &&
        entry?.workspace === workspace
          ? command.url
          : previewUrl(command.url)
      const showing = { key: viewKey }
      activeViews.set(window.id, showing)
      if (workspace) {
        profileWindows.set(profileId, { window, key: command.key })
        // Extensions load before the profile's first page so content scripts see it.
        await extensions.prepare(profileId).catch((error: unknown) => {
          console.error('Browser extensions could not load for this profile.', error)
        })
        if (activeViews.get(window.id) !== showing) return
        entry = views.get(viewKey)
      }
      if (entry) entry.inactiveAt = undefined
      for (const [key, other] of views) {
        if (other.windowId !== window.id || other === entry) continue
        exitFullscreen(other)
        other.restoreFocus = false
        setVisible(other, false)
        other.inactiveAt ??= Date.now()
        if (other.taskId === command.taskId && !command.agentAccess) {
          other.agentAccess = false
          cdp?.remove(key)
          other.cdp = undefined
        }
      }
      // Shared-browser and thread-preview storage never mix, so a mode change needs a new view.
      if (entry && (entry.profileId !== profileId || entry.workspace !== workspace)) {
        releaseView(viewKey)
        entry = undefined
      }
      entry ??= createEntry(window, viewKey, command.key, profileId, workspace)
      prune()
      if (entry.workspace) extensions.selectTab(profileId, entry.view.webContents)
      entry.agentAccess = !!(command.agentAccess && command.taskId && directory)
      entry.taskId = command.taskId
      if (command.agentAccess && command.taskId && directory) {
        cdpPending ??= createBrowserCdp(directory).catch((error) => {
          cdpPending = undefined
          throw error
        })
        cdp = await cdpPending
        if (
          views.get(viewKey) !== entry ||
          activeViews.get(window.id) !== showing ||
          !entry.agentAccess ||
          entry.taskId !== command.taskId ||
          entry.view.webContents.isDestroyed()
        )
          return
        entry.cdp = cdp.register(viewKey, command.taskId, profileId, entry.view.webContents)
      } else if (entry.cdp) {
        cdp?.remove(viewKey)
        entry.cdp = undefined
      }
      if (activeViews.get(window.id) !== showing) return
      const [width, height] = window.getContentSize()
      // DOM rectangles use CSS pixels; native views and popup anchors use window DIPs.
      const zoom = window.webContents.getZoomFactor()
      const requested = {
        x: Math.round(command.bounds.x * zoom),
        y: Math.round(command.bounds.y * zoom),
        width: Math.max(1, Math.round(command.bounds.width * zoom)),
        height: Math.max(1, Math.round(command.bounds.height * zoom)),
      }
      const { x, y } = requested
      if (x >= width || y >= height) {
        entry.inactiveAt ??= Date.now()
        setVisible(entry, false)
        return
      }
      const bounds = {
        ...requested,
        width: Math.min(requested.width, width - x),
        height: Math.min(requested.height, height - y),
      }
      if (entry.fullscreenBounds) entry.fullscreenBounds = bounds
      else entry.view.setBounds(bounds)
      if (entry.url !== url) {
        entry.url = url
        entry.loading =
          entry.view.webContents.getURL() === url ? undefined : loadUntilReady(entry, url)
      }
      const loading = entry.loading
      if (loading) {
        try {
          await loading
        } catch (error) {
          if (entry.loading === loading) {
            entry.loading = undefined
            if (!isAborted(error)) entry.url = ''
          }
          // Redirects and a user reload abort loadURL without making the live page unusable.
          if (!isAborted(error)) throw error
        }
        if (entry.loading === loading) entry.loading = undefined
      }
      if (
        views.get(viewKey) !== entry ||
        activeViews.get(window.id) !== showing ||
        entry.url !== url ||
        entry.view.webContents.isDestroyed()
      )
        return
      // Electron requires a live renderer before either device-emulation call.
      // Every concurrent show waits for DOM readiness, including resize commands.
      if (command.viewport) {
        const { width: vw, height: vh } = command.viewport
        entry.view.webContents.enableDeviceEmulation({
          screenPosition: 'mobile',
          screenSize: {
            width: vw,
            height: vh,
          },
          viewSize: {
            width: vw,
            height: vh,
          },
          deviceScaleFactor: 1,
          scale: Math.min(bounds.width / vw, bounds.height / vh),
          viewPosition: {
            x: 0,
            y: 0,
          },
        })
      } else entry.view.webContents.disableDeviceEmulation()
      // Reinsert the selected page above retained sibling views for native hit testing.
      window.contentView.addChildView(entry.view)
      setVisible(entry, true)
      if (entry.restoreFocus) {
        entry.restoreFocus = false
        entry.view.webContents.focus()
      }
      return
    }
    if (command.action === 'thread-media-sources')
      return media.setThreadSources(window.id, command.sources)
    if (command.action === 'remote-media-sources')
      return media.setRemoteSources(window.id, command.sources)
    if (command.action === 'media') return media.decide(window.id, command)
    if (command.action === 'media-status')
      return {
        url: '',
        back: false,
        forward: false,
        ...media.snapshot(window.id),
        callTabs: callTabs(window.id),
      }
    if (command.action === 'tab-activity') {
      const snapshot = media.snapshot(window.id)
      const protectedKeys = [...views.values()]
        .filter(
          (entry) =>
            entry.windowId === window.id &&
            entry.workspace &&
            (media.keepAlive(entry.view.webContents) ||
              entry.keepAwake ||
              entry.videoPictureInPicture ||
              entry.documentPip),
        )
        .map((entry) => entry.key)
      for (const capture of snapshot.captures ?? [])
        protectedKeys.push(capture.key, capture.sourceKey)
      return { url: '', back: false, forward: false, protectedKeys }
    }
    if (command.action === 'stop-capture') return media.stop(window.id, command)
    if (entry?.key !== command.key) {
      // An extension may have closed this very tab; its window still needs to hear about it.
      if (command.action !== 'status') return
      const events = {
        ...drainTabEvents(window.id, command.tabCount !== undefined),
        ...media.snapshot(window.id),
        ...(command.tabCount !== undefined && focusedTabs.has(window.id)
          ? { focusedTabKey: focusedTabs.get(window.id) }
          : {}),
      }
      if (command.tabCount !== undefined) focusedTabs.delete(window.id)
      return Object.keys(events).length
        ? { url: '', back: false, forward: false, ...events }
        : undefined
    }
    if (command.action === 'focus-tab') {
      if (!entry.workspace) throw new Error('Only Browser workspace tabs can be focused.')
      return focusTab(entry)
    }
    const navigation = entry.view.webContents.navigationHistory
    if (
      [
        'site-permissions',
        'set-site-permission',
        'request-site-permission',
        'clear-site-data',
      ].includes(command.action)
    ) {
      if (!entry.workspace)
        throw new Error('Website controls are available in the browser workspace.')
      const page = new URL(entry.view.webContents.getURL())
      if (!['http:', 'https:'].includes(page.protocol))
        throw new Error('Open a website to manage its permissions.')
      const origin = page.origin
      if (command.action !== 'site-permissions' && 'origin' in command && command.origin !== origin)
        throw new Error('The website changed. Open its controls again before changing permissions.')
      const permissions = browserPermissions(entry.profileId)
      if (command.action === 'set-site-permission') {
        permissions.setSite(origin, command.permission, command.setting)
        media.revokeSite(entry.profileId, origin)
      }
      if (command.action === 'clear-site-data')
        await entry.view.webContents.session.clearStorageData({ origin })
      if (command.action === 'request-site-permission') {
        permissions.setSite(origin, command.permission, 'ask')
        media.revokeSite(entry.profileId, origin)
        const script =
          command.permission === 'notifications'
            ? 'Notification.requestPermission()'
            : `navigator.mediaDevices.getUserMedia({${command.permission === 'camera' ? 'video' : 'audio'}:true}).then(stream => {stream.getTracks().forEach(track => track.stop()); return true})`
        await entry.view.webContents.executeJavaScript(script, true)
        if (
          entry.view.webContents.isDestroyed() ||
          new URL(entry.view.webContents.getURL()).origin !== origin
        )
          throw new Error('The website changed while requesting permission.')
      }
      return {
        url: page.href,
        back: navigation.canGoBack(),
        forward: navigation.canGoForward(),
        sitePermissions: permissions.site(origin),
      }
    }
    if (command.action === 'selection') {
      // A busy or hung page must not hold the request open; one attempt, then a clear error.
      const reading: Promise<unknown> = entry.view.webContents.executeJavaScript(
        `(${selectedBrowserText.toString()})()`,
      )
      let timer: ReturnType<typeof setTimeout> | undefined
      const selection = await Promise.race([
        reading,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('The page did not return its selection within 3 seconds.')),
            SELECTION_TIMEOUT,
          )
        }),
      ]).finally(() => clearTimeout(timer))
      return {
        url: entry.view.webContents.getURL(),
        title: entry.view.webContents.getTitle(),
        selection: typeof selection === 'string' ? selection.slice(0, 32000) : '',
        back: navigation.canGoBack(),
        forward: navigation.canGoForward(),
      }
    }
    if (command.action === 'screenshot') {
      const image = await entry.view.webContents.capturePage(undefined, { stayHidden: true })
      if (image.isEmpty()) throw new Error('The browser has no image to capture yet.')
      return {
        url: entry.view.webContents.getURL(),
        back: navigation.canGoBack(),
        forward: navigation.canGoForward(),
        image: image.toDataURL(),
      }
    }
    if (command.action === 'status') {
      const failure = entry.navigationError
      if (failure) {
        entry.navigationError = undefined
        throw new Error(failure)
      }
      const openedLinks = entry.openedLinks.splice(0)
      const focusedTabKey = command.tabCount !== undefined ? focusedTabs.get(window.id) : undefined
      if (command.tabCount !== undefined) focusedTabs.delete(window.id)
      return {
        url: entry.view.webContents.getURL(),
        title: entry.view.webContents.getTitle(),
        favicon: entry.favicon,
        cdp: entry.cdp,
        ...(focusedTabKey ? { focusedTabKey } : {}),
        back: navigation.canGoBack(),
        forward: navigation.canGoForward(),
        ...(openedLinks.length ? { openedLinks } : {}),
        ...drainTabEvents(window.id, entry.workspace || command.tabCount !== undefined),
        ...media.snapshot(window.id),
      }
    }
    if (command.action === 'back' && navigation.canGoBack()) navigation.goBack()
    if (command.action === 'forward' && navigation.canGoForward()) navigation.goForward()
    if (command.action === 'reload') entry.view.webContents.reload()
    if (command.action === 'hard-reload') entry.view.webContents.reloadIgnoringCache()
    if (command.action === 'devtools') entry.view.webContents.openDevTools({ mode: 'detach' })
  })
  return {
    /** Native external links become independent tabs, so bursts never overwrite navigation. */
    openRoutedLink: async (window: BrowserWindow, raw: string) => {
      const url = previewUrl(raw)
      const profileId = websiteLinkProfile('default', url, 'external')
      if (!profileId) return false
      const id = randomUUID()
      await openWorkspaceTab(window, `external:${id}`, {
        id,
        url,
        title: '',
        kind: 'web',
        profileId,
        visitedAt: Date.now(),
      })
      window.webContents.send('browser:focus-workspace')
      window.show()
      window.focus()
      return true
    },
    dispose: async () => {
      disposed = true
      for (const browserSession of routingSessions) browserSession.webRequest.onBeforeRequest(null)
      routingSessions.clear()
      awakeRequests.clear()
      focusedTabs.clear()
      clearInterval(reap)
      media.reset()
      for (const [key, entry] of views) {
        cdp?.remove(key)
        closePopups(entry)
        if (!entry.contents.isDestroyed()) entry.contents.close()
      }
      views.clear()
      activeViews.clear()
      windowTabs.clear()
      profileWindows.clear()
      await extensions.dispose()
      const bridge = cdp ?? (await cdpPending)
      await bridge?.close()
    },
  }
}
