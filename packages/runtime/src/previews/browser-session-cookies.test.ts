import { afterEach, expect, it } from 'vite-plus/test'
import { chromium, type BrowserContext } from 'playwright'
import { mkdtemp, rm, stat, access, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  restoreBrowserSessionCookies,
  saveBrowserSessionCookies,
} from './browser-session-cookies.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
})
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-runtime-cookies-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const open = async () => {
    const context = await chromium.launchPersistentContext(directory, { headless: true })
    cleanups.push(() => context.close())
    await restoreBrowserSessionCookies(context, directory)
    return context
  }
  const close = async (context: BrowserContext) => {
    await saveBrowserSessionCookies(context, directory)
    await context.close()
  }
  return { directory, open, close }
}
it('restores HTTP and secure session cookies across a real Chromium restart without extending expiry', async () => {
  const { directory, open, close } = await fixture()
  let context = await open()
  const expires = Math.floor(Date.now() / 1000) + 3600
  await context.addCookies([
    {
      name: 'http-login',
      value: 'http',
      url: 'http://lan.local/',
      httpOnly: true,
      sameSite: 'Lax',
    },
    {
      name: '__Host-login',
      value: 'secure',
      url: 'https://example.com/',
      secure: true,
      httpOnly: true,
      sameSite: 'None',
    },
    {
      name: 'domain-login',
      value: 'subdomain',
      domain: '.example.com',
      path: '/teams',
      secure: true,
      sameSite: 'Strict',
    },
    { name: 'expires', value: 'timed', url: 'http://lan.local/', expires },
  ])
  const expected = await context.cookies()
  await close(context)
  expect((await stat(join(directory, 'dovo-session-cookies.json'))).mode & 0o777).toBe(0o600)
  context = await open()
  expect((await context.cookies()).sort((a, b) => a.name.localeCompare(b.name))).toEqual(
    expected.sort((a, b) => a.name.localeCompare(b.name)),
  )
  await expect(access(join(directory, 'dovo-session-cookies.json'))).rejects.toMatchObject({
    code: 'ENOENT',
  })
}, 20000)
it('does not revive logged-out cookies after another restart or an unclean context close', async () => {
  const { open, close } = await fixture()
  let context = await open()
  await context.addCookies([{ name: 'login', value: 'initial', url: 'http://lan.local/' }])
  await close(context)
  context = await open()
  expect(await context.cookies()).toHaveLength(1)
  await context.clearCookies()
  // No clean-close snapshot: simulate a lost runtime after logout.
  await context.close()
  context = await open()
  expect(await context.cookies()).toEqual([])
  await close(context)
  context = await open()
  expect(await context.cookies()).toEqual([])
}, 20000)
it('retains cookies through the runtime profile lifecycle while keeping workspace and thread profiles separate', async () => {
  const { RemoteBrowsers } = await import('./browser.js')
  const directory = await mkdtemp(join(tmpdir(), 'dovo-profile-cookies-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const browsers = new RemoteBrowsers(directory, () => [
    { id: 'work', name: 'Work', keepSessionCookies: true },
  ])
  cleanups.push(() => browsers.dispose())
  Object.defineProperty(browsers, 'executable', {
    value: async () => ({ chromium, executablePath: chromium.executablePath() }),
  })
  const first = await browsers['profile']('work', false, true)
  const page = await first.context.newPage()
  await first.context.addCookies([{ name: 'login', value: 'workspace', url: 'http://lan.local/' }])
  expect(await first.context.cookies()).toHaveLength(1)
  await page.close()
  await first.release()
  expect(
    JSON.parse(
      await readFile(
        join(directory, 'browser-workspace.profiles/work/dovo-session-cookies.json'),
        'utf8',
      ),
    ),
  ).toMatchObject([{ name: 'login', value: 'workspace' }])
  const thread = await browsers['profile']('work')
  expect(await thread.context.cookies()).toEqual([])
  await thread.release()
  const reopened = await browsers['profile']('work', false, true)
  expect(await reopened.context.cookies()).toMatchObject([
    { name: 'login', value: 'workspace', expires: -1 },
  ])
  await reopened.context.clearCookies()
  await reopened.release()
  const loggedOut = await browsers['profile']('work', false, true)
  expect(await loggedOut.context.cookies()).toEqual([])
  await loggedOut.release()
}, 20000)

it('defaults to off and removes saved cookies when an unopened or active profile is disabled', async () => {
  const { RemoteBrowsers } = await import('./browser.js')
  const directory = await mkdtemp(join(tmpdir(), 'dovo-optional-cookies-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  let enabled = false
  const browsers = new RemoteBrowsers(directory, () => [
    { id: 'default', name: 'Default', keepSessionCookies: enabled },
  ])
  cleanups.push(() => browsers.dispose())
  Object.defineProperty(browsers, 'executable', {
    value: async () => ({ chromium, executablePath: chromium.executablePath() }),
  })
  const snapshot = join(directory, 'default/dovo-session-cookies.json')
  const first = await browsers['profile']('default')
  await first.context.addCookies([{ name: 'login', value: 'off', url: 'http://lan.local/' }])
  await first.release()
  await expect(access(snapshot)).rejects.toMatchObject({ code: 'ENOENT' })
  enabled = true
  const second = await browsers['profile']('default')
  expect(await second.context.cookies()).toEqual([])
  await second.context.addCookies([{ name: 'login', value: 'on', url: 'http://lan.local/' }])
  await second.release()
  await access(snapshot)
  enabled = false
  await browsers.refreshProfiles()
  await expect(access(snapshot)).rejects.toMatchObject({ code: 'ENOENT' })
  enabled = true
  const third = await browsers['profile']('default')
  expect(await third.context.cookies()).toEqual([])
  await third.context.addCookies([{ name: 'login', value: 'active', url: 'http://lan.local/' }])
  enabled = false
  await browsers.refreshProfiles()
  expect(await third.context.cookies()).toHaveLength(1)
  await third.release()
  await expect(access(snapshot)).rejects.toMatchObject({ code: 'ENOENT' })
}, 20000)
