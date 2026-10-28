import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const f = vi.hoisted(() => ({
  root: '',
  prompt: vi.fn<() => Promise<{ response: number }>>(async () => ({ response: 0 })),
}))
vi.mock('electron', () => ({
  app: { getPath: () => f.root },
  BrowserWindow: { fromWebContents: () => undefined },
  dialog: { showMessageBox: f.prompt },
}))
import { browserPermissions } from './browser-permissions'
import { requestCommonBrowserPermission } from './browser-common-permissions'
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
