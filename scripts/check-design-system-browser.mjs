import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, extname, resolve, sep } from 'node:path'
import { chromium } from './browser/harness.mjs'
import { checkMobileSettingsAndThreads } from './design-system-mobile-interactions.mjs'
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
  '.png': 'image/png',
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
  assert.ok(
    stories.some(
      (story) => story.id === 'dovo-composers-production-task-composer--full-production-composer',
    ),
    'The catalog must render the production composer',
  )
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  const errors = []
  const externalRequests = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== new URL(origin).origin)
      externalRequests.push(url.origin + url.pathname)
  })
  const accessibilityFailures = []
  page.on('pageerror', (e) => errors.push(e.message))
  let checks = 0
  if (!process.env.DOVO_DESIGN_INTERACTIONS_ONLY)
    for (const mode of ['dark', 'light'])
      for (const width of [390, 1280])
        for (const story of stories) {
          await page.setViewportSize({ width, height: 900 })
          await page.goto(
            `${origin}/iframe.html?id=${story.id}&viewMode=story&globals=theme:${mode}`,
          )
          try {
            await page.locator('#storybook-root').waitFor()
          } catch (cause) {
            throw new Error(
              `${story.id} ${mode} ${width}: ${await page.locator('body').innerText()}`,
              { cause },
            )
          }
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
  await openStory('dovo-settings-desktop-settings--scoped-lifecycle-settings')
  await page
    .getByRole('status')
    .filter({ hasText: 'Changes apply to existing tasks too' })
    .waitFor()
  await page.getByRole('button', { name: 'Edit Project settings', exact: true }).click()
  const inactiveSetting = page.getByRole('combobox', {
    name: 'Auto-settle inactive tasks',
    exact: true,
  })
  await inactiveSetting.click()
  await page.getByRole('option', { name: 'Off', exact: true }).click()
  const saveLifecycle = page.getByRole('button', { name: 'Save lifecycle settings', exact: true })
  assert.ok(await saveLifecycle.isEnabled(), 'Changing a scoped value enables saving')
  await saveLifecycle.click()
  await page.getByRole('status').filter({ hasText: 'Lifecycle settings saved.' }).waitFor()
  assert.equal(await inactiveSetting.innerText(), 'Off')
  await page
    .getByRole('button', {
      name: 'View inheritance for auto-settle inactive tasks',
      exact: true,
    })
    .click()
  await page
    .getByText(
      'Project overrides Computer; Project on computer wins over both. The check marks the effective value for each computer, including later overrides.',
      { exact: true },
    )
    .waitFor()
  await page.keyboard.press('Escape')

  await checkMobileSettingsAndThreads(page, origin)
  await openStory('dovo-mobile-conversation-controls--draft-and-recovery')
  const mobileDraft = page.getByRole('textbox', { name: 'Message', exact: true })
  await mobileDraft.fill('Keep the mobile draft after failure')
  await page.getByRole('button', { name: 'Send preview', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'Simulated send failed' }).waitFor()
  assert.equal(await mobileDraft.inputValue(), 'Keep the mobile draft after failure')
  await page.getByRole('checkbox', { name: 'Simulate failed send', exact: true }).uncheck()
  await page.getByRole('button', { name: 'Send preview', exact: true }).click()
  await page.getByText('Keep the mobile draft after failure', { exact: true }).waitFor()
  await page.waitForFunction(
    () => document.querySelector('textarea[aria-label="Message"]')?.value === '',
  )
  await page.getByRole('button', { name: 'Restore example draft', exact: true }).click()
  await page.waitForFunction(() =>
    document
      .querySelector('textarea[aria-label="Message"]')
      ?.value?.startsWith('Review the navigation changes'),
  )
  await page.getByRole('button', { name: 'Clear draft', exact: true }).click()
  await page.waitForFunction(
    () => document.querySelector('textarea[aria-label="Message"]')?.value === '',
  )
  await openStory('dovo-mobile-conversation-controls--disconnected-draft')
  await page
    .getByRole('textbox', { name: 'Message', exact: true })
    .fill('Saved locally while offline')
  assert.ok(await page.getByRole('button', { name: 'Send preview', exact: true }).isDisabled())
  await openStory('dovo-mobile-conversation-controls--multiple-choice')
  await page.getByRole('checkbox', { name: 'Layout and navigation', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Accessibility', exact: true }).click()
  await page
    .getByRole('textbox', { name: 'Answer: Review scope', exact: true })
    .fill('Also check the settings editor')
  await page
    .getByRole('status')
    .filter({ hasText: 'layout, accessibility, Also check the settings editor' })
    .waitFor()
  await openStory('dovo-mobile-conversation-controls--single-choice')
  await page.getByRole('radio', { name: 'Layout and navigation', exact: true }).click()
  await page
    .getByRole('textbox', { name: 'Answer: Review scope', exact: true })
    .fill('Custom scope only')
  assert.equal(
    await page
      .getByRole('radio', { name: 'Layout and navigation', exact: true })
      .getAttribute('aria-checked'),
    'false',
  )
  await page.getByRole('status').filter({ hasText: 'Local answer: Custom scope only' }).waitFor()

  await openStory('dovo-build-screens--screen-states-and-actions')
  await page.getByRole('button', { name: 'Start a thread', exact: true }).click()
  await page.getByText('Local example ready', { exact: true }).waitFor()
  const screenStates = page.getByRole('group', { name: 'Screen preview state', exact: true })
  await screenStates.getByRole('button', { name: 'error', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'could not be loaded' }).waitFor()
  await page.getByRole('button', { name: 'Retry loading threads', exact: true }).click()
  await page.getByText('Local example ready', { exact: true }).waitFor()
  await screenStates.getByRole('button', { name: 'loading', exact: true }).click()
  assert.ok(await page.getByRole('button', { name: 'New thread', exact: true }).isDisabled())

  await openStory('dovo-threads-cards-and-lists--thread-list-and-cards')
  const selectedThread = page
    .getByRole('button')
    .filter({ hasText: 'Update the component usage guide' })
    .first()
  await selectedThread.click()
  assert.equal(await selectedThread.getAttribute('aria-current'), 'true')
  const firstThread = page
    .getByRole('button')
    .filter({ hasText: 'Refine the dashboard navigation' })
    .first()
  await firstThread.focus()
  await page.keyboard.press('Enter')
  assert.equal(await firstThread.getAttribute('aria-current'), 'true')

  await openStory('dovo-patterns-pull-requests--linked-pull-panel-catalog')
  await page.getByRole('button', { name: 'Close linked pull requests', exact: true }).click()
  await page.getByRole('button', { name: 'Reopen linked pull requests', exact: true }).click()
  await page.getByRole('button', { name: 'Manage linked pull requests', exact: true }).click()
  const pullDialog = page.getByRole('dialog')
  await pullDialog.getByRole('button', { name: 'Unlink PR #42', exact: true }).click()
  await pullDialog
    .getByRole('button', { name: 'Unlink PR #42', exact: true })
    .waitFor({ state: 'hidden' })
  await pullDialog
    .getByRole('textbox', { name: 'Pull request number or URL', exact: true })
    .fill('https://github.com/example/demo/pull/99')
  await pullDialog.getByRole('button', { name: 'Link PR', exact: true }).click()
  await pullDialog.getByRole('alert').filter({ hasText: 'No local preview response' }).waitFor()
  await page.keyboard.press('Escape')

  await openStory('dovo-patterns-pull-requests--failed-checks-and-request-error')
  await page.getByRole('button', { name: 'Make next local request fail', exact: true }).click()
  await page.getByRole('button', { name: 'Fix', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'set to fail' }).waitFor()

  await openStory('dovo-reviews-and-checks--checks-cached-and-stale')
  await page.getByRole('button', { name: 'Refresh checks', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'Local preview refreshed' }).waitFor()
  await openStory('dovo-reviews-and-checks--review-findings')
  const findingTab = page.getByRole('tab', { name: /Findings/ })
  await findingTab.focus()
  await page.keyboard.press('ArrowRight')
  assert.equal(
    await page
      .getByRole('tab', { name: 'Verification', exact: true })
      .getAttribute('aria-selected'),
    'true',
  )
  await page.keyboard.press('Home')
  assert.equal(
    await page
      .getByRole('tab', { name: 'Diff & comments', exact: true })
      .getAttribute('aria-selected'),
    'true',
  )
  await page.keyboard.press('End')
  await page.getByRole('tab', { name: 'Verification', exact: true }).click()
  await page.getByRole('tabpanel', { name: 'Code review verification', exact: true }).waitFor()
  await page.getByRole('tab', { name: /Findings/ }).click()
  await page.getByRole('tabpanel', { name: 'Code review findings', exact: true }).waitFor()

  await openStory('dovo-patterns-forge-pull-requests--pull-rows')
  await page.getByRole('button', { name: 'Actions for PR #81', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Add to thread', exact: true }).click()
  await page.getByText('Added to thread: #81', { exact: true }).waitFor()
  await openStory('dovo-patterns-forge-pull-requests--detail-status-and-stack')
  await page.getByRole('button', { name: 'Stack a PR', exact: true }).click()
  await page.getByText(/Stack PR action previewed locally/).waitFor()
  await page.getByRole('button', { name: 'Ask agent to update stack', exact: true }).click()
  await page.getByText(/Update-stack request previewed locally/).waitFor()
  await openStory('dovo-patterns-forge-pull-requests--pipeline-runs-disconnected')
  assert.ok(await page.getByRole('button', { name: 'Refresh runs', exact: true }).isDisabled())

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

  await openStory('dovo-interactions--question-choices-and-validation')
  await page.getByRole('button', { name: 'Send answers', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Answer Where should the work run?' }).waitFor()
  await page
    .getByRole('group', { name: 'Where should the work run?', exact: true })
    .getByRole('button', { name: /This computer/ })
    .click()
  await page
    .getByRole('group', { name: 'What should the review include?', exact: true })
    .getByRole('button', { name: /Accessibility/ })
    .click()
  await page
    .getByRole('textbox', { name: 'Answer: What should the review include?', exact: true })
    .fill('Focus return after cancellation')
  await page.getByRole('button', { name: 'Send answers', exact: true }).click()
  await page.getByRole('heading', { name: 'Answer received', exact: true }).waitFor()
  await page.getByText('accessibility, Focus return after cancellation', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Ask again', exact: true }).click()
  await page.getByRole('button', { name: 'Decline', exact: true }).click()
  await page.getByRole('heading', { name: 'Question declined', exact: true }).waitFor()

  await openStory('dovo-interactions--question-disconnected')
  assert.ok(await page.getByRole('button', { name: 'Send answers', exact: true }).isDisabled())
  assert.ok(await page.getByRole('button', { name: 'Decline', exact: true }).isDisabled())
  await openStory('dovo-interactions--permission-presets-and-details')
  await page.locator('summary').click()
  await page.getByRole('button', { name: 'Approval policy', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Reset to access mode', exact: true }).click()
  await page.getByRole('button', { name: 'Reset local preview', exact: true }).click()

  await openStory('dovo-patterns-task-conversation--editable-queued-follow-ups')
  await page.getByRole('button', { name: 'Confirmed', exact: true }).click()
  await page.locator('summary').filter({ hasText: '2 queued' }).click()
  await page.getByRole('button', { name: 'Edit queued message 1', exact: true }).click()
  await page
    .getByRole('textbox', { name: 'Edit queued message', exact: true })
    .fill('Edited local follow-up')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByTitle('Edited local follow-up', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Move queued message 2 up', exact: true }).click()
  await page.getByRole('button', { name: 'Pause queue', exact: true }).click()
  await page.getByRole('button', { name: 'Resume queue', exact: true }).click()
  await page.getByRole('button', { name: 'Steer with queued message 1', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'not available in this local preview' }).waitFor()

  await openStory('dovo-composers-production-task-composer--full-production-composer')
  await page.getByRole('button', { name: 'New task', exact: true }).click()
  await page.getByRole('button', { name: 'Choose agent and model', exact: true }).click()
  await page.getByRole('combobox').waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Remove preview.png', exact: true }).click()
  await page
    .getByRole('button', { name: 'Remove preview.png', exact: true })
    .waitFor({ state: 'hidden' })
  const mentionField = page.getByRole('textbox', { name: 'Message task', exact: true })
  await mentionField.fill('@src')
  await page.getByRole('listbox', { name: 'Files and MCP servers', exact: true }).waitFor()
  await page.getByRole('option').filter({ hasText: 'App.tsx' }).click()
  assert.ok((await mentionField.inputValue()).includes('src/App.tsx'))
  await page.getByRole('button', { name: 'Idle task', exact: true }).click()
  const composerField = page.getByRole('textbox', { name: 'Message task', exact: true })
  await composerField.fill('Verify a full production composer')
  await page.getByRole('button', { name: 'Fail next send', exact: true }).click()
  await page.getByRole('button', { name: 'Send to agent', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'set to fail' }).waitFor()
  assert.equal(
    await composerField.inputValue(),
    'Verify a full production composer',
    'Failed sends retain the draft',
  )
  await page.getByRole('button', { name: 'Send to agent', exact: true }).click()
  await page.waitForFunction(
    () => document.querySelector('textarea[aria-label="Message task"]')?.value === '',
  )
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
  assert.ok(
    await page.getByRole('button', { name: 'Save message to task', exact: true }).isDisabled(),
  )
  await page.getByRole('button', { name: 'Reconnect', exact: true }).click()
  await page.getByRole('button', { name: 'Long draft', exact: true }).click()
  assert.ok((await composerField.inputValue()).includes('A detailed local preview draft'))

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
  assert.deepEqual(errors, [], 'Interactive stories must not throw page errors')
  assert.deepEqual(externalRequests, [], 'Stories must not contact runtimes or external services')
  console.log(
    checks
      ? `Dovo design catalog: ${checks} story/theme/viewport checks, axe accessibility, composer focus and submit pass.`
      : 'Dovo design catalog: interaction checks passed (matrix and axe audit not run).',
  )
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
