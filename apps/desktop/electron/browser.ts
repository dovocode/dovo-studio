import { BrowserWindow, WebContentsView, ipcMain, shell } from 'electron'
import { pathToFileURL } from 'node:url'
import { browserCommandSchema, previewUrl } from '@dovo/protocol'

export function registerBrowser(indexPath: string) {
  const registered = new WeakSet<BrowserWindow>()
  const views = new Map<number, { key: string; view: WebContentsView; url: string }>()
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
    const command = browserCommandSchema.parse(raw)
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
      if (entry && entry.key !== command.key) {
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
            partition: 'dovo-preview',
          },
        })
        view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
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
        entry = { key: command.key, view, url: '' }
        views.set(window.id, entry)
        if (!registered.has(window)) {
          registered.add(window)
          window.once('closed', () => {
            const current = views.get(window.id)
            if (current && !current.view.webContents.isDestroyed()) current.view.webContents.close()
            views.delete(window.id)
          })
        }
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
          screenSize: { width: vw, height: vh },
          viewSize: { width: vw, height: vh },
          deviceScaleFactor: 1,
          scale: Math.min(bounds.width / vw, bounds.height / vh),
          viewPosition: { x: 0, y: 0 },
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
        back: navigation.canGoBack(),
        forward: navigation.canGoForward(),
      }
    if (command.action === 'back' && navigation.canGoBack()) navigation.goBack()
    if (command.action === 'forward' && navigation.canGoForward()) navigation.goForward()
    if (command.action === 'reload') entry.view.webContents.reload()
  })
}
