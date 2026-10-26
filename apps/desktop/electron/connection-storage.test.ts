import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  decodeRuntimeRegistry,
  emptyRegistry,
} from '../../../packages/studio-core/src/workspace/runtime-registry'
type StorageEvent = {
  senderFrame: { url: string }
  sender: {
    mainFrame: { url: string }
    isDestroyed: () => boolean
    send: (channel: string) => void
  }
  returnValue: unknown
}
const f = vi.hoisted(() => ({
  directory: '',
  listeners: new Map<string, (event: StorageEvent, value?: unknown) => void>(),
  handlers: new Map<string, (event: StorageEvent, ...values: unknown[]) => Promise<unknown>>(),
  write: vi.fn<() => void>(),
  connectionWrite: vi.fn<typeof import('node:fs/promises').writeFile>(),
  connectionRename: vi.fn<typeof import('node:fs/promises').rename>(),
}))
vi.mock('./runtime-data-directory.js', () => ({ desktopRuntimeDirectory: () => f.directory }))
vi.mock('node:fs/promises', async (original) => ({
  ...(await original<typeof import('node:fs/promises')>()),
  writeFile: f.connectionWrite,
  rename: f.connectionRename,
}))
vi.mock('electron', () => ({
  ipcMain: {
    on: (name: string, listener: (event: StorageEvent, value?: unknown) => void) =>
      f.listeners.set(name, listener),
    handle: (
      name: string,
      handler: (event: StorageEvent, ...values: unknown[]) => Promise<unknown>,
    ) => f.handlers.set(name, handler),
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'keychain',
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
}))
vi.mock('@dovo/protocol/local-settings', () => ({
  readLocalSettingsSection: () => ({ theme: 'dark' }),
  writeLocalSettingsSection: f.write,
}))
import { registerConnectionStorage } from './connection-storage'
beforeEach(async () => {
  const fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  f.connectionWrite.mockImplementation(fs.writeFile)
  f.connectionRename.mockImplementation(fs.rename)
  f.directory = await mkdtemp(join(tmpdir(), 'dovo-registry-'))
  registerConnectionStorage('/app/index.html')
})
afterEach(async () => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  await rm(f.directory, { recursive: true, force: true })
})
function event(url = 'file:///app/index.html') {
  const frame = { url }
  const send = vi.fn<(channel: string) => void>()
  const source: StorageEvent = {
    senderFrame: frame,
    sender: { mainFrame: frame, isDestroyed: () => false, send },
    returnValue: undefined,
  }
  return Object.assign(source, { send })
}
function invoke(name: string, source: StorageEvent, ...values: unknown[]) {
  const handler = f.handlers.get('runtime:registry-' + name)
  if (!handler) throw new Error('Missing registry handler')
  return handler(source, ...values)
}
const initial = () =>
  decodeRuntimeRegistry(
    null,
    JSON.stringify({
      address: 'http://paired.lan:8787',
      token: 'paired-token-at-least-20-characters',
    }),
  )
const save = (source: StorageEvent, next = initial(), before = emptyRegistry()) =>
  invoke('write', source, JSON.stringify(next), JSON.stringify(before))
it.each([undefined, 'http://localhost:5173'])(
  'allows launcher appearance reads but denies settings and credential writes (%s)',
  async (dev) => {
    vi.stubEnv('VITE_DEV_SERVER_URL', dev)
    const popup = event((dev ?? 'file:///app/index.html') + '#task-launcher')
    f.listeners.get('app:settings-read')?.(popup)
    expect(popup.returnValue).toEqual({ value: { theme: 'dark' } })
    f.listeners.get('app:settings-write')?.(popup, '{}')
    expect(popup.returnValue).toEqual({ error: expect.stringContaining('Untrusted') })
    expect(f.write).not.toHaveBeenCalled()
    await expect(save(popup)).rejects.toThrow('Untrusted')
    const foreign = event('https://foreign.test/#task-launcher')
    f.listeners.get('app:settings-read')?.(foreign)
    expect(foreign.returnValue).toEqual({ error: expect.stringContaining('Untrusted') })
  },
)
it('stores private encrypted connections with a unique temporary file and cleans it up', async () => {
  const committed = await save(event())
  const target = join(f.directory, 'runtime-connections.enc')
  const temporary = f.connectionWrite.mock.calls[0][0]
  expect(temporary).toEqual(expect.stringMatching(/runtime-connections\.enc\.[\w-]+\.tmp$/))
  expect(f.connectionWrite).toHaveBeenCalledWith(
    temporary,
    Buffer.from(JSON.stringify(initial())),
    { mode: 0o600, flag: 'wx' },
  )
  expect(f.connectionRename).toHaveBeenCalledWith(temporary, target)
  expect(await readFile(target, 'utf8')).toBe(committed)
  expect((await stat(target)).mode & 0o777).toBe(0o600)
  expect(await readdir(f.directory)).toEqual(['runtime-connections.enc'])
})
it.each(['#thread=', '#thread-share='])(
  'allows trusted %s windows but rejects foreign and malformed frames',
  async (prefix) => {
    const hash =
      prefix +
      encodeURIComponent(JSON.stringify({ runtimeId: 'remote', taskId: 'task', title: 'Thread' }))
    const thread = event('file:///app/index.html' + hash)
    f.listeners.get('app:settings-read')?.(thread)
    expect(thread.returnValue).toEqual({ value: { theme: 'dark' } })
    await save(thread)
    await expect(save(event('https://foreign.test/' + hash))).rejects.toThrow('Untrusted')
    await expect(save(event('file:///app/index.html#thread=invalid'))).rejects.toThrow(SyntaxError)
    const subframe = event()
    Object.defineProperty(subframe, 'senderFrame', { value: { url: 'file:///app/index.html' } })
    await expect(save(subframe)).rejects.toThrow('Untrusted')
  },
)
it('merges independent stale window edits and notifies other readers only after commit', async () => {
  const main = event(),
    thread = event()
  const before = initial()
  await save(main, before)
  await invoke('read', main)
  await invoke('read', thread)
  const changed = {
    ...before,
    profiles: [
      {
        ...before.profiles[0],
        name: 'Updated connection',
        connection: {
          address: 'http://100.64.0.1:8787',
          token: 'replacement-device-token-123456789',
          alternateAddresses: ['http://paired.lan:8787'],
        },
      },
    ],
  }
  await save(main, changed, before)
  expect(thread.send).toHaveBeenCalledWith('runtime:registry-changed')
  expect(main.send).not.toHaveBeenCalled()
  const selected = { ...before, activeId: null }
  const committed = await save(thread, selected, before)
  expect(committed).toBe(JSON.stringify({ ...changed, activeId: null }))
  expect(main.send).toHaveBeenCalledOnce()
  // A stale disconnect must not remove newly changed connection details.
  await expect(save(thread, { ...before, profiles: [], activeId: null }, before)).rejects.toThrow(
    'another window',
  )
  expect(await invoke('read', main)).toBe(committed)
  expect(main.send).toHaveBeenCalledOnce()
})
it('rejects conflicting pairing changes without discarding the committed proof', async () => {
  const source = event(),
    before = initial()
  await save(source, before)
  const pending = (id: string) => ({
    ...before,
    pendingPairings: [
      {
        profile: before.profiles[0],
        proof: {
          id,
          secret: 'synthetic-pairing-secret',
          expiresAt: new Date(Date.now() + 120000).toISOString(),
        },
      },
    ],
  })
  const committed = await save(source, pending('first'), before)
  await expect(save(source, pending('second'), before)).rejects.toThrow('Pairing changed')
  expect(await invoke('read', source)).toBe(committed)
})
it('serializes delayed saves, acknowledges each committed payload and uses separate temp files', async () => {
  const source = event(),
    before = initial()
  await save(source, before)
  f.connectionWrite.mockClear()
  const fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  let release!: () => void
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  f.connectionWrite.mockImplementationOnce(async (...args) => {
    await blocked
    await fs.writeFile(...args)
  })
  const renamed = { ...before, profiles: [{ ...before.profiles[0], name: 'Updated' }] }
  const first = save(source, renamed, before)
  const second = save(source, { ...before, activeId: null }, before)
  await vi.waitFor(() => expect(f.connectionWrite).toHaveBeenCalledOnce())
  let acknowledged = false
  void second.then(() => {
    acknowledged = true
  })
  expect(acknowledged).toBe(false)
  release()
  expect(await first).toBe(JSON.stringify(renamed))
  const final = await second
  expect(final).toBe(JSON.stringify({ ...renamed, activeId: null }))
  expect(await invoke('read', source)).toBe(final)
  expect(f.connectionWrite.mock.calls[0][0]).not.toBe(f.connectionWrite.mock.calls[1][0])
  expect(await readdir(f.directory)).toEqual(['runtime-connections.enc'])
})
it('cleans up a failed save, preserves committed data and allows another save', async () => {
  const source = event(),
    other = event(),
    before = initial()
  await save(source, before)
  await invoke('read', other)
  f.connectionRename.mockRejectedValueOnce(new Error('Disk failure'))
  await expect(save(source, { ...before, activeId: null }, before)).rejects.toThrow('Disk failure')
  expect(other.send).not.toHaveBeenCalled()
  expect(await readdir(f.directory)).toEqual(['runtime-connections.enc'])
  expect(await invoke('read', source)).toBe(JSON.stringify(before))
  await expect(save(source, { ...before, activeId: null }, before)).resolves.toBe(
    JSON.stringify({ ...before, activeId: null }),
  )
})
it('rejects malformed registry payloads before persistence', async () => {
  await expect(invoke('write', event(), '{}', JSON.stringify(emptyRegistry()))).rejects.toThrow(
    /version/,
  )
  await expect(invoke('write', event(), JSON.stringify(initial()), '{}')).rejects.toThrow(/version/)
  expect(f.connectionWrite).not.toHaveBeenCalled()
})

it('validates merged uniqueness before persisting independently added profiles', async () => {
  const source = event(),
    first = initial()
  const committed = await save(source, first)
  const second = {
    ...first,
    activeId: 'other-id',
    profiles: [{ ...first.profiles[0], id: 'other-id' }],
  }
  await expect(save(source, second)).rejects.toThrow('unique')
  expect(await invoke('read', source)).toBe(committed)
})

it('allows validated browser-window workbenches and broadcasts app-setting changes across readers', async () => {
  const main = event(),
    browser = event('file:///app/index.html#browser-window=12345678-1234-1234-1234-123456789abc')
  f.listeners.get('app:settings-read')!(main)
  f.listeners.get('app:settings-read')!(browser)
  expect(browser.returnValue).toEqual({ value: { theme: 'dark' } })
  await expect(f.handlers.get('runtime:registry-read')!(browser)).resolves.toBeNull()
  f.listeners.get('app:settings-write')!(main, JSON.stringify({ browserWorkspaceEnabled: false }))
  expect(browser.sender.send).toHaveBeenCalledWith('app:settings-changed')
  expect(main.sender.send).not.toHaveBeenCalled()
  const foreign = event('https://evil.example/#browser-window=12345678-1234-1234-1234-123456789abc')
  f.listeners.get('app:settings-read')!(foreign)
  expect(foreign.returnValue).toHaveProperty('error')
  const invalid = event('file:///app/index.html#browser-window=not-a-window')
  f.listeners.get('app:settings-read')!(invalid)
  expect(invalid.returnValue).toHaveProperty('error')
})
