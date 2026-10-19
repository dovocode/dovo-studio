import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
type Event = { senderFrame: { url: string }; sender: { mainFrame: { url: string } } }
const f = vi.hoisted(() => ({
  directory: '',
  available: true,
  handlers: new Map<string, (event: Event, token?: unknown) => Promise<unknown>>(),
}))
vi.mock('./runtime-data-directory.js', () => ({ desktopRuntimeDirectory: () => f.directory }))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, handler: (event: Event, token?: unknown) => Promise<unknown>) =>
      f.handlers.set(name, handler),
  },
  safeStorage: {
    isEncryptionAvailable: () => f.available,
    getSelectedStorageBackend: () => 'keychain',
    encryptString: (value: string) => Buffer.from('encrypted:' + value),
    decryptString: (value: Buffer) => value.toString().slice('encrypted:'.length),
  },
}))
import { registerAccountStorage } from './account-storage.js'
beforeEach(async () => {
  f.directory = await mkdtemp(join(tmpdir(), 'dovo-account-'))
  f.available = true
  registerAccountStorage('/app/index.html')
})
afterEach(async () => {
  await rm(f.directory, { recursive: true, force: true })
})
function event(url = 'file:///app/index.html'): Event {
  const frame = { url }
  return { senderFrame: frame, sender: { mainFrame: frame } }
}
const read = (source = event()) => f.handlers.get('account:read')!(source)
const write = (token: unknown, source = event()) => f.handlers.get('account:write')!(source, token)
it('uses private encrypted storage and supports revoking only the account credential', async () => {
  expect(await read()).toBeNull()
  const token = 'a'.repeat(43)
  await write(token)
  expect(await read()).toBe(token)
  const path = join(f.directory, 'account-session.enc')
  expect(await readFile(path, 'utf8')).toBe('encrypted:' + token)
  expect((await stat(path)).mode & 0o777).toBe(0o600)
  await write(null)
  expect(await read()).toBeNull()
})
it('rejects untrusted pages, subframes, malformed credentials and locked keychains', async () => {
  expect(() => write('a'.repeat(43), event('https://attacker.test'))).toThrow(
    'Untrusted desktop request',
  )
  const subframe = event()
  subframe.senderFrame = { url: 'file:///app/index.html' }
  await expect(read(subframe)).rejects.toThrow('Untrusted desktop request')
  expect(() => write('runtime-secret')).toThrow('Invalid account session')
  f.available = false
  await expect(read()).rejects.toThrow('Unlock your system keychain')
  expect(() => write('a'.repeat(43))).toThrow('Unlock your system keychain')
})
