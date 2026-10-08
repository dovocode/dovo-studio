import assert from 'node:assert/strict'
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
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const route of ['/', '/download/', '/docs/']) {
      await page.goto(origin + route)
      await page.getByRole('heading', { level: 1 }).waitFor()
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
  assert.equal((await page.request.get(origin + '/robots.txt')).status(), 200)
  assert.match(
    await (await page.request.get(origin + '/sitemap.xml')).text(),
    /https:\/\/dovo.studio\/docs\//,
  )
  assert.deepEqual(errors, [])
  await page.goto(origin + '/')
  await page.screenshot({ path: '/tmp/dovo-site-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 375, height: 812 })
  await page.screenshot({ path: '/tmp/dovo-site-mobile.png', fullPage: true })
  console.log(
    'Dovo site: production routes, canonical URLs, responsive layouts, navigation, stable/nightly selection, published release filtering and API failure fallback passed.',
  )
} finally {
  await browser.close()
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
}
