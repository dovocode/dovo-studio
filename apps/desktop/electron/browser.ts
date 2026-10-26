import { selectedBrowserText, isPrivateBrowserProfile } from '@dovo/protocol'
import { createBrowserCdp } from './browser-cdp.js'
import { decode } from '@dovo/protocol'
import { BrowserWindow, WebContentsView, ipcMain, shell, Menu, clipboard } from 'electron'
import { trustedRendererUrl } from './renderer-trust.js'
import { createBrowserExtensions, workspacePartition } from './browser-extensions.js'
import { createBrowserMedia, type MediaTab } from './browser-media.js'
import { browserPermissions, forgetPrivateBrowserPermissions } from './browser-permissions.js'
import { configureBrowserLanguage } from './browser-language.js'
import { openThreadMedia } from './browser-thread-media.js'
import { randomUUID } from 'node:crypto'
import { browserCommandSchema, previewUrl } from '@dovo/protocol'
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
  favicon?: string
  /** Reported once by the next `status`; native POST loads have no other channel to the UI. */
  navigationError?: string
  popups: Set<BrowserWindow>
  taskId?: string
  cdp?: string
  view: WebContentsView
  url: string
  /** Extension page an extension opened here; the renderer adopts the tab with this exact URL. */
  extensionUrl?: string
  /** Created by Chromium itself, retaining target names, opener and deferred navigation. */
  pageCreated?: boolean
  /** Navigation readiness, without waiting for page subresources. */
  loading?: Promise<void>
  /** Restore page focus after a passive tooltip, unless Studio receives deliberate input. */
  restoreFocus?: boolean
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
export function registerBrowser(indexPath: string, directory?: string, preload?: string) {
  let cdp: Awaited<ReturnType<typeof createBrowserCdp>> | undefined
  let cdpPending: Promise<Awaited<ReturnType<typeof createBrowserCdp>>> | undefined
  // Identity distinguishes overlapping shows of the same tab after resize or a menu closes.
  const activeViews = new Map<number, { key: string }>()
  const registered = new WeakSet<BrowserWindow>()
  const views = new Map<string, Entry>()
  const focusStudio = (entry: Entry) => {
    if (
      !entry.view.webContents.isDestroyed() &&
      entry.view.webContents.isFocused() &&
      !entry.window.webContents.isDestroyed()
    )
      entry.window.webContents.focus()
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
    }
  >()
  const tabEvents = (windowId: number) => {
    let events = windowTabs.get(windowId)
    if (!events) windowTabs.set(windowId, (events = { created: [], closed: [] }))
    return events
  }
  const drainTabEvents = (windowId: number) => {
    const events = windowTabs.get(windowId)
    const createdTabs = events?.created.splice(0) ?? []
    const closedTabs = events?.closed.splice(0) ?? []
    return {
      ...(createdTabs.length ? { createdTabs } : {}),
      ...(closedTabs.length ? { closedTabs } : {}),
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
    focusStudio(entry)
    views.delete(key)
    cdp?.remove(key)
    if (entry.workspace) {
      extensions.removeTab(entry.profileId, entry.view.webContents)
      media.releaseTab(entry.view.webContents)
    }
    closePopups(entry)
    entry.window.contentView.removeChildView(entry.view)
    const browserSession = entry.view.webContents.session
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close()
    clearPrivateProfile(entry.profileId, browserSession)
  }
  const prune = () => {
    const inactive = [...views].filter(
      ([key, entry]) =>
        entry.inactiveAt !== undefined &&
        !isPrivateBrowserProfile(entry.profileId) &&
        !cdp?.connected(key) &&
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
    activeViews.delete(window.id)
    windowTabs.delete(window.id)
    media.releaseWindow(window.id)
    for (const [profileId, owner] of profileWindows)
      if (owner.window === window) profileWindows.delete(profileId)
    for (const [key, current] of views) {
      if (current.windowId !== window.id) continue
      views.delete(key)
      cdp?.remove(key)
      if (current.workspace) {
        extensions.removeTab(current.profileId, current.view.webContents)
        media.releaseTab(current.view.webContents)
      }
      closePopups(current)
      if (detach) window.contentView.removeChildView(current.view)
      const browserSession = current.view.webContents.session
      if (!current.view.webContents.isDestroyed()) current.view.webContents.close()
      clearPrivateProfile(current.profileId, browserSession)
    }
  }
  /** One native page per renderer tab key; extension-opened tabs use the same construction. */
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
        partition: workspace ? workspacePartition(profileId) : `persist:dovo-preview:${profileId}`,
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
      url: '',
    }
    // Websites such as Teams reject Electron-branded user agents despite a supported engine.
    // Only website views use Chromium's UA; Studio and runtime request identities are unchanged.
    const userAgent = view.webContents
      .getUserAgent()
      .replace(/\s+(?:Electron|DovoStudio|Dovo-Studio)\/[^\s]+/g, '')
    view.webContents.setUserAgent(userAgent)
    configureBrowserLanguage(view.webContents.session, profileId, userAgent)
    view.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => {
      if (isMainFrame) created.favicon = undefined
    })
    view.webContents.on('page-favicon-updated', (_event, icons) => {
      const page = view.webContents.getURL()
      const icon = icons.find((icon) => openableUrl(icon))
      if (!icon) return
      void (async () => {
        const response = await view.webContents.session.fetch(icon, {
          signal: AbortSignal.timeout(5000),
        })
        const mime = response.headers.get('content-type')?.split(';')[0]?.trim() ?? ''
        if (
          !response.ok ||
          !/^image\/(?:png|jpeg|gif|webp|x-icon|vnd.microsoft.icon|svg\+xml)$/.test(mime) ||
          Number(response.headers.get('content-length')) > 64 * 1024
        ) {
          await response.body?.cancel()
          return
        }
        const chunks: Buffer[] = []
        let size = 0
        if (!response.body) return
        for await (const chunk of response.body) {
          size += chunk.length
          if (size > 64 * 1024) return
          chunks.push(Buffer.from(chunk))
        }
        if (!view.webContents.isDestroyed() && view.webContents.getURL() === page)
          created.favicon = `data:${mime};base64,${Buffer.concat(chunks).toString('base64')}`
      })().catch(() => {
        /* Missing icons use the globe fallback. */
      })
    })
    view.webContents.on('context-menu', (_event, params) => {
      if (!created.workspace || views.get(viewKey) !== created) return
      const navigation = view.webContents.navigationHistory
      const items: Electron.MenuItemConstructorOptions[] = [
        { label: 'Back', enabled: navigation.canGoBack(), click: () => navigation.goBack() },
        {
          label: 'Forward',
          enabled: navigation.canGoForward(),
          click: () => navigation.goForward(),
        },
        { label: 'Reload', click: () => view.webContents.reload() },
        { type: 'separator' },
      ]
      if (params.linkURL && openableUrl(params.linkURL))
        items.push(
          { label: 'Open link in new tab', click: () => queueLink(created, params.linkURL) },
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
              window.webContents.send('browser:context-action', {
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
            window.webContents.send('browser:context-action', {
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
      Menu.buildFromTemplate(items).popup({ window })
    })
    view.webContents.setIgnoreMenuShortcuts(workspace)
    view.webContents.setWindowOpenHandler((details) => {
      if (!created.workspace || views.get(viewKey) !== created) return { action: 'deny' }
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
            parent: window,
            autoHideMenuBar: true,
            webPreferences: {
              sandbox: true,
              contextIsolation: true,
              nodeIntegration: false,
              nodeIntegrationInSubFrames: false,
              webviewTag: false,
            },
          },
        }
      }
      if (
        details.disposition !== 'other' &&
        (openableUrl(details.url) || details.url === 'about:blank' || details.url === '')
      ) {
        const events = tabEvents(window.id)
        if (
          events.created.length >= MAX_EXTENSION_TAB_EVENTS ||
          [...views.values()].filter((entry) => entry.windowId === window.id).length >= 100
        )
          return { action: 'deny' }
        return {
          action: 'allow',
          createWindow: (options) => {
            const childKey = `${created.key.slice(0, created.key.lastIndexOf(':') + 1)}${randomUUID()}`
            const child = createEntry(
              window,
              JSON.stringify([window.id, childKey]),
              childKey,
              profileId,
              true,
              options,
            )
            child.pageCreated = true
            child.inactiveAt = Date.now()
            child.url = openableUrl(details.url) ?? 'about:blank'
            const childContents = child.view.webContents
            const childSession = childContents.session
            childContents.once('destroyed', () => {
              const key = JSON.stringify([window.id, childKey])
              if (views.get(key) !== child) return
              views.delete(key)
              window.contentView.removeChildView(child.view)
              extensions.removeTab(profileId, childContents)
              media.releaseTab(childContents)
              const events = tabEvents(window.id)
              if (events.closed.length < MAX_EXTENSION_TAB_EVENTS) events.closed.push(childKey)
              clearPrivateProfile(profileId, childSession)
            })
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
    view.webContents.on('did-create-window', (popup) => {
      if (views.get(viewKey) !== created || !created.workspace) {
        popup.close()
        return
      }
      created.popups.add(popup)
      popup.once('closed', () => created.popups.delete(popup))
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
      if (input.type === 'mouseDown' && activeViews.get(window.id)?.key === viewKey)
        view.webContents.focus()
    })
    view.webContents.on('before-input-event', (event, input) => {
      if (!created.workspace) return
      syncMenuShortcuts(view.webContents, input)
      const key = tabShortcut(input)
      if (!key) return
      // Native views take keyboard focus from the Studio DOM; replay tab shortcuts there.
      event.preventDefault()
      const main = window.webContents
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
    if (!registered.has(window)) {
      registered.add(window)
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
  ipcMain.handle('preview:browser', async (event, raw: unknown) => {
    const window = trustedWindow(event)
    const command = decode(browserCommandSchema, raw)
    if (command.action === 'external') {
      await shell.openExternal(previewUrl(command.url))
      return
    }
    const viewKey = JSON.stringify([window.id, command.key])
    let entry = views.get(viewKey)
    if (command.action === 'close') {
      if (activeViews.get(window.id)?.key === viewKey) activeViews.delete(window.id)
      if (entry) {
        releaseView(viewKey)
      }
      return
    }
    if (command.action === 'hide') {
      if (activeViews.get(window.id)?.key === viewKey) activeViews.delete(window.id)
      if (entry?.key === command.key) {
        entry.restoreFocus = !!(
          command.preserveFocus &&
          (entry.restoreFocus || entry.view.webContents.isFocused())
        )
        // Studio must receive Escape while the native page is hidden. Remember page
        // focus and return it only if the user has not interacted with Studio meanwhile.
        focusStudio(entry)
        entry.inactiveAt ??= Date.now()
        entry.view.setVisible(false)
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
        other.restoreFocus = false
        other.view.setVisible(false)
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
        entry.view.setVisible(false)
        return
      }
      const bounds = {
        ...requested,
        width: Math.min(requested.width, width - x),
        height: Math.min(requested.height, height - y),
      }
      entry.view.setBounds(bounds)
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
      entry.view.setVisible(true)
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
      return { url: '', back: false, forward: false, ...media.snapshot(window.id) }
    if (command.action === 'tab-activity') {
      const snapshot = media.snapshot(window.id)
      const protectedKeys = [...views.values()]
        .filter(
          (entry) =>
            entry.windowId === window.id &&
            entry.workspace &&
            media.keepAlive(entry.view.webContents),
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
      const events = { ...drainTabEvents(window.id), ...media.snapshot(window.id) }
      return Object.keys(events).length
        ? { url: '', back: false, forward: false, ...events }
        : undefined
    }
    const navigation = entry.view.webContents.navigationHistory
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
      return {
        url: entry.view.webContents.getURL(),
        title: entry.view.webContents.getTitle(),
        favicon: entry.favicon,
        cdp: entry.cdp,
        back: navigation.canGoBack(),
        forward: navigation.canGoForward(),
        ...(openedLinks.length ? { openedLinks } : {}),
        ...drainTabEvents(window.id),
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
    dispose: async () => {
      clearInterval(reap)
      media.reset()
      for (const [key, entry] of views) {
        cdp?.remove(key)
        closePopups(entry)
        if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close()
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
