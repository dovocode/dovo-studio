import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, extname, resolve, sep } from 'node:path'
import { chromium } from './browser/harness.mjs'
const output = resolve('apps/design-system/storybook-static')
const require = createRequire(new URL('../apps/design-system/package.json', import.meta.url))
const axePath = require.resolve('axe-core', {
  paths: [dirname(require.resolve('@storybook/addon-a11y/package.json'))],
})
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
}
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname
  const file = resolve(output, '.' + (path === '/' ? '/index.html' : path))
  if (!file.startsWith(output + sep)) {
    res.writeHead(403).end()
    return
  }
  try {
    res
      .writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' })
      .end(await readFile(file))
  } catch {
    res.writeHead(404).end()
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = process.env.DOVO_DESIGN_ORIGIN ?? 'http://127.0.0.1:' + server.address().port
const browser = await chromium.launch()
try {
  const index = JSON.parse(await readFile(output + '/index.json', 'utf8'))
  const stories = Object.values(index.entries).filter((item) => item.type === 'story')
  assert.ok(stories.length >= 9)
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  let checks = 0
  for (const mode of ['dark', 'light'])
    for (const width of [390, 1280])
      for (const story of stories) {
        await page.setViewportSize({ width, height: 900 })
        await page.goto(`${origin}/iframe.html?id=${story.id}&viewMode=story&globals=theme:${mode}`)
        await page.locator('#storybook-root').waitFor()
        await page.waitForFunction(
          () =>
            document.documentElement.dataset.theme &&
            document.querySelector('#storybook-root')?.children.length,
        )
        assert.equal(await page.locator('html').getAttribute('data-theme'), mode)
        await page.evaluate(async () => {
          await document.fonts.ready
          const transitions = document
            .getAnimations()
            .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
          await Promise.all(
            transitions.map((animation) => animation.finished.catch(() => undefined)),
          )
        })
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          `${story.id} ${mode} ${width}: horizontal overflow`,
        )
        if (story.title === 'Dovo/Hosted services') {
          const root = page.frameLocator('iframe[title="Hosted service preview"]').locator('html')
          await root.locator('body').waitFor()
          assert.equal(await root.getAttribute('data-theme'), mode)
          assert.ok(
            await root.evaluate((el) => el.scrollWidth <= el.clientWidth),
            `${story.id} ${mode} ${width}: hosted page overflow`,
          )
          const buttons = root.locator('button')
          for (const button of await buttons.all())
            assert.ok(
              await button.evaluate((el) => el.getBoundingClientRect().height >= 44),
              'Hosted touch target must be at least 44px',
            )
        }
        if (story.id === 'dovo-controls--composer') {
          const field = page.getByRole('textbox', { name: 'Task message' })
          await field.fill('Verify a consistent Dovo UI')
          await field.focus()
          const focused = await field.evaluate((el) => {
            const form = el.closest('form')
            return {
              boxShadow: getComputedStyle(form).boxShadow,
              border: getComputedStyle(form).borderTopColor,
              outline: getComputedStyle(el).outlineStyle,
            }
          })
          assert.equal(focused.boxShadow, 'none', 'Composer must not glow')
          assert.equal(
            focused.outline,
            'none',
            'Composer textarea must not add a second focus ring',
          )
          const button = page.getByRole('button', { name: 'Send task', exact: true })
          await button.focus()
          const focus = await button.evaluate((el) => {
            const s = getComputedStyle(el)
            return { outline: s.outlineStyle, shadow: s.boxShadow }
          })
          assert.ok(
            focus.outline !== 'none' || focus.shadow !== 'none',
            'Keyboard focus must remain visible',
          )
          await button.click()
          await page.getByRole('status').waitFor()
        }
        if (width === 390) {
          await page.addScriptTag({ path: axePath })
          const violations = await page.evaluate(async () =>
            (
              await window.axe.run(document.querySelector('#storybook-root'), {
                runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
              })
            ).violations.map((v) => ({
              id: v.id,
              nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
            })),
          )
          assert.deepEqual(violations, [], `${story.id} ${mode}: accessibility violations`)
        }
        checks++
      }
  assert.deepEqual(errors, [])
  await page.goto(
    origin + '/iframe.html?id=dovo-controls--composer&viewMode=story&globals=theme:dark',
  )
  await page.getByRole('textbox', { name: 'Task message' }).fill('One focused border, no glow.')
  await page.screenshot({ path: '/tmp/dovo-design-composer.png', fullPage: true })
  console.log(
    `Dovo design catalog: ${checks} story/theme/viewport checks, axe accessibility, composer focus and submit pass.`,
  )
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
