import { beforeEach, expect, it, vi } from 'vite-plus/test'
const f = vi.hoisted(() => ({
  handlers: new Map<string, (event: Electron.IpcMainInvokeEvent, value?: unknown) => unknown>(),
  callbacks: new Map<string, () => void>(),
  available: true,
  unregister: vi.fn<(key: string) => void>(),
  trusted: vi.fn<() => void>(),
}))
vi.mock('./renderer-trust', () => ({ requireTrustedRenderer: f.trusted }))
vi.mock('electron', () => ({
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
}))
import { registerTaskLauncher } from './task-launcher'
import type { BrowserWindow, WebContents } from 'electron'
beforeEach(() => {
  f.handlers.clear()
  f.callbacks.clear()
  f.available = true
  vi.clearAllMocks()
})
function fixture() {
  const contents = {
    getURL: () => 'file:///app/index.html',
    isDestroyed: () => false,
    send: vi.fn<(channel: string) => void>(),
  }
  const window = {
    webContents: contents,
    isMinimized: () => true,
    restore: vi.fn<() => void>(),
    show: vi.fn<() => void>(),
    focus: vi.fn<() => void>(),
  }
  // IPC/Electron classes are represented by their exercised surface in this fixture.
  const bridge = registerTaskLauncher('/app/index.html', () => window as unknown as BrowserWindow)
  const invoke = (name: string, value?: unknown) =>
    f.handlers.get(`task-launcher:${name}`)?.(
      { sender: contents as unknown as WebContents } as Electron.IpcMainInvokeEvent,
      value,
    )
  return { window, contents, bridge, invoke }
}
it('restores and focuses the main window and preserves a shortcut until its renderer subscribes', () => {
  const { contents, window, bridge, invoke } = fixture()
  expect(invoke('configure', 'CommandOrControl+Shift+Space')).toEqual({
    registered: true,
    error: null,
  })
  f.callbacks.get('CommandOrControl+Shift+Space')?.()
  expect(window.restore).toHaveBeenCalledOnce()
  expect(window.show).toHaveBeenCalledOnce()
  expect(window.focus).toHaveBeenCalledOnce()
  expect(contents.send).not.toHaveBeenCalled()
  invoke('ready')
  expect(contents.send).toHaveBeenCalledWith('task-launcher:open')
  f.callbacks.get('CommandOrControl+Shift+Space')?.()
  expect(contents.send).toHaveBeenCalledTimes(2)
  invoke('configure', 'CommandOrControl+Alt+N')
  expect(f.unregister).toHaveBeenCalledWith('CommandOrControl+Shift+Space')
  bridge.dispose()
  expect(f.unregister).toHaveBeenCalledWith('CommandOrControl+Alt+N')
})
it('reports shortcut conflicts, supports disabling, and rejects unsupported shortcuts and preview renderers', () => {
  const { contents, invoke } = fixture()
  f.available = false
  expect(invoke('configure', 'CommandOrControl+Alt+N')).toMatchObject({
    registered: false,
    error: expect.any(String),
  })
  expect(invoke('configure', '')).toEqual({ registered: false, error: null })
  expect(() => invoke('configure', 'F1')).toThrow('Invalid shortcut')
  contents.getURL = () => 'file:///app/index.html#input-preview'
  expect(() => invoke('ready')).toThrow('Only the main window')
  expect(() => invoke('configure', '')).toThrow('Only the main window')
})
