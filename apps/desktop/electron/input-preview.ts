import { app, BrowserWindow, ipcMain, nativeTheme, screen } from 'electron'
import {
  decode,
  inputPreviewSyncSchema,
  inputPreviewAnswerSchema,
  inputPreviewKey,
  runtimeRequest,
  snapshotSchema,
  responses,
  type InputPreviewItem,
  type InputPreview,
} from '@dovo/protocol'
import { requireTrustedRenderer, trustedRendererUrl } from './renderer-trust.js'
import { defaultWindowColors, readWindowColors } from './window-colors.js'

/** Popups open before their renderer paints; match the main window's last palette. */
const popupBackground = () =>
  (
    readWindowColors(app.getPath('userData')) ??
    defaultWindowColors(nativeTheme.shouldUseDarkColors)
  ).background
export function registerInputPreview(rendererPath: string, preload: string) {
  let owner: BrowserWindow | undefined
  let popup: BrowserWindow | undefined
  let items: InputPreviewItem[] = []
  let quitting = false
  app.on('before-quit', () => {
    quitting = true
  })
  let enabled = false
  let selected: string | undefined
  const dismissed = new Set<string>()
  const submitting = new Set<string>()
  const current = () => items.find((item) => inputPreviewKey(item) === selected)
  const payload = (): InputPreview | null => {
    const item = current()
    if (!item) return null
    const { connection: _connection, ...preview } = item
    return { ...preview, key: inputPreviewKey(item), waiting: items.length }
  }
  const reconcile = () => {
    const keys = new Set(items.map(inputPreviewKey))
    for (const key of dismissed) if (!keys.has(key)) dismissed.delete(key)
    if (!current() || dismissed.has(selected ?? '')) {
      const next = items.find((item) => !dismissed.has(inputPreviewKey(item)))
      selected = next ? inputPreviewKey(next) : undefined
    }
    if (!enabled || owner?.isFocused() || !current()) {
      popup?.webContents.send('input-preview:state', payload())
      popup?.hide()
      return
    }
    if (!popup || popup.isDestroyed()) {
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
      popup = new BrowserWindow({
        width: 480,
        height: 560,
        minWidth: 360,
        minHeight: 300,
        x: display.x + Math.max(0, display.width - 500),
        y: display.y + Math.max(0, display.height - 580),
        title: 'Dovo · Needs your input',
        // A normal macOS window activates the app while answering, bringing the
        // main window forward when the preview hides. Panels take keyboard focus
        // without activating the app; opening the thread remains explicit.
        ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
        alwaysOnTop: true,
        frame: false,
        show: false,
        autoHideMenuBar: true,
        backgroundColor: popupBackground(),
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload },
      })
      popup.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      popup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      const guardNavigation = (event: Electron.Event, url: string) => {
        if (!trustedRendererUrl(url, rendererPath, process.env.VITE_DEV_SERVER_URL))
          event.preventDefault()
      }
      popup.webContents.on('will-navigate', guardNavigation)
      popup.webContents.on('will-redirect', guardNavigation)
      popup.on('close', (event) => {
        if (quitting) return
        event.preventDefault()
        if (selected) dismissed.add(selected)
        popup?.hide()
      })
      popup.webContents.once('did-finish-load', () => reconcile())
      if (process.env.VITE_DEV_SERVER_URL) {
        const url = new URL(process.env.VITE_DEV_SERVER_URL)
        url.hash = 'input-preview'
        void popup.loadURL(url.href)
      } else void popup.loadFile(rendererPath, { hash: 'input-preview' })
    }
    popup.webContents.send('input-preview:state', payload())
    if (!popup.isVisible()) {
      const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
      const [width, height] = popup.getSize()
      popup.setPosition(
        area.x + Math.max(0, area.width - width - 20),
        area.y + Math.max(0, area.height - height - 20),
      )
    }
    if (!popup.webContents.isLoadingMainFrame()) popup.showInactive()
  }
  ipcMain.handle('input-preview:sync', (event, value: unknown) => {
    requireTrustedRenderer(event, rendererPath)
    if (event.sender === popup?.webContents) throw new Error('Preview cannot publish requests')
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) throw new Error('Missing app window')
    if (!owner) {
      owner = window
      owner.on('focus', () => popup?.hide())
      owner.on('blur', reconcile)
      owner.on('closed', () => {
        popup?.destroy()
        popup = undefined
        owner = undefined
        items = []
      })
    }
    if (window !== owner) throw new Error('Only the app window can publish requests')
    const next = decode(inputPreviewSyncSchema, value)
    items = next.items
    enabled = next.enabled
    owner.webContents.setBackgroundThrottling(!enabled)
    reconcile()
  })
  const requirePopup = (event: Electron.IpcMainInvokeEvent) => {
    requireTrustedRenderer(event, rendererPath)
    if (event.sender !== popup?.webContents) throw new Error('Only the input preview can respond')
  }
  ipcMain.handle('input-preview:current', (event) => {
    requirePopup(event)
    return payload()
  })
  ipcMain.handle('input-preview:dismiss', (event) => {
    requirePopup(event)
    if (selected) dismissed.add(selected)
    reconcile()
  })
  ipcMain.handle('input-preview:open', (event) => {
    requirePopup(event)
    const item = current()
    if (!item || !owner) return
    popup?.hide()
    if (owner.isMinimized()) owner.restore()
    owner.webContents.send('input-preview:open-thread', {
      runtimeId: item.runtimeId,
      entityId: item.request.value.taskId,
    })
    owner.show()
    owner.focus()
  })
  ipcMain.handle('input-preview:answer', async (event, value: unknown) => {
    requirePopup(event)
    const input = decode(inputPreviewAnswerSchema, value)
    const item = current()
    if (!item || inputPreviewKey(item) !== input.key)
      throw new Error('This request is no longer waiting')
    if (!item.connected) throw new Error('Reconnect this server before answering')
    if (submitting.has(input.key)) throw new Error('This answer is already being submitted')
    submitting.add(input.key)
    try {
      const snapshot = await runtimeRequest(
        item.connection,
        item.connection.address,
        '/api/snapshot?overview=1',
        undefined,
        snapshotSchema,
        'GET',
      )
      const pending = item.request.kind === 'question' ? snapshot.questions : snapshot.approvals
      if (
        !pending.some(
          (request) =>
            request.id === item.request.value.id && request.taskId === item.request.value.taskId,
        )
      ) {
        dismissed.add(input.key)
        reconcile()
        throw new Error('This request was answered or canceled elsewhere')
      }
      const question = item.request.kind === 'question'
      if (question ? typeof input.answer === 'boolean' : typeof input.answer !== 'boolean')
        throw new Error('Invalid response for this request')
      await runtimeRequest(
        item.connection,
        item.connection.address,
        question ? '/api/tasks/answer' : '/api/approvals',
        question
          ? { id: item.request.value.id, answers: input.answer }
          : { id: item.request.value.id, allow: input.answer },
        responses.ok,
      )
      dismissed.add(input.key)
      reconcile()
    } finally {
      submitting.delete(input.key)
    }
  })
  return { dispose: () => popup?.destroy() }
}
