import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { chromium } from 'playwright'

const output = new URL('../apps/site/out/', import.meta.url).pathname
const mime = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.png': 'image/png',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
}
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
  const file = resolve(output, `.${pathname}`, pathname.endsWith('/') ? 'index.html' : '')
  if (!file.startsWith(resolve(output) + sep)) {
    response.writeHead(403).end()
    return
  }
  try {
    const body = await readFile(file)
    response
      .writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' })
      .end(body)
  } catch {
    response.writeHead(404).end()
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
assert.ok(address && typeof address === 'object')
const origin = `http://127.0.0.1:${address.port}`
const browser = await chromium.launch({ headless: true })
const release = (tag, date, extra = {}) => ({
  tag_name: tag,
  html_url: `https://github.com/dovocode/dovo-studio/releases/tag/${tag}`,
  published_at: date,
  draft: false,
  prerelease: true,
  ...extra,
})
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://api.github.com/repos/dovocode/dovo-studio/releases?*', (route) =>
    route.fulfill({
      json: [
        release('v0.0.9-nightly.1', '2026-10-01T00:00:00Z'),
        release('v0.0.9-nightly.2', '2026-10-02T00:00:00Z'),
        release('v0.0.9-nightly.3', '2026-10-03T00:00:00Z', { draft: true }),
        release('v0.0.9-nightly.4', '2026-10-04T00:00:00Z', { html_url: 'https://example.com' }),
        release('v0.0.9', '2026-10-05T00:00:00Z', { prerelease: false }),
        null,
      ],
    }),
  )
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  for (const width of [320, 375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const route of ['/', '/download/', '/docs/']) {
      await page.goto(origin + route)
      await page.getByRole('heading', { level: 1 }).waitFor()
      const command = await page.locator('.command-panel pre').textContent()
      assert.match(command, /--channel stable --host 0\.0\.0\.0/)
      execFileSync('bash', ['-n', '-c', command])
      assert.equal(
        await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
        'rgb(8, 8, 8)',
      )
      if (route !== '/docs/') {
        const mobile = page.getByRole('region', { name: 'Mobile availability' })
        assert.equal(await mobile.getByText('Work in progress', { exact: true }).isVisible(), true)
        assert.equal(await mobile.getByText('Coming soon', { exact: true }).isVisible(), true)
      }

      assert.equal(
        await page.locator('link[rel="canonical"]').getAttribute('href'),
        'https://dovo.studio' + route,
      )
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        true,
        `${route} overflows at ${width}px`,
      )
    }
  }
  await page.goto(origin + '/')
  await page.getByRole('link', { name: 'Get Dovo Studio' }).click()
  await page.getByRole('button', { name: /Nightly Try/ }).click()
  const latest = page.getByRole('link', { name: /Latest nightly: 0.0.9-nightly.2/ })
  await latest.waitFor()
  assert.equal(
    await latest.getAttribute('href'),
    'https://github.com/dovocode/dovo-studio/releases/tag/v0.0.9-nightly.2',
  )
  assert.equal(
    await page.getByRole('link', { name: /View Windows nightlies/ }).getAttribute('href'),
    await latest.getAttribute('href'),
  )
  await page.getByRole('button', { name: /Stable Recommended/ }).click()
  assert.equal(
    await page.getByRole('link', { name: /View macOS downloads/ }).getAttribute('href'),
    'https://github.com/dovocode/dovo-studio/releases/latest',
  )
  await page.unroute('https://api.github.com/repos/dovocode/dovo-studio/releases?*')
  await page.route('https://api.github.com/repos/dovocode/dovo-studio/releases?*', (route) =>
    route.fulfill({ status: 403, json: { message: 'API rate limit exceeded' } }),
  )
  await page.reload()
  await page.getByRole('button', { name: /Nightly Try/ }).click()
  await page.getByText('The latest nightly could not be loaded.', { exact: false }).waitFor()
  assert.equal(
    await page.getByRole('link', { name: /View Linux nightlies/ }).getAttribute('href'),
    'https://github.com/dovocode/dovo-studio/releases?q=nightly&expanded=true',
  )
  await page.goto(origin + '/docs/')
  await page.getByRole('button', { name: 'Nightly server', exact: true }).click()
  const nightlyCommand = await page.locator('.command-panel pre').textContent()
  execFileSync('bash', ['-n', '-c', nightlyCommand])
  assert.match(nightlyCommand, /--channel nightly --host 0\.0\.0\.0/)
  assert.match(nightlyCommand, /dovo-server-nightly" pair/)
  await page.getByRole('button', { name: 'Copy command', exact: true }).click()
  await page.getByRole('button', { name: 'Copied', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), nightlyCommand)
  await page.getByRole('button', { name: 'Stable server', exact: true }).click()
  const stableCommand = await page.locator('.command-panel pre').textContent()
  assert.match(stableCommand, /dovo-server" pair/)
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw Error('Clipboard unavailable')
        },
      },
    }),
  )
  await page.getByRole('button', { name: 'Copy command', exact: true }).click()
  await page.getByRole('status').getByText('Clipboard unavailable.', { exact: false }).waitFor()
  assert.equal((await page.request.get(origin + '/robots.txt')).status(), 200)
  assert.match(
    await (await page.request.get(origin + '/sitemap.xml')).text(),
    /https:\/\/dovo.studio\/docs\//,
  )
  assert.deepEqual(errors, [])
  await page.goto(origin + '/')
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('.product-screenshot img')).every(
      (image) => image.complete && image.naturalWidth > 0,
    ),
  )
  assert.equal(await page.locator('.product-screenshot img').count(), 3)
  await page.getByRole('button', { name: 'Automations', exact: false }).click()
  await page.getByRole('heading', { name: 'Make your good workflows repeatable.' }).waitFor()
  assert.equal(
    await page.locator('.product-tour img').getAttribute('src'),
    '/screenshots/automations.png',
  )
  await page.getByRole('button', { name: 'Code & review', exact: false }).click()
  await page.getByRole('heading', { name: 'Stay in the loop. All the way to ship.' }).waitFor()
  await page.getByRole('button', { name: 'Agent workspace', exact: false }).click()
  await page.getByText('Do I need a Dovo account?', { exact: true }).click()
  assert.equal(await page.locator('.faq details[open]').count(), 1)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.reload()
  await page.waitForFunction(() => document.querySelectorAll('.reveal').length > 0)
  assert.equal(
    await page
      .locator('.hero-stage')
      .evaluate((element) => getComputedStyle(element, '::before').animationName),
    'ambient-drift',
  )
  await page.locator('.ownership').scrollIntoViewIfNeeded()
  await page.waitForFunction(() =>
    document.querySelector('.ownership')?.classList.contains('is-visible'),
  )
  const fleet = page.getByRole('region', { name: 'Start small. Think in fleets.' })
  await fleet.scrollIntoViewIfNeeded()
  await page.waitForFunction(
    () => document.querySelector('.fleet')?.getAttribute('data-running') === 'true',
  )
  await page.waitForFunction(() =>
    document.querySelector('.fleet-event')?.textContent?.includes('Build the API'),
  )
  await fleet.getByRole('button', { name: 'Pause animation', exact: true }).click()
  assert.equal(await fleet.getAttribute('data-running'), 'false')
  const pausedEvent = await fleet.locator('.fleet-event').textContent()
  await page.waitForTimeout(1100)
  assert.equal(await fleet.locator('.fleet-event').textContent(), pausedEvent)
  await fleet.getByRole('button', { name: '02 Parallel threads' }).click()
  assert.equal(await fleet.locator('.fleet-agent').count(), 4)
  assert.equal(await fleet.locator('.fleet-scale > strong').textContent(), '4')
  await fleet.getByRole('button', { name: '03 Threads + subagents' }).click()
  assert.equal(await fleet.locator('.fleet-subagents.expanded').count(), 4)
  assert.equal(await fleet.locator('.fleet-child:visible').count(), 12)
  assert.equal(await fleet.locator('.fleet-scale > strong').textContent(), '16')
  await fleet.getByRole('button', { name: /04 Connected runtimes/ }).click()
  assert.equal(await fleet.getAttribute('data-stage'), '3')
  assert.equal(
    await fleet
      .getByText('Coming soon · Experimental cross-runtime orchestration', { exact: true })
      .isVisible(),
    true,
  )
  assert.equal(await fleet.getByText('Lead agent', { exact: true }).isVisible(), true)
  assert.equal(
    await fleet.locator('.fleet-runtime-header').filter({ hasText: 'Build server' }).isVisible(),
    true,
  )
  assert.equal(await fleet.locator('.fleet-exchange').count(), 6)
  assert.equal(await fleet.locator('.fleet-runtime').count(), 4)
  assert.equal(await fleet.locator('.fleet-agent').count(), 16)
  assert.equal(await fleet.locator('.fleet-child:visible').count(), 48)
  assert.equal(await fleet.locator('.fleet-scale > strong').textContent(), '64')
  await fleet.getByRole('button', { name: /05 Dovo orchestrates/ }).click()
  assert.equal(await fleet.getAttribute('data-stage'), '4')
  assert.equal(await fleet.locator('.fleet-dovo-orchestrator strong').textContent(), 'Dovo')
  assert.equal(
    await fleet.getByText('Coming soon · Dovo fleet orchestration', { exact: true }).isVisible(),
    true,
  )
  assert.equal(await fleet.locator('.fleet-scale > strong').textContent(), '65')
  await fleet.getByRole('button', { name: 'Play animation', exact: true }).click()
  await fleet.getByRole('button', { name: 'Pause animation', exact: true }).waitFor()
  assert.equal(await fleet.locator('.fleet-diagram animateMotion').count(), 16)
  await fleet.getByRole('button', { name: 'Play animation', exact: true }).waitFor()
  assert.equal(await fleet.getAttribute('data-stage'), '4')
  assert.match(await fleet.locator('.fleet-event').textContent(), /You review what ships/)
  await fleet.getByRole('button', { name: 'Replay from start', exact: true }).click()
  assert.equal(await fleet.getAttribute('data-stage'), '0')
  await page.locator('.hero').scrollIntoViewIfNeeded()
  await page.waitForFunction(
    () => document.querySelector('.fleet')?.getAttribute('data-running') === 'false',
  )
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.reload()
  assert.equal(await page.locator('.reveal').count(), 0)
  await page.locator('.fleet').scrollIntoViewIfNeeded()
  assert.equal(await page.locator('.fleet').getAttribute('data-running'), 'false')
  assert.equal(await page.getByRole('button', { name: 'Pause animation' }).count(), 0)
  await page.getByRole('button', { name: /05 Dovo orchestrates/ }).click()
  assert.equal(await page.locator('.fleet').getAttribute('data-stage'), '4')
  for (const width of [320, 375, 768, 1000, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    assert.equal(await page.locator('.fleet-agent').count(), 16)
    assert.equal(await page.locator('.fleet-child').count(), 48)
    assert.equal(await page.locator('.fleet-mobile-flow').isVisible(), width <= 800)
    if (width <= 800) {
      assert.equal(await page.locator('.mobile-fleet-node').count(), 65)
      assert.ok(
        await page
          .locator('.fleet-mobile-flow')
          .evaluate((element) => element.getBoundingClientRect().height < 520),
      )
      assert.equal(await page.locator('.fleet-diagram').isVisible(), false)
    }
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
      `Expanded fleet overflows at ${width}px`,
    )
    assert.equal(
      await page
        .locator('.fleet-canvas')
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
      true,
    )
  }
  await page.locator('.fleet').screenshot({ path: '/tmp/dovo-fleet-desktop.png' })
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: '/tmp/dovo-site-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 375, height: 812 })
  await page.screenshot({ path: '/tmp/dovo-site-mobile.png', fullPage: true })
  for (const [stage, count] of [1, 4, 16, 64, 65].entries()) {
    await page.locator('.fleet-stages button').nth(stage).click()
    assert.equal(await page.locator('.mobile-fleet-node').count(), count)
    assert.equal(
      await page.locator('.fleet-mobile-flow').getAttribute('data-agents'),
      String(count),
    )
    assert.ok(
      await page
        .locator('.fleet-mobile-flow')
        .evaluate((element) => element.getBoundingClientRect().height < 520),
    )
  }
  await page.locator('.fleet').screenshot({ path: '/tmp/dovo-fleet-mobile.png' })
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
  )
  assert.equal(
    await page
      .locator('.fleet-canvas')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
    true,
  )
  console.log(
    'Dovo site: production routes, canonical URLs, responsive layouts, navigation, stable/nightly selection, published release filtering, API failure fallback, actual screenshots, fleet playback/stages/reduced motion and copyable stable/nightly server setup passed.',
  )
} finally {
  await browser.close()
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
}
