import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, existsSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBrowserSessionCookies, sessionCookieOptOuts } from './browser-session-cookies.js'

const encryption = vi.hoisted(() => ({
  available: true,
  backend: 'gnome_libsecret',
  locked: false,
}))
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => encryption.available,
    getSelectedStorageBackend: () => encryption.backend,
    encryptString: (text: string) => Buffer.from(`encrypted:${text}`),
    decryptString: (data: Buffer) => {
      if (encryption.locked) throw new Error('Keychain is locked')
      return data.toString().replace(/^encrypted:/, '')
    },
  },
}))
let directory: string
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'dovo-session-cookies-'))
  encryption.available = true
  encryption.backend = 'gnome_libsecret'
  encryption.locked = false
})
afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
  vi.restoreAllMocks()
})
const cookie: Electron.Cookie = {
  name: '__Host-login',
  value: 'test-login',
  domain: 'example.com',
  path: '/',
  httpOnly: true,
  secure: true,
  hostOnly: true,
  sameSite: 'no_restriction',
  session: true,
}
function fixture(
  storagePath: string | null = directory,
  initial: Electron.Cookie[] = [],
  enabled: () => boolean = () => true,
) {
  const values = new Map(initial.map((cookie) => [cookie.name, cookie]))
  const cookies = Object.assign(new EventEmitter(), {
    get: vi.fn<(filter: Electron.CookiesGetFilter) => Promise<Electron.Cookie[]>>(async (filter) =>
      [...values.values()].filter(
        (cookie) => filter.session === undefined || cookie.session === filter.session,
      ),
    ),
    set: vi.fn<(details: Electron.CookiesSetDetails) => Promise<void>>(async (details) => {
      const url = new URL(details.url)
      const restored: Electron.Cookie = {
        name: details.name ?? '',
        value: details.value ?? '',
        domain: details.domain ?? url.hostname,
        path: details.path ?? '/',
        secure: details.secure ?? false,
        httpOnly: details.httpOnly ?? false,
        sameSite: details.sameSite ?? 'lax',
        hostOnly: !details.domain,
        session: details.expirationDate === undefined,
        expirationDate: details.expirationDate,
      }
      values.set(restored.name, restored)
    }),
  })
  const session = { storagePath, cookies }
  const attach = createBrowserSessionCookies()
  const ready = () => attach(session, enabled)
  const change = (value: Electron.Cookie, removed = false) => {
    if (removed) values.delete(value.name)
    else values.set(value.name, value)
    cookies.emit('changed', {}, value, 'explicit', removed)
  }
  return { cookies, ready, change, refresh: () => attach.refresh() }
}
const snapshot = () => join(directory, 'dovo-session-cookies.enc')
it('restores session cookies before navigation, keeping host-only, HttpOnly, Secure and SameSite attributes', async () => {
  const first = fixture()
  await first.ready()
  first.change(cookie)
  expect(readFileSync(snapshot(), 'utf8')).toMatch(/^encrypted:/)
  expect(statSync(snapshot()).mode & 0o777).toBe(0o600)
  const second = fixture()
  await second.ready()
  expect(second.cookies.set).toHaveBeenCalledExactlyOnceWith({
    url: 'https://example.com/',
    name: cookie.name,
    value: cookie.value,
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'no_restriction',
  })
  expect(second.cookies.set.mock.calls[0]![0]).not.toHaveProperty('expirationDate')
})
it('forgets deleted cookies and cookies replaced with an expiring cookie', async () => {
  const first = fixture()
  await first.ready()
  first.change(cookie)
  first.change(cookie, true)
  expect(existsSync(snapshot())).toBe(false)
  first.change(cookie)
  first.change({ ...cookie, session: false, expirationDate: 2000000000 })
  expect(existsSync(snapshot())).toBe(false)
  const next = fixture()
  await next.ready()
  expect(next.cookies.set).not.toHaveBeenCalled()
})
it('preserves domain cookies and HTTP, and leaves newer cookies untouched on restore', async () => {
  const first = fixture()
  await first.ready()
  first.change({
    ...cookie,
    name: 'login',
    domain: '.example.com',
    hostOnly: false,
    secure: false,
    sameSite: 'lax',
  })
  const second = fixture()
  await second.ready()
  expect(second.cookies.set).toHaveBeenCalledWith(
    expect.objectContaining({
      url: 'http://example.com/',
      domain: '.example.com',
      secure: false,
      sameSite: 'lax',
    }),
  )
  first.change(cookie)
  const third = fixture(directory, [
    { ...cookie, value: 'newer', session: false, expirationDate: 2000000000 },
  ])
  await third.ready()
  expect(third.cookies.set.mock.calls.some(([details]) => details.name === cookie.name)).toBe(false)
})
it('does not persist private profiles or fall back to unencrypted storage', async () => {
  const privateSession = fixture(null)
  await privateSession.ready()
  expect(privateSession.cookies.get).not.toHaveBeenCalled()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const previous = fixture()
  await previous.ready()
  previous.change(cookie)
  expect(existsSync(snapshot())).toBe(true)
  encryption.available = false
  const unavailable = fixture()
  await unavailable.ready()
  unavailable.change(cookie)
  expect(existsSync(snapshot())).toBe(false)
  encryption.available = true
  encryption.backend = 'basic_text'
  const plaintext = fixture()
  await plaintext.ready()
  plaintext.change(cookie)
  expect(existsSync(snapshot())).toBe(process.platform !== 'linux')
})

it('requires opt-in and clears the saved copy immediately when disabled', async () => {
  let enabled = false
  const profile = fixture(directory, [], () => enabled)
  await profile.ready()
  profile.change(cookie)
  expect(existsSync(snapshot())).toBe(false)
  enabled = true
  profile.refresh()
  expect(existsSync(snapshot())).toBe(true)
  enabled = false
  profile.refresh()
  expect(existsSync(snapshot())).toBe(false)
  profile.change({ ...cookie, value: 'updated' })
  expect(existsSync(snapshot())).toBe(false)
  expect(profile.cookies.set).not.toHaveBeenCalled()
})
it('discards an existing saved copy instead of restoring it when disabled', async () => {
  const previous = fixture()
  await previous.ready()
  previous.change(cookie)
  const disabled = fixture(directory, [], () => false)
  await disabled.ready()
  expect(disabled.cookies.set).not.toHaveBeenCalled()
  expect(existsSync(snapshot())).toBe(false)
})
it('retries a restore that failed while the keychain was locked', async () => {
  const first = fixture()
  await first.ready()
  first.change(cookie)
  encryption.locked = true
  const next = fixture()
  await expect(next.ready()).rejects.toThrow('Could not read saved browser session cookies.')
  expect(existsSync(snapshot())).toBe(true)
  encryption.locked = false
  await next.ready()
  expect(next.cookies.set).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ name: cookie.name, value: cookie.value }),
  )
})
it('keeps unrestored cookies for a retry after a partial restore', async () => {
  const first = fixture()
  await first.ready()
  first.change(cookie)
  first.change({ ...cookie, name: '__Host-second', value: 'second' })
  const next = fixture()
  next.cookies.set.mockRejectedValueOnce(new Error('Cookie store busy'))
  await expect(next.ready()).rejects.toThrow('Cookie store busy')
  expect(existsSync(snapshot())).toBe(false)
  await next.ready()
  const restored = next.cookies.set.mock.calls.map(([details]) => details.name)
  expect(restored).toEqual([cookie.name, cookie.name, '__Host-second'])
  expect(readFileSync(snapshot(), 'utf8')).toContain('__Host-second')
  // A restored session tracks changes again.
  next.change(cookie, true)
  next.change({ ...cookie, name: '__Host-second' }, true)
  expect(existsSync(snapshot())).toBe(false)
})
it('removes a damaged snapshot so the next restore starts clean', async () => {
  writeFileSync(snapshot(), 'encrypted:not json')
  const next = fixture()
  await expect(next.ready()).rejects.toThrow('Could not read saved browser session cookies.')
  expect(existsSync(snapshot())).toBe(false)
  await next.ready()
  expect(next.cookies.set).not.toHaveBeenCalled()
})
it('reads opt-outs per profile from the flat saved app settings', () => {
  const privateId = 'private-00000000-0000-4000-8000-000000000000'
  expect(
    sessionCookieOptOuts({
      browserProfiles: [
        { id: 'work' },
        { id: 'kept', keepSessionCookies: true },
        { id: 'off', keepSessionCookies: false },
        { id: 'bad id' },
        { id: privateId },
        null,
      ],
    }),
  ).toEqual(['work', 'off'])
  expect(sessionCookieOptOuts({ profiles: [{ id: 'work' }] })).toEqual([])
  expect(sessionCookieOptOuts(null)).toEqual([])
})
