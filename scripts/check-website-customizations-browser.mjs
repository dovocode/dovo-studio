import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from './browser/harness.mjs'
import { createServer } from 'node:http'
import { RemoteBrowsers } from '../packages/runtime/dist/previews/browser.js'
const built = await build({
  stdin: {
    contents:
      "export {browserWebsiteCustomizationScript} from './packages/protocol/src/runtime/previews/browser-website-customization.ts'",
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
})
const { browserWebsiteCustomizationScript } = await import(
  'data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64')
)
const browser = await chromium.launch()
try {
  const profileA = await browser.newContext()
  const profileB = await browser.newContext()
  for (const context of [profileA, profileB])
    await context.route('http://*.test/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        headers: { 'Content-Security-Policy': "default-src 'none'; style-src 'none'" },
        body: '<body><p>Original</p><iframe src="http://other.test/frame"></iframe></body>',
      }),
    )
  const rule = {
    origin: 'http://example.test',
    enabled: true,
    css: 'p { color: rgb(123, 45, 67); }',
    script:
      'document.querySelector("p").textContent = "Customized"; window.runs = (window.runs || 0) + 1;',
  }
  const pageA = await profileA.newPage()
  const pageB = await profileB.newPage()
  await pageA.goto('http://example.test/one')
  await pageB.goto('http://example.test/one')
  await pageA.evaluate(browserWebsiteCustomizationScript([rule]))
  await pageB.evaluate(browserWebsiteCustomizationScript([]))
  assert.equal(await pageA.locator('p').textContent(), 'Customized')
  assert.equal(
    await pageA.locator('p').evaluate((element) => getComputedStyle(element).color),
    'rgb(123, 45, 67)',
  )
  assert.equal(await pageB.locator('p').textContent(), 'Original', 'Other profiles stay unchanged')
  await pageA.goto('http://other.test/one')
  await pageA.evaluate(browserWebsiteCustomizationScript([rule]))
  assert.equal(await pageA.locator('p').textContent(), 'Original', 'Rules must not cross origins')
  await pageA.evaluate(
    browserWebsiteCustomizationScript([{ ...rule, script: '}); window.escaped=true; (() => {' }]),
  )
  assert.equal(
    await pageA.evaluate('window.escaped'),
    undefined,
    'Invalid code cannot escape the origin check',
  )
  await pageA.goto('http://example.test/two')
  await pageA.evaluate(browserWebsiteCustomizationScript([{ ...rule, enabled: false }]))
  assert.equal(await pageA.locator('p').textContent(), 'Original', 'Disabled rules do not run')
  await pageA.evaluate(browserWebsiteCustomizationScript([rule]))
  assert.equal(await pageA.evaluate('window.runs'), 1)
  await pageA.reload()
  await pageA.evaluate(browserWebsiteCustomizationScript([]))
  assert.equal(
    await pageA.locator('p').textContent(),
    'Original',
    'Removing and reloading clears page effects',
  )
  console.log(
    'Website CSS/scripts respect profile and exact origin, work under strict CSP, and disable/remove cleanly.',
  )
} finally {
  await browser.close()
}

// Exercise the real runtime profile reader and DOM-ready path, including saved-rule changes.
const server = createServer((_request, response) => {
  response.writeHead(200, {
    'Content-Type': 'text/html',
    'Content-Security-Policy': "default-src 'none'; style-src 'none'",
  })
  response.end('<title>Original</title><p>Original</p>')
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
let profiles = [
  {
    id: 'work',
    name: 'Work',
    websites: [
      {
        origin,
        enabled: true,
        css: 'p { color: rgb(123, 45, 67); }',
        script:
          'document.querySelector("p").textContent="Customized"; document.title=getComputedStyle(document.querySelector("p")).color;',
      },
    ],
  },
]
const remote = new RemoteBrowsers(undefined, () => profiles)
try {
  await remote.open('website-work', 'task', 'work', origin + '/one')
  const customized = (await remote.studioList()).find((tab) => tab.id === 'website-work')
  assert.equal(customized.title, 'rgb(123, 45, 67)')
  await remote.open('website-personal', 'task', 'personal', origin + '/one')
  assert.equal(
    (await remote.studioList()).find((tab) => tab.id === 'website-personal').title,
    'Original',
  )
  profiles = [{ ...profiles[0], websites: [] }]
  await remote.input('website-work', { type: 'reload' })
  assert.equal(
    (await remote.studioList()).find((tab) => tab.id === 'website-work').title,
    'Original',
  )
  console.log('Remote browser profiles apply saved rules and pick up removal on reload.')
} finally {
  await remote.dispose()
  await new Promise((resolve) => server.close(resolve))
}
