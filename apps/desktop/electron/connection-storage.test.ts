import { afterEach, expect, it, vi } from 'vite-plus/test'
const f = vi.hoisted(() => ({
  listeners: new Map<string, (event: Electron.IpcMainEvent, value?: unknown) => void>(),
  handlers: new Map<string, (event: Electron.IpcMainInvokeEvent, value?: unknown) => unknown>(),
  write: vi.fn<() => void>(),
}))
vi.mock('electron', () => ({
  app: { getPath: () => '/unused' },
  ipcMain: {
    on: (name: string, listener: (event: Electron.IpcMainEvent, value?: unknown) => void) =>
      f.listeners.set(name, listener),
    handle: (
      name: string,
      handler: (event: Electron.IpcMainInvokeEvent, value?: unknown) => unknown,
    ) => f.handlers.set(name, handler),
  },
  safeStorage: { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'keychain' },
}))
vi.mock('@dovo/protocol/local-settings', () => ({
  readLocalSettingsSection: () => ({ theme: 'dark' }),
  writeLocalSettingsSection: f.write,
}))
import { registerConnectionStorage } from './connection-storage'
afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})
function event(url: string) {
  const frame = { url }
  return {
    senderFrame: frame,
    sender: { mainFrame: frame },
    returnValue: undefined,
  } as unknown as Electron.IpcMainEvent & Electron.IpcMainInvokeEvent
}
it.each([undefined, 'http://localhost:5173'])(
  'allows launcher appearance reads but denies settings and credential writes (%s)',
  async (dev) => {
    vi.stubEnv('VITE_DEV_SERVER_URL', dev)
    registerConnectionStorage('/app/index.html')
    const popup = event((dev ?? 'file:///app/index.html') + '#task-launcher')
    f.listeners.get('app:settings-read')?.(popup)
    expect(popup.returnValue).toEqual({ value: { theme: 'dark' } })
    f.listeners.get('app:settings-write')?.(popup, '{}')
    expect(popup.returnValue).toEqual({ error: expect.stringContaining('Untrusted') })
    expect(f.write).not.toHaveBeenCalled()
    await expect(() => f.handlers.get('runtime:registry-write')?.(popup, '{}')).rejects.toThrow(
      'Untrusted',
    )
    const foreign = event('https://foreign.test/#task-launcher')
    f.listeners.get('app:settings-read')?.(foreign)
    expect(foreign.returnValue).toEqual({ error: expect.stringContaining('Untrusted') })
  },
)
