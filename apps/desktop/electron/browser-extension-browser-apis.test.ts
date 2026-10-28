import { beforeEach, afterEach, expect, it, vi } from 'vite-plus/test'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm, mkdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const f = vi.hoisted(() => ({ root: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => f.root },
  dialog: {},
  BrowserWindow: class {},
  shell: {},
}))
import { attachExtensionBrowserAPIs } from './browser-extension-browser-apis'
import { downloadFilename } from './browser-downloads'
import { extensionRedirectURL, isExtensionAuthRedirect } from './browser-identity'
type Extension = { id: string; name: string }
type Handler = (event: { extension: Extension }, ...args: unknown[]) => unknown
function fixture(profileId: string) {
  const handlers = new Map<string, Handler>()
  const grants = new Map([
    ['allowed', ['history', 'downloads']],
    ['denied', [] as string[]],
  ])
  const extensions = [...grants.keys()].map((id) => ({ id, name: id }))
  const sendEvent = vi.fn<(...args: unknown[]) => void>()
  const session = Object.assign(new EventEmitter(), {
    extensions: { getAllExtensions: () => extensions },
  })
  const library = {
    ctx: {
      router: {
        apiHandler: () => (name: string, fn: Handler) => handlers.set(name, fn),
        sendEvent,
      },
    },
    api: {
      permissions: {
        getAll: ({ extension }: { extension: Extension }) => ({
          permissions: grants.get(extension.id),
        }),
      },
    },
  }
  const adapter = attachExtensionBrowserAPIs(library, {
    session: session as never,
    profileId,
    window: () => undefined,
  })
  const call = (name: string, raw?: unknown, id = 'allowed') =>
    handlers.get(name)!({ extension: { id, name: id } }, raw)
  return { call, sendEvent, grants, adapter }
}
beforeEach(async () => {
  f.root = await mkdtemp(join(tmpdir(), 'extension-browser-apis-'))
})
afterEach(async () => {
  await rm(f.root, { recursive: true, force: true })
})
it('isolates profiles and targets events only to currently authorized extensions', () => {
  const work = fixture('work'),
    personal = fixture('personal')
  work.call('history.addUrl', { url: 'https://example.com/work' })
  expect(work.sendEvent).toHaveBeenCalledExactlyOnceWith(
    'allowed',
    'history.onVisited',
    expect.objectContaining({ url: 'https://example.com/work' }),
  )
  expect(personal.call('history.search', { text: '', startTime: 0 })).toEqual([])
  expect(() => work.call('history.search', { text: '' }, 'denied')).toThrow('permission')
  work.grants.set('allowed', [])
  expect(() => work.call('history.search', { text: '' })).toThrow('permission')
  expect(() => work.call('downloads.search', {})).toThrow('permission')
  work.adapter.dispose()
  personal.adapter.dispose()
})
it('validates API input and rejects unsupported download options instead of changing their meaning', () => {
  const { call, adapter } = fixture('work')
  expect(() => call('history.search', { text: '', maxResults: -1 })).toThrow(Error)
  expect(() => call('history.addUrl', { url: 'file:///etc/passwd' })).toThrow('web URLs')
  expect(() =>
    call('downloads.download', { url: 'https://example.com', method: 'POST', body: 'test' }),
  ).toThrow(Error)
  expect(() =>
    call('downloads.download', {
      url: 'https://example.com',
      headers: [{ name: 'x-test', value: 'ok\r\nCookie: injected' }],
    }),
  ).toThrow('header')
  expect(() => call('downloads.pause', 99)).toThrow('Invalid download ID')
  adapter.dispose()
})
it('confines download names to Downloads, including existing symlinks', async () => {
  const root = join(f.root, 'Downloads'),
    outside = join(f.root, 'outside')
  await mkdir(root)
  await mkdir(outside)
  await symlink(outside, join(root, 'escape'), 'junction')
  expect(downloadFilename(root, 'nested/file.txt')).toBe(join(root, 'nested/file.txt'))
  for (const name of [
    '../escape.txt',
    '/absolute',
    'C:/windows',
    'nested\\escape',
    'a/../escape',
    'escape/file.txt',
  ])
    expect(() => downloadFilename(root, name)).toThrow(Error)
})
it('matches only the calling extension OAuth origin and treats redirect input as a path', () => {
  const id = 'a'.repeat(32)
  expect(extensionRedirectURL(id, '//other.example/path')).toBe(
    `https://${id}.chromiumapp.org/other.example/path`,
  )
  expect(isExtensionAuthRedirect(id, `https://${id}.chromiumapp.org/callback#token=test`)).toBe(
    true,
  )
  expect(isExtensionAuthRedirect(id, `https://${id}.chromiumapp.org.attacker.test/callback`)).toBe(
    false,
  )
  expect(isExtensionAuthRedirect(id, `http://${id}.chromiumapp.org/callback`)).toBe(false)
  expect(isExtensionAuthRedirect(id, `https://${'b'.repeat(32)}.chromiumapp.org/callback`)).toBe(
    false,
  )
})
