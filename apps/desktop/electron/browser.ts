import { createBrowserCdp } from './browser-cdp.js'
import { decode } from '@dovo/protocol'
import { BrowserWindow, WebContentsView, ipcMain, shell } from 'electron'
import { pathToFileURL } from 'node:url'
import { browserCommandSchema, previewUrl } from '@dovo/protocol'
export function registerBrowser(indexPath: string, directory?: string) {
  let cdp: Awaited<ReturnType<typeof createBrowserCdp>> | undefined
  let cdpPending: Promise<Awaited<ReturnType<typeof createBrowserCdp>>> | undefined
  const registered = new WeakSet<BrowserWindow>()
  const views = new Map<
    number,
    {
      key: string
      profileId: string
      agentAccess: boolean
      taskId?: string
      cdp?: string
      view: WebContentsView
      url: string
    }
  >()
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
    let entry = views.get(window.id)
    if (command.action === 'hide') {
      if (entry?.key === command.key) entry.view.setVisible(false)
      return
    }
    if (command.action === 'show') {
      const url = previewUrl(command.url)
      const profileId = command.profileId ?? 'default'
      if (entry && (entry.key !== command.key || entry.profileId !== profileId)) {
        cdp?.remove(String(window.id))
        window.contentView.removeChildView(entry.view)
        entry.view.webContents.close()
        views.delete(window.id)
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
          key: command.key,
          profileId,
          agentAccess: false,
          view,
          url: '',
        }
        views.set(window.id, entry)
        if (!registered.has(window)) {
          registered.add(window)
          window.once('closed', () => {
            const current = views.get(window.id)
            if (current && !current.view.webContents.isDestroyed()) current.view.webContents.close()
            cdp?.remove(String(window.id))
            views.delete(window.id)
          })
        }
      }
      entry.agentAccess = !!(command.agentAccess && command.taskId && directory)
      entry.taskId = command.taskId
      if (command.agentAccess && command.taskId && directory) {
        cdpPending ??= createBrowserCdp(directory).catch((error) => {
          cdpPending = undefined
          throw error
        })
        cdp = await cdpPending
        if (
          views.get(window.id) !== entry ||
          !entry.agentAccess ||
          entry.taskId !== command.taskId ||
          entry.view.webContents.isDestroyed()
        )
          return
        entry.cdp = cdp.register(
          String(window.id),
          command.taskId,
          profileId,
          entry.view.webContents,
        )
      } else if (entry.cdp) {
        cdp?.remove(String(window.id))
        entry.cdp = undefined
      }
      const [width, height] = window.getContentSize()
      const { x, y } = command.bounds
      if (x >= width || y >= height) {
        entry.view.setVisible(false)
        return
      }
      const bounds = {
        ...command.bounds,
        width: Math.min(command.bounds.width, width - x),
        height: Math.min(command.bounds.height, height - y),
      }
      entry.view.setBounds(bounds)
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
      if (entry.url !== url) {
        entry.url = url
        await entry.view.webContents.loadURL(url)
      }
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
      const bridge = cdp ?? (await cdpPending)
      await bridge?.close()
    },
  }
}
