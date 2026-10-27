import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { describeShard, hostedMatrixCases, shardCases } from './ci/design-system-shards.mjs'
const require = createRequire(new URL('../apps/design-system/package.json', import.meta.url))
const axeSource = await readFile(
  require.resolve('axe-core', {
    paths: [dirname(require.resolve('@storybook/addon-a11y/package.json'))],
  }),
  'utf8',
)

/**
 * Inspect the actual inner hosted documents; outer Storybook axe alone cannot inspect these frames.
 *
 * `matrix` runs this shard's slice of the entry/theme/viewport cases (`shard` of `count`, see
 * `scripts/ci/design-system-shards.mjs`); `interactions` runs the hosted interaction pass, which is
 * not sharded and must run exactly once per CI run. `interactionsOnly` remains as the legacy spelling
 * of `{ matrix: false, interactions: true }`.
 */
export async function checkHostedScreens(page, origin, options = {}) {
  const {
    interactionsOnly = false,
    matrix = !interactionsOnly,
    interactions = true,
    shard = 0,
    count = 1,
  } = options
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const index = await (await page.request.get(`${origin}/index.json`)).json()
  const entries = Object.values(index.entries).filter(
    (item) => item.type === 'story' && item.title === 'Dovo/Screens/Hosted',
  )
  assert.ok(entries.length >= 42, 'Hosted page inventory missing')
  const externalRequests = []
  const captureRequest = (request) => {
    const url = new URL(request.url())
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== new URL(origin).origin)
      externalRequests.push(url.origin + url.pathname)
  }
  page.on('request', captureRequest)
  const pageErrors = []
  const captureError = (error) => pageErrors.push(error.message)
  page.on('pageerror', captureError)
  const cases = matrix ? shardCases(hostedMatrixCases(entries), { shard, count }) : []
  if (matrix) assert.ok(cases.length, `Hosted ${describeShard({ shard, count })} owns no cases`)
  let checks = 0
  for (const { entry, theme, width } of cases) {
    pageErrors.length = 0
    await page.setViewportSize({ width, height: 900 })
    await page.goto(`${origin}/iframe.html?id=${entry.id}&viewMode=story&globals=theme:${theme}`)
    const host = page.locator('#storybook-root iframe')
    await host.waitFor()
    const frame = await (await host.elementHandle()).contentFrame()
    assert.ok(frame)
    await frame.locator('body').waitFor()
    if (entry.name.startsWith('Website')) {
      await frame.locator('header').waitFor()
      await frame.waitForFunction(() =>
        [...document.images].every((image) => image.complete && image.naturalWidth > 0),
      )
    } else if (entry.name.startsWith('Artifacts') && entry.name !== 'Artifacts Loading')
      await frame.locator('.app-shell').waitFor()
    await frame.evaluate(async () => {
      await Promise.allSettled(
        document
          .getAnimations()
          .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
          .map((animation) => animation.finished),
      )
    })
    assert.ok(
      await frame.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--action').trim(),
      ),
      `${entry.id}: shared UI stylesheet missing`,
    )
    for (const control of await frame.locator('[data-slot="button"]').all()) {
      if (await control.isVisible())
        assert.ok(
          await control.evaluate((el) => {
            const minimum = el.closest('.header-actions') ? (innerWidth <= 640 ? 40 : 36) : 44
            return el.getBoundingClientRect().height >= minimum
          }),
          `${entry.id}: hosted control must meet its header or dialog touch size`,
        )
    }

    await frame.evaluate(axeSource)
    const result = await frame.evaluate(async () => {
      const result = await window.axe.run(document, {
        iframes: false,
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
      })
      return result.violations.map((item) => ({
        id: item.id,
        impact: item.impact,
        nodes: item.nodes.map((node) => ({ html: node.html, summary: node.failureSummary })),
      }))
    })
    assert.deepEqual(result, [], `${entry.id} ${theme} ${width}: ${JSON.stringify(result)}`)
    assert.ok(
      await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `${entry.id} horizontal overflow at ${width}`,
    )
    assert.deepEqual(pageErrors, [], `${entry.id} browser errors`)
    checks++
  }
  if (interactions) {
    await page.goto(
      `${origin}/iframe.html?id=dovo-screens-hosted--artifacts-sign-in&viewMode=story`,
    )
    const artifacts = page.frameLocator('#storybook-root iframe')
    await artifacts.getByRole('button', { name: 'Sign in', exact: true }).click()
    await artifacts.getByRole('heading', { name: 'Compare your sign-in code' }).waitFor()
    await artifacts.getByRole('button', { name: 'Check sign-in', exact: true }).click()
    await artifacts.getByRole('status').filter({ hasText: 'Sign-in is still pending' }).waitFor()
    await page.goto(`${origin}/iframe.html?id=dovo-screens-hosted--website-download&viewMode=story`)
    const website = page.frameLocator('#storybook-root iframe')
    await website
      .getByRole('group', { name: 'Release channel', exact: true })
      .getByRole('button', { name: /Nightly/ })
      .click()
    await website
      .getByText(/0.0.9-nightly.999/)
      .first()
      .waitFor()
    await website
      .getByRole('group', { name: 'Release channel', exact: true })
      .getByRole('button', { name: /Stable/ })
      .click()
    await website
      .getByRole('group', { name: 'Release channel', exact: true })
      .getByRole('button', { name: /Stable/ })
      .and(website.locator('[aria-pressed=true]'))
      .waitFor()
    await page.goto(
      `${origin}/iframe.html?id=dovo-screens-hosted--website-home&viewMode=story&globals=theme:light`,
    )
    const home = page.frameLocator('#storybook-root iframe')
    await home
      .getByRole('group', { name: 'Product features' })
      .getByRole('button', { name: 'Code & review', exact: true })
      .click()
    await home.getByRole('heading', { name: 'Stay in the loop. All the way to ship.' }).waitFor()
    await home
      .getByRole('group', { name: 'Product features' })
      .getByRole('button', { name: 'Automations', exact: true })
      .click()
    await home.getByRole('heading', { name: 'Make your good workflows repeatable.' }).waitFor()
    await home.getByRole('button', { name: /Parallel threads/ }).click()
    await home.getByRole('heading', { name: 'Give every idea room to run.' }).waitFor()
    await home.getByRole('button', { name: 'Nightly server', exact: true }).click()
    await home
      .locator('pre[aria-label="Nightly server install command"]')
      .filter({ hasText: '--channel nightly' })
      .waitFor()
    await page.goto(
      `${origin}/iframe.html?id=dovo-screens-hosted--artifacts-sharing-management&viewMode=story`,
    )
    const management = page.frameLocator('#storybook-root iframe')
    await management
      .getByRole('textbox', { name: 'Recipient sharing ID', exact: true })
      .fill('synthetic-reviewer')
    await management.getByRole('button', { name: 'Invite account', exact: true }).click()
    await management
      .getByRole('status')
      .filter({ hasText: 'Request failed. Try again later' })
      .waitFor()
  }
  assert.deepEqual(externalRequests, [], 'Hosted previews must not contact external services')
  page.off('request', captureRequest)
  page.off('pageerror', captureError)
  return checks
}
