import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const f = vi.hoisted(() => ({
  root: '',
  prompt: vi.fn<(options: Electron.MessageBoxOptions) => Promise<{ response: number }>>(
    async () => ({ response: 0 }),
  ),
}))
vi.mock('electron', () => ({
  app: { getPath: () => f.root },
  BrowserWindow: { fromWebContents: () => undefined },
  dialog: { showMessageBox: f.prompt },
}))
import { browserPermissions } from './browser-permissions'
import {
  commonBrowserPermissionAllowed,
  requestCommonBrowserPermission,
  revokeCommonBrowserPermissions,
} from './browser-common-permissions'
const origin = 'https://teams.microsoft.com'
function page() {
  return Object.assign(new EventEmitter(), {
    mainFrame: { url: origin + '/call' },
    isDestroyed: () => false,
  })
}
beforeEach(async () => {
  f.root = await mkdtemp(join(tmpdir(), 'common-browser-permissions-'))
  f.prompt.mockClear()
  f.prompt.mockResolvedValue({ response: 0 })
})
afterEach(async () => {
  await rm(f.root, { recursive: true, force: true })
})
it('allows clipboard once without saving and saves explicit always-allow by site and profile', async () => {
  const contents = page()
  expect(
    await requestCommonBrowserPermission(contents as never, 'work', origin, 'clipboard-read'),
  ).toBe(true)
  expect(browserPermissions('work').site(origin).permissions['clipboard-read']).toBe('ask')
  expect(browserPermissions('work').site(origin).requested).toEqual(['clipboard-read'])
  contents.emit('did-navigate')
  f.prompt.mockResolvedValueOnce({ response: 1 })
  expect(
    await requestCommonBrowserPermission(contents as never, 'work', origin, 'clipboard-read'),
  ).toBe(true)
  expect(browserPermissions('work').site(origin).permissions['clipboard-read']).toBe('allow')
  expect(browserPermissions('personal').site(origin).permissions['clipboard-read']).toBe('ask')
  expect(
    browserPermissions('work').site('https://other.example').permissions['clipboard-read'],
  ).toBe('ask')
})
it('honors blocks without a prompt and grants ordinary wake locks using native Chromium behavior', async () => {
  const contents = page()
  browserPermissions('work').setSite(origin, 'speaker-selection', 'block')
  expect(
    await requestCommonBrowserPermission(contents as never, 'work', origin, 'speaker-selection'),
  ).toBe(false)
  expect(
    await requestCommonBrowserPermission(contents as never, 'work', origin, 'screen-wake-lock'),
  ).toBe(true)
  expect(f.prompt).not.toHaveBeenCalled()
  expect(browserPermissions('work').site(origin).requested).toEqual([
    'speaker-selection',
    'screen-wake-lock',
  ])
})
it('coalesces repeated requests and rejects a stale approval after navigation', async () => {
  const contents = page()
  let answer = (_response: { response: number }) => {}
  f.prompt.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        answer = resolve
      }),
  )
  const first = requestCommonBrowserPermission(
    contents as never,
    'work',
    origin,
    'persistent-storage',
  )
  const second = requestCommonBrowserPermission(
    contents as never,
    'work',
    origin,
    'persistent-storage',
  )
  expect(f.prompt).toHaveBeenCalledOnce()
  contents.emit('did-navigate')
  answer({ response: 1 })
  expect(await first).toBe(false)
  expect(await second).toBe(false)
  expect(browserPermissions('work').site(origin).permissions['persistent-storage']).toBe('ask')
})

it('retains one-time idle access for start checks in this document and clears it on navigation', async () => {
  const contents = page()
  const allowed = (profile = 'work', site = origin) =>
    commonBrowserPermissionAllowed(contents as never, profile, site, 'idle-detection')
  expect(allowed()).toBe(false)
  expect(browserPermissions('work').site(origin).requested).toEqual([])
  expect(
    await requestCommonBrowserPermission(contents as never, 'work', origin, 'idle-detection'),
  ).toBe(true)
  expect(allowed()).toBe(true)
  expect(allowed('personal')).toBe(false)
  expect(allowed('work', 'https://other.example')).toBe(false)
  expect(browserPermissions('work').site(origin).permissions['idle-detection']).toBe('ask')
  await requestCommonBrowserPermission(contents as never, 'work', origin, 'idle-detection')
  expect(f.prompt).toHaveBeenCalledOnce()
  contents.emit('did-navigate')
  expect(allowed()).toBe(false)
})

it('revokes temporary idle access when settings change, a page closes, or its frame changes', async () => {
  const contents = page()
  const request = () =>
    requestCommonBrowserPermission(contents as never, 'work', origin, 'idle-detection')
  const allowed = () =>
    commonBrowserPermissionAllowed(contents as never, 'work', origin, 'idle-detection')
  await request()
  browserPermissions('work').setSite(origin, 'idle-detection', 'block')
  expect(allowed()).toBe(false)
  revokeCommonBrowserPermissions(contents as never)
  browserPermissions('work').setSite(origin, 'idle-detection', 'ask')
  expect(allowed()).toBe(false)
  await request()
  contents.mainFrame = { url: origin + '/replacement' }
  expect(allowed()).toBe(false)
  await request()
  contents.emit('destroyed')
  expect(allowed()).toBe(false)
})

it('denies a pending answer after explicit revocation, even without a navigation', async () => {
  const contents = page()
  let answer = (_response: { response: number }) => {}
  f.prompt.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        answer = resolve
      }),
  )
  const pending = requestCommonBrowserPermission(contents as never, 'work', origin, 'local-fonts')
  revokeCommonBrowserPermissions(contents as never)
  answer({ response: 1 })
  expect(await pending).toBe(false)
  expect(browserPermissions('work').site(origin).permissions['local-fonts']).toBe('ask')
})

it('includes the selected file and access mode in file permission prompts', async () => {
  const contents = page()
  await requestCommonBrowserPermission(contents as never, 'work', origin, 'fileSystem', undefined, {
    filePath: '/Downloads/report.txt',
    fileAccessType: 'writable',
    isDirectory: false,
  })
  expect(f.prompt.mock.calls[0]![0]).toMatchObject({
    detail: 'File: /Downloads/report.txt\nAccess: writable',
  })
})
