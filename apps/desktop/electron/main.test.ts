import { expect, it, vi } from 'vite-plus/test'

const fixture = vi.hoisted(() => ({
  windows: 0,
  ipc: vi.fn<
    (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => void
  >(),
  quit: vi.fn<() => void>(),
  updates: vi.fn<(...args: unknown[]) => void>(),
}))
vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getPath: () => '/tmp/dovo-startup-unit-test',
    commandLine: { hasSwitch: () => true },
    setName: vi.fn<(...args: unknown[]) => void>(),
    setPath: vi.fn<(...args: unknown[]) => void>(),
    on: vi.fn<(...args: unknown[]) => void>(),
    whenReady: () => Promise.resolve(),
    requestSingleInstanceLock: () => true,
    quit: fixture.quit,
  },
  BrowserWindow: class {
    webContents = {
      setWindowOpenHandler: vi.fn<(...args: unknown[]) => void>(),
      on: vi.fn<(...args: unknown[]) => void>(),
    }
    constructor() {
      fixture.windows++
    }
    loadFile() {
      return Promise.resolve()
    }
    static getAllWindows() {
      return []
    }
  },
  ipcMain: { handle: fixture.ipc },
  dialog: {},
}))
vi.mock('./updates.js', () => ({ registerUpdates: fixture.updates }))
vi.mock('./browser.js', () => ({ registerBrowser: vi.fn<(...args: unknown[]) => void>() }))
vi.mock('./connection-storage.js', () => ({
  registerConnectionStorage: vi.fn<(...args: unknown[]) => void>(),
}))
vi.mock('./local-runtime.js', () => ({
  startLocalRuntime: () => Promise.reject(new Error('Runtime protocol is incompatible')),
  stopLocalRuntime: () => Promise.resolve(),
  prepareLocalRuntimeUpdate: vi.fn<typeof import('./local-runtime').prepareLocalRuntimeUpdate>(),
}))

it('opens the recovery UI and registers updates when the installed runtime is incompatible', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    await import('./main')
    await vi.waitFor(() => expect(fixture.windows).toBe(1))
    expect(fixture.updates).toHaveBeenCalledOnce()
    expect(fixture.quit).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(
      'Local runtime needs attention:',
      'Runtime protocol is incompatible',
    )
  } finally {
    log.mockRestore()
  }
})

it('rejects untrusted senders before returning runtime credentials or activating extensions', async () => {
  await import('./main')
  for (const channel of ['runtime:connection', 'runtime:list-extensions', 'runtime:activate']) {
    const handler = fixture.ipc.mock.calls.find(([name]) => name === channel)?.[1]
    if (!handler) throw new Error(`Missing IPC handler ${channel}`)
    await expect(
      Promise.resolve().then(() => handler({ senderFrame: null }, 'extension')),
    ).rejects.toThrow('Untrusted desktop request')
  }
})
