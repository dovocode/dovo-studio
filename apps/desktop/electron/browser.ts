import { createBrowserCdp } from './browser-cdp.js'
import { decode } from '@dovo/protocol'
import { BrowserWindow, WebContentsView, ipcMain, shell } from 'electron'
import { pathToFileURL } from 'node:url'
import { browserCommandSchema, previewUrl } from '@dovo/protocol'
export function registerBrowser(indexPath: string, directory?: string) {
  let cdp: Awaited<ReturnType<typeof createBrowserCdp>> | undefined
  let cdpPending: Promise<Awaited<ReturnType<typeof createBrowserCdp>>> | undefined
  const activeViews = new Map<number, string>()
  const registered = new WeakSet<BrowserWindow>()
  const views = new Map<
    string,
    {
      windowId: number
      window: BrowserWindow
      inactiveAt?: number
      key: string
      profileId: string
      agentAccess: boolean
      taskId?: string
      cdp?: string
      view: WebContentsView
      url: string
      loading?: Promise<void>
    }
  >()
  const releaseView = (key: string) => {
    const entry = views.get(key)
    if (!entry) return
    views.delete(key)
    cdp?.remove(key)
    entry.window.contentView.removeChildView(entry.view)
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close()
  }
  const prune = () => {
    const inactive = [...views].filter(
      ([key, entry]) => entry.inactiveAt !== undefined && !cdp?.connected(key),
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
    for (const [key, current] of views) {
      if (current.windowId !== window.id) continue
      views.delete(key)
      cdp?.remove(key)
      if (detach) window.contentView.removeChildView(current.view)
      if (!current.view.webContents.isDestroyed()) current.view.webContents.close()
    }
  }
  ipcMain.handle('preview:browser', async (event, raw: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || event.senderFrame !== event.sender.mainFrame)
      throw new Error('Untrusted browser request')
    const sender = new URL(event.senderFrame.url)
    if (
      process.env.VITE_DEV_SERVER_URL
        ? sender.origin !== new URL(process.env.VITE_DEV_SERVER_URL).origin
        : sender.href !== pathToFileURL(indexPath).href
    )
      throw new Error('Untrusted browser request')
    const command = decode(browserCommandSchema, raw)
    if (command.action === 'external') {
      await shell.openExternal(previewUrl(command.url))
      return
    }
    const viewKey = JSON.stringify([window.id, command.key])
    let entry = views.get(viewKey)
    if (command.action === 'close') {
      if (activeViews.get(window.id) === viewKey) activeViews.delete(window.id)
      if (entry) {
        releaseView(viewKey)
      }
      return
    }
    if (command.action === 'hide') {
      if (activeViews.get(window.id) === viewKey) activeViews.delete(window.id)
      if (entry?.key === command.key) {
        entry.inactiveAt ??= Date.now()
        entry.view.setVisible(false)
        prune()
      }
      return
    }
    if (command.action === 'show') {
      const url = previewUrl(command.url)
      activeViews.set(window.id, viewKey)
      if (entry) entry.inactiveAt = undefined
      const profileId = command.profileId ?? 'default'
      for (const [key, other] of views) {
        if (other.windowId !== window.id || other === entry) continue
        other.view.setVisible(false)
        other.inactiveAt ??= Date.now()
        if (other.taskId === command.taskId && !command.agentAccess) {
          other.agentAccess = false
          cdp?.remove(key)
          other.cdp = undefined
        }
      }
      if (entry && entry.profileId !== profileId) {
        cdp?.remove(viewKey)
        window.contentView.removeChildView(entry.view)
        entry.view.webContents.close()
        views.delete(viewKey)
        entry = undefined
      }
      if (!entry) {
        const view = new WebContentsView({
          webPreferences: {
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            partition: `persist:dovo-preview:${profileId}`,
          },
        })
        view.setVisible(false)
        view.webContents.setWindowOpenHandler(() => ({
          action: 'deny',
        }))
        view.webContents.session.setPermissionRequestHandler(
          (_webContents, _permission, callback) => callback(false),
        )
        view.webContents.session.setPermissionCheckHandler(() => false)
        view.webContents.on('will-navigate', (event, url) => {
          if (!/^https?:\/\//i.test(url)) event.preventDefault()
        })
        view.webContents.on('will-redirect', (event, url) => {
          if (!/^https?:\/\//i.test(url)) event.preventDefault()
        })
        window.contentView.addChildView(view)
        entry = {
          windowId: window.id,
          window,
          key: command.key,
          profileId,
          agentAccess: false,
          view,
          url: '',
        }
        views.set(viewKey, entry)
        if (!registered.has(window)) {
          registered.add(window)
          window.once('closed', () => releaseWindow(window, false))
          // A renderer reload loses its tab IDs. Release their main-process owners too.
          window.webContents.on('did-start-navigation', (event) => {
            if (event.isMainFrame && !event.isSameDocument) releaseWindow(window, true)
          })
          window.webContents.on('render-process-gone', () => releaseWindow(window, true))
        }
      }
      prune()
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
          activeViews.get(window.id) !== viewKey ||
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
      if (activeViews.get(window.id) !== viewKey) return
      const [width, height] = window.getContentSize()
      const { x, y } = command.bounds
      if (x >= width || y >= height) {
        entry.inactiveAt ??= Date.now()
        entry.view.setVisible(false)
        return
      }
      const bounds = {
        ...command.bounds,
        width: Math.min(command.bounds.width, width - x),
        height: Math.min(command.bounds.height, height - y),
      }
      entry.view.setBounds(bounds)
      if (entry.url !== url) {
        entry.url = url
        entry.loading =
          entry.view.webContents.getURL() === url ? undefined : entry.view.webContents.loadURL(url)
      }
      const loading = entry.loading
      if (loading) {
        try {
          await loading
        } catch (error) {
          if (entry.loading === loading) {
            entry.loading = undefined
            entry.url = ''
          }
          throw error
        }
        if (entry.loading === loading) entry.loading = undefined
      }
      if (
        views.get(viewKey) !== entry ||
        activeViews.get(window.id) !== viewKey ||
        entry.url !== url ||
        entry.view.webContents.isDestroyed()
      )
        return
      // Electron requires a live renderer before either device-emulation call.
      // Every concurrent show waits for the first navigation, including resize commands.
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
      entry.view.setVisible(true)
      return
    }
    if (entry?.key !== command.key) return
    const navigation = entry.view.webContents.navigationHistory
    if (command.action === 'status')
      return {
        url: entry.view.webContents.getURL(),
        title: entry.view.webContents.getTitle(),
        cdp: entry.cdp,
        back: navigation.canGoBack(),
        forward: navigation.canGoForward(),
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
      for (const [key, entry] of views) {
        cdp?.remove(key)
        if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close()
      }
      views.clear()
      activeViews.clear()
      const bridge = cdp ?? (await cdpPending)
      await bridge?.close()
    },
  }
}
