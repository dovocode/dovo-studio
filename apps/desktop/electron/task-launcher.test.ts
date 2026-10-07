import { tmpdir } from 'node:os'
import { beforeEach, expect, it, vi } from 'vite-plus/test'
const f = vi.hoisted(() => ({
  handlers: new Map<string, (event: Electron.IpcMainInvokeEvent, value?: unknown) => unknown>(),
  callbacks: new Map<string, () => void>(),
  windows: [] as Array<{
    options: Electron.BrowserWindowConstructorOptions
    visible: boolean
    destroyed: boolean
    webContents: { getURL: () => string; send: ReturnType<typeof vi.fn<(channel: string) => void>> }
  }>,
  available: true,
  unregister: vi.fn<(key: string) => void>(),
}))
vi.mock('./renderer-trust', () => ({
  requireTrustedRenderer: () => {},
  trustedRendererUrl: () => true,
}))
vi.mock('electron', () => ({
  app: { on: () => {}, getPath: () => tmpdir() },
  nativeTheme: { shouldUseDarkColors: true },
  screen: {
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1200, height: 800 } }),
  },
  ipcMain: {
    handle: (
      name: string,
      handler: (event: Electron.IpcMainInvokeEvent, value?: unknown) => unknown,
    ) => f.handlers.set(name, handler),
  },
  globalShortcut: {
    register: (key: string, callback: () => void) => {
      if (!f.available) return false
      f.callbacks.set(key, callback)
      return true
    },
    unregister: f.unregister,
  },
  BrowserWindow: class {
    visible = false
    destroyed = false
    webContents = {
      getURL: () => 'file:///app/index.html#task-launcher',
      send: vi.fn<(channel: string) => void>(),
      setWindowOpenHandler: () => {},
      on: () => {},
    }
    constructor(readonly options: Electron.BrowserWindowConstructorOptions) {
      f.windows.push(this)
    }
    isDestroyed() {
      return this.destroyed
    }
    getSize() {
      return [620, 670]
    }
    setPosition() {}
    setVisibleOnAllWorkspaces() {}
    on() {}
    loadFile() {
      return Promise.resolve()
    }
    show() {
      this.visible = true
    }
    focus() {}
    hide() {
      this.visible = false
    }
    destroy() {
      this.destroyed = true
    }
  },
}))
import { registerTaskLauncher } from './task-launcher'
beforeEach(() => {
  f.handlers.clear()
  f.callbacks.clear()
  f.windows.splice(0)
  f.available = true
  vi.clearAllMocks()
})
function fixture() {
  const main = { getURL: () => 'file:///app/index.html', send: vi.fn<(channel: string) => void>() }
  const bridge = registerTaskLauncher('/app/index.html', '/app/preload.mjs')
  const invoke = (name: string, value?: unknown, sender: unknown = main) =>
    f.handlers.get(`task-launcher:${name}`)?.({ sender } as Electron.IpcMainInvokeEvent, value)
  return { main, bridge, invoke }
}
it('opens and reuses a standalone launcher without sending the main window an open event', () => {
  const { main, bridge, invoke } = fixture()
  invoke('configure', 'CommandOrControl+Shift+Space')
  f.callbacks.get('CommandOrControl+Shift+Space')?.()
  const popup = f.windows[0]!
  expect(popup.visible).toBe(true)
  expect(popup.options.webPreferences).toMatchObject({ sandbox: true, nodeIntegration: false })
  expect(popup.options.type).toBe(process.platform === 'darwin' ? 'panel' : undefined)
  expect(main.send).not.toHaveBeenCalled()
  expect(popup.webContents.send).not.toHaveBeenCalled()
  invoke('ready', undefined, popup.webContents)
  expect(popup.webContents.send).toHaveBeenCalledWith('task-launcher:open')
  invoke('dismiss', undefined, popup.webContents)
  expect(popup.visible).toBe(false)
  invoke('open')
  expect(f.windows).toHaveLength(1)
  expect(popup.visible).toBe(true)
  expect(popup.webContents.send).toHaveBeenCalledTimes(2)
  bridge.dispose()
  expect(popup.destroyed).toBe(true)
  expect(f.unregister).toHaveBeenCalledWith('CommandOrControl+Shift+Space')
})
it('shares validated connections only with the owned popup and rejects popup configuration', () => {
  const { invoke } = fixture()
  const registry = { version: 1, activeId: null, profiles: [] }
  invoke('sync', registry)
  invoke('open')
  const popup = f.windows[0]!
  expect(invoke('current', undefined, popup.webContents)).toEqual(registry)
  expect(() => invoke('current')).toThrow('Only the task launcher')
  expect(() => invoke('ready')).toThrow('Only the task launcher')
  expect(() => invoke('dismiss')).toThrow('Only the task launcher')
  expect(() => invoke('sync', registry, popup.webContents)).toThrow('Only the main window')
  expect(() => invoke('configure', '', popup.webContents)).toThrow('Only the main window')
  expect(() => invoke('current', undefined, { getURL: popup.webContents.getURL })).toThrow(
    'Only the task launcher',
  )
  expect(() => invoke('sync', { version: 2 })).toThrow('Expected 1')
})
it('reports shortcut conflicts and supports disabling and changing the shortcut', () => {
  const { invoke } = fixture()
  f.available = false
  expect(invoke('configure', 'CommandOrControl+Alt+N')).toMatchObject({
    registered: false,
    error: expect.any(String),
  })
  expect(invoke('configure', '')).toEqual({ registered: false, error: null })
  expect(() => invoke('configure', 'F1')).toThrow('Invalid shortcut')
  f.available = true
  invoke('configure', 'CommandOrControl+Alt+N')
  invoke('configure', 'CommandOrControl+Shift+Space')
  expect(f.unregister).toHaveBeenCalledWith('CommandOrControl+Alt+N')
  invoke('configure', '')
  expect(f.unregister).toHaveBeenCalledWith('CommandOrControl+Shift+Space')
})
