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
  assert.ok(
    stories.length >= 45,
    'Keep the component anatomy, primitives and product patterns covered',
  )
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  const errors = []
  const accessibilityFailures = []
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
          if (violations.length) accessibilityFailures.push({ story: story.id, mode, violations })
        }
        checks++
      }
  assert.deepEqual(errors, [])
  assert.deepEqual(accessibilityFailures, [], 'Component accessibility violations')
  const openStory = async (id) => {
    await page.goto(`${origin}/iframe.html?id=${id}&viewMode=story&globals=theme:dark`)
    await page.locator('#storybook-root > *').first().waitFor()
  }
  await openStory('dovo-primitives--checkbox-states')
  const mixed = page.getByRole('checkbox', { name: 'Select all projects', exact: true })
  assert.equal(await mixed.getAttribute('aria-checked'), 'mixed')
  assert.ok(await mixed.locator('.lucide-minus').isVisible(), 'Mixed selection needs a minus glyph')
  assert.equal(await mixed.locator('.lucide-check').isVisible(), false)
  const checkbox = page.getByRole('checkbox', { name: 'Include ignored files', exact: true })
  await checkbox.focus()
  await page.keyboard.press('Space')
  assert.equal(await checkbox.getAttribute('aria-checked'), 'true')

  await openStory('dovo-primitives--select-groups-and-keyboard')
  const select = page.getByRole('combobox', { name: 'Default agent', exact: true })
  await select.focus()
  await page.keyboard.press('Enter')
  await page.getByRole('option', { name: 'Codex', exact: true }).waitFor()
  await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'option')
  await page.keyboard.press('ArrowDown')
  await page.waitForFunction(() => document.activeElement?.textContent === 'Claude')
  await page.keyboard.press('Enter')
  assert.equal((await select.innerText()).trim(), 'Claude')

  await openStory('dovo-primitives--dialog-confirmation')
  const trigger = page.getByRole('button', { name: 'Disconnect computer', exact: true })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'Disconnect this computer?', exact: true })
  await dialog.waitFor()
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Tab')
    assert.ok(
      await dialog.evaluate((el) => el.contains(document.activeElement)),
      'Modal focus must stay inside',
    )
  }
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  await page.waitForFunction(() => document.activeElement?.textContent === 'Disconnect computer')
  assert.ok(
    await trigger.evaluate((el) => el === document.activeElement),
    'Dismissal returns focus to trigger',
  )

  await openStory('dovo-patterns-forms-and-settings--destructive-confirmation')
  await page.getByRole('button', { name: 'Delete project', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Keep project', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: 'Reset preview', exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Delete project', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Delete project and history', exact: true })
    .click()
  await page.getByRole('button', { name: 'Reset preview', exact: true }).click()
  await page.getByRole('button', { name: 'Delete project', exact: true }).waitFor()

  await openStory('dovo-selection--searchable-choice')
  const choice = page.getByRole('button', { name: 'Computer', exact: true, includeHidden: true })
  await choice.click()
  const search = page.getByRole('combobox', { name: 'Search computer', exact: true })
  await search.fill('no-such-computer')
  await page.getByText('No matching options.', { exact: true }).waitFor()
  await page.keyboard.press('Enter')
  assert.equal(await choice.getAttribute('data-value'), 'local')
  await search.fill('agent')
  await page.keyboard.press('Enter')
  assert.equal(await choice.getAttribute('data-value'), 'agent')

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openStory('dovo-button-playground--loading-prevents-duplicate-activation')
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click()
  const saving = page.getByRole('button', { name: 'Saving…', exact: true })
  assert.ok(await saving.isDisabled())
  assert.equal(await saving.getAttribute('aria-busy'), 'true')
  assert.ok(
    await saving
      .locator('svg')
      .evaluate((el) => parseFloat(getComputedStyle(el).animationDuration) < 0.01),
    'Reduced motion removes the continuous spinner',
  )
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  assert.ok(await page.getByRole('button', { name: 'Save preferences', exact: true }).isEnabled())
  await page.emulateMedia({ reducedMotion: 'no-preference' })

  const touch = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 900 },
  })
  try {
    const touchPage = await touch.newPage()
    await touchPage.goto(
      `${origin}/iframe.html?id=dovo-primitives--button-sizes-and-icon-names&viewMode=story`,
    )
    await touchPage.locator('#storybook-root button').first().waitFor()
    for (const button of await touchPage.locator('#storybook-root button').all()) {
      const size = await button.boundingBox()
      assert.ok(
        size && size.width >= 44 && size.height >= 44,
        'Coarse-pointer buttons need 44px targets',
      )
    }
  } finally {
    await touch.close()
  }
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
