import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
type Event = { senderFrame: { url: string }; sender: { mainFrame: { url: string } } }
const f = vi.hoisted(() => ({
  directory: '',
  available: true,
  handlers: new Map<string, (event: Event, ...args: unknown[]) => Promise<unknown>>(),
}))
vi.mock('./runtime-data-directory.js', () => ({ desktopRuntimeDirectory: () => f.directory }))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, handler: (event: Event, ...args: unknown[]) => Promise<unknown>) =>
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
it('isolates custom Connect credentials and preserves the existing hosted session', async () => {
  const origin = 'https://connect.company.test'
  await write('a'.repeat(43))
  await f.handlers.get('account:write')!(event(), 'b'.repeat(43), origin)
  expect(await read()).toBe('a'.repeat(43))
  expect(await f.handlers.get('account:read')!(event(), origin)).toBe('b'.repeat(43))
  expect(await f.handlers.get('account:read')!(event(), 'https://other.test')).toBeNull()
  await f.handlers.get('account:write')!(event(), null, origin)
  expect(await read()).toBe('a'.repeat(43))
  await expect(
    f.handlers.get('account:read')!(event(), 'https://user:secret@host.test'),
  ).rejects.toThrow('Use an HTTPS Connect URL')
})

it('isolates sharing keys by account and Connect origin and preserves them on sign-out', async () => {
  const origin = 'https://connect.company.test',
    key = 'a'.repeat(64)
  const readKey = (user: string, target = origin) =>
    f.handlers.get('sharing-key:read')!(event(), target, user)
  expect(await readKey('owner')).toBeNull()
  await f.handlers.get('sharing-key:write')!(event(), key, origin, 'owner')
  expect(await readKey('owner')).toBe(key)
  expect(await readKey('another-owner')).toBeNull()
  expect(await readKey('owner', 'https://other.test')).toBeNull()
  await write(null)
  expect(await readKey('owner')).toBe(key)
  const files = await readdir(f.directory)
  expect(files).toHaveLength(1)
  const path = join(f.directory, files[0]!)
  expect(await readFile(path, 'utf8')).toBe('encrypted:' + key)
  expect((await stat(path)).mode & 0o777).toBe(0o600)
})
it('protects sharing key IPC with renderer, identity, format and keychain validation', async () => {
  const save = (key: unknown, user: unknown = 'owner', source = event()) =>
    f.handlers.get('sharing-key:write')!(source, key, 'https://connect.company.test', user)
  expect(() => save('a'.repeat(64), 'owner', event('https://attacker.test'))).toThrow(
    'Untrusted desktop request',
  )
  expect(() => save('invalid')).toThrow('Invalid sharing key')
  expect(() => save('a'.repeat(64), '')).toThrow('Invalid sharing identity')
  f.available = false
  expect(() => save('a'.repeat(64))).toThrow('Unlock your system keychain')
})
