import { expect, it, vi } from 'vite-plus/test'
import { chromium, type Browser } from 'playwright'
import { createServer } from 'node:http'
import { decode, STUDIO_BROWSER_SCOPE, type BrowserProfile } from '@dovo/protocol'
import { RemoteBrowsers } from './browser'
import { agentBrowserResultSchema } from './agent-browser'

it('applies profile time zones to current and new tabs and reports failed downloads through the agent schema', async () => {
  // This host disallows user namespaces. The override is limited to this local fixture.
  const launch = chromium.launch.bind(chromium)
  let browser: Browser | undefined
  const spy = vi.spyOn(chromium, 'launch').mockImplementation(async (options) => {
    browser = await launch({ ...options, chromiumSandbox: false })
    return browser
  })
  let profiles: BrowserProfile[] = [{ id: 'work', name: 'Work', timezone: 'Pacific/Auckland' }]
  const browsers = new RemoteBrowsers(undefined, () => profiles)
  Object.defineProperty(browsers, 'executable', {
    value: async () => ({ chromium, executablePath: chromium.executablePath() }),
  })
  const server = createServer((request, response) => {
    if (request.url === '/download') {
      response.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="report.bin"',
        'Content-Length': '10000000',
      })
      response.write(Buffer.alloc(1024))
      return
    }
    response.writeHead(200, { 'Content-Type': 'text/html' }).end('<a href="/download">Download</a>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/`
  try {
    await browsers.open('zone-one', STUDIO_BROWSER_SCOPE, 'work', url)
    const first = browser?.contexts()[0]?.pages()[0]
    if (!first) throw new Error('Missing browser session')
    const zone = () => first.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
    expect(await zone()).toBe('Pacific/Auckland')
    profiles = [{ id: 'work', name: 'Work', timezone: 'America/New_York' }]
    await browsers.refreshProfiles()
    expect(await zone()).toBe('America/New_York')
    await browsers.open('zone-two', STUDIO_BROWSER_SCOPE, 'work', url)
    const second = browser
      ?.contexts()[0]
      ?.pages()
      .find((page) => page !== first)
    expect(await second?.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe(
      'America/New_York',
    )
    profiles = [{ id: 'work', name: 'Work' }]
    await browsers.refreshProfiles()
    expect(await zone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
    const downloading = first.waitForEvent('download')
    await first.locator('a').click()
    await (await downloading).cancel()
    await vi.waitFor(async () => {
      const result = decode(
        agentBrowserResultSchema,
        await browsers.agentCommand('worker', { action: 'snapshot' }, () => {}, 'zone-one'),
      )
      expect(result.downloadErrors).toHaveLength(1)
    })
    const observed = decode(
      agentBrowserResultSchema,
      await browsers.agentCommand('worker', { action: 'snapshot' }, () => {}, 'zone-one'),
    )
    expect(observed.downloadErrors?.[0]?.message).toContain('Could not download report.bin')
    expect(observed.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
  } finally {
    await browsers.dispose()
    spy.mockRestore()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}, 30000)
