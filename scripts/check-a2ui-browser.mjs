import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { chromium } from './browser/harness.mjs'
import { startRuntime } from '../packages/runtime/dist/index.js'
import { fixture } from '../packages/runtime/dist/testing/fixture.js'

const host = JSON.parse(await readFile('packages/studio-ui/mcp-apps/host.json', 'utf8'))
const example = JSON.parse(await readFile('examples/a2ui/issue-picker.json', 'utf8'))
const workbench = JSON.parse(await readFile('examples/a2ui/change-review-workbench.json', 'utf8'))
await mkdir('work/a2ui-workbench', { recursive: true })
const f = await fixture()
const owner = 'a2ui-browser-test-owner-token-at-least-32-characters'
const runtime = await startRuntime({ databasePath: ':memory:', port: 0, ownerToken: owner })
const browser = await chromium.launch({ headless: true })
const s = runtime.services
const sent = []
s.mcpApps.setSendMessage(async (...args) => {
  sent.push(args)
  return {}
})
s.store.update(() => f.workspace)
const task = s.tasks.create({
  title: 'A2UI browser check',
  repositoryId: 'repo',
  agentId: 'agent',
  objective: 'Select issues',
})
s.store.updateTask(task.id, (task) => ({ ...task, activeRunId: 'a2ui-browser-run' }))
const pageErrors = []
const externalRequests = []
async function open(id, mobile, heading = 'Choose the next work') {
  let draftFailure
  const operations = []
  const page = await browser.newPage({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1100, height: 850 },
  })
  page.on('pageerror', (error) => {
    pageErrors.push(error.message)
    console.error(error.message)
  })
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(message.text().slice(0, 1500))
  })
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) externalRequests.push(request.url())
  })
  await page.exposeFunction('a2uiHostMessage', async (message) => {
    if (
      message.type === 'height' &&
      typeof message.height === 'number' &&
      Number.isFinite(message.height)
    ) {
      // The real clients size the inline host from this signal. Keep screenshots faithful to that boundary.
      await page.evaluate((height) => {
        document.getElementById('root').style.height = `${Math.max(160, Math.min(2000, height))}px`
      }, message.height)
      return
    }
    if (message.type !== 'request') return
    operations.push(message.method)
    let reply
    try {
      if (message.method === 'ui/update-model-context' && draftFailure === 'before') {
        draftFailure = undefined
        throw new Error('Computer is offline')
      }
      const response = await fetch(`http://127.0.0.1:${runtime.port}/api/mcp-apps/rpc`, {
        method: 'POST',
        headers: { authorization: `Bearer ${owner}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          taskId: task.id,
          id,
          requestId: message.requestId,
          method: message.method,
          params: message.params,
        }),
      })
      const body = await response.json()
      reply = response.ok
        ? { result: body.result }
        : {
            error:
              typeof body.error === 'string' ? body.error : (body.message ?? JSON.stringify(body)),
          }
      if (message.method === 'ui/update-model-context' && draftFailure === 'after') {
        draftFailure = undefined
        reply = { error: 'Draft acknowledgement was lost' }
      }
    } catch (error) {
      reply = { error: String(error) }
    }
    if (!page.isClosed())
      await page.evaluate((reply) => window.dovoMcpReply(reply), {
        nonce: message.nonce,
        requestId: message.requestId,
        ...reply,
      })
  })
  await page.setContent(
    host.replace(
      '<script>',
      '<script>window.ReactNativeWebView={postMessage:text=>{void window.a2uiHostMessage(JSON.parse(text))}};',
    ),
  )
  const app = s.mcpApps.read(task.id, id)
  await page.evaluate(
    ({ app, mobile }) => {
      if (mobile) window.dovoMcpLoad(app, 'a2ui-test', 'dark')
      else window.postMessage({ type: 'load', app, nonce: 'a2ui-test', theme: 'light' }, '*')
    },
    { app, mobile },
  )
  const ui = page.frameLocator('iframe').frameLocator('iframe')
  try {
    await ui.getByRole('heading', { name: heading }).waitFor({ timeout: 10000 })
  } catch (error) {
    for (const frame of page.frames())
      console.error(
        (
          await frame
            .locator('body')
            .innerHTML()
            .catch(() => 'Frame unavailable')
        ).slice(0, 4000),
      )
    throw error
  }
  return {
    page,
    ui,
    operations,
    failNextDraft: (when) => {
      draftFailure = when
    },
  }
}
async function saved(ui) {
  await ui.getByRole('status').filter({ hasText: 'Draft saved' }).waitFor()
}
async function pendingApproval() {
  const deadline = Date.now() + 5000
  while (!s.approvals.list().length && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(s.approvals.list().length, 1)
  return s.approvals.list()[0]
}
try {
  for (const mobile of [false, true]) {
    const published = s.mcpApps.a2uiCommand(task.id, 'a2ui-browser-run', {
      ...example,
      key: `issues-${mobile}`,
    })
    let { page, ui } = await open(published.id, mobile)
    await ui.getByLabel('Fix reconnect behavior').check()
    await saved(ui)
    const draft = mobile ? 'Mobile input' : '<script>window.forged = true</script> Keep this draft.'
    await ui.getByLabel('Instructions').fill(draft)
    await saved(ui)
    await ui.getByLabel('Include tests').uncheck()
    await saved(ui)
    await page.close()
    ;({ page, ui } = await open(published.id, mobile))
    assert.equal(await ui.getByLabel('Instructions').inputValue(), draft)
    assert.equal(await ui.getByLabel('Include tests').isChecked(), false)
    assert.equal(await ui.getByLabel('Fix reconnect behavior').isChecked(), true)
    assert.equal(
      await ui
        .locator('script')
        .evaluateAll((nodes) => nodes.some((node) => node.textContent === 'window.forged = true')),
      false,
    )
    const guest = page.frames().at(-1)
    assert.equal(
      await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    )
    assert.equal(
      await guest.evaluate(() => document.documentElement.dataset.theme),
      mobile ? 'dark' : 'light',
    )

    if (!mobile) {
      const second = await open(published.id, mobile)
      second.failNextDraft('before')
      await second.ui.getByLabel('Instructions').fill('Recover this local draft')
      await second.ui.getByRole('alert').filter({ hasText: 'offline' }).waitFor()
      assert.equal(
        await second.ui.getByLabel('Instructions').inputValue(),
        'Recover this local draft',
      )
      await second.ui.getByRole('button', { name: 'Retry saving draft' }).click()
      await saved(second.ui)
      second.failNextDraft('after')
      await second.ui.getByLabel('Instructions').fill('Recover the lost acknowledgement')
      await second.ui.getByRole('alert').filter({ hasText: 'acknowledgement was lost' }).waitFor()
      await second.ui.getByRole('button', { name: 'Retry saving draft' }).click()
      await saved(second.ui)
      await second.ui.getByLabel('Instructions').fill('Input from another device')
      await saved(second.ui)
      await ui.getByLabel('Instructions').fill('Preserve my local conflicting input')
      await ui.getByRole('alert').filter({ hasText: 'changed' }).waitFor()
      assert.equal(
        await ui.getByLabel('Instructions').inputValue(),
        'Preserve my local conflicting input',
      )
      await ui.getByRole('button', { name: 'Load current card and replace this input' }).click()
      await ui.getByRole('button', { name: 'Keep input' }).click()
      assert.equal(
        await ui.getByLabel('Instructions').inputValue(),
        'Preserve my local conflicting input',
      )
      await ui.getByRole('button', { name: 'Load current card and replace this input' }).click()
      await ui.getByRole('button', { name: 'Replace input', exact: true }).click()
      await ui.getByLabel('Instructions').waitFor()
      await guest.waitForFunction(
        () => document.querySelector('textarea')?.value === 'Input from another device',
      )
      await second.page.close()
    }

    await ui.getByRole('button', { name: 'Send selection' }).click()
    await page.waitForFunction(() => document.querySelector('iframe'))
    // The real runtime creates a human approval. This test fixture explicitly declines it.
    s.approvals.respond((await pendingApproval()).id, false)
    try {
      await ui.getByRole('alert').filter({ hasText: 'declined' }).waitFor({ timeout: 5000 })
    } catch (error) {
      console.error(await page.frames().at(-1).locator('main').innerText())
      throw error
    }
    assert.equal(sent.length, mobile ? 1 : 0)
    await ui.getByRole('button', { name: 'Send selection' }).click()
    s.approvals.respond((await pendingApproval()).id, true)
    await ui.getByRole('status').filter({ hasText: 'Response sent' }).waitFor()
    assert.equal(sent.length, mobile ? 2 : 1)
    assert.match(sent.at(-1)[2], /selectIssues/)
    assert.equal(await ui.getByRole('button', { name: 'Send selection' }).isDisabled(), true)
    await page.close()
    ;({ page, ui } = await open(published.id, mobile))
    await ui.getByRole('status').filter({ hasText: 'Response sent' }).waitFor()
    assert.equal(await ui.getByRole('button', { name: 'Send selection' }).isDisabled(), true)
    await page.close()
  }
  for (const mobile of [false, true]) {
    const key = `workbench-${mobile}`
    const published = s.mcpApps.a2uiCommand(task.id, 'a2ui-browser-run', { ...workbench, key })
    let view = await open(published.id, mobile, 'Change review plan')
    let { page, ui } = view
    await ui.getByRole('button', { name: 'Send review plan', exact: true }).click()
    await ui.getByRole('alert').filter({ hasText: 'Changed files' }).waitFor()
    assert.equal(s.approvals.list().length, 0, 'Incomplete inputs do not request approval')
    const writesBeforeExploring = view.operations.filter(
      (method) => method === 'ui/update-model-context' || method === 'tools/call',
    ).length
    await ui.getByText('Proposed verification commands', { exact: true }).click()
    await ui.locator('pre').waitFor()
    await ui.getByRole('tab', { name: 'Changes', exact: true }).click()
    await ui.getByRole('searchbox', { name: 'Filter Changed files' }).fill('protocol')
    assert.equal(await ui.getByRole('row').count(), 2)
    await ui.getByRole('button', { name: 'Sort by Lines' }).click()
    assert.equal(
      view.operations.filter(
        (method) => method === 'ui/update-model-context' || method === 'tools/call',
      ).length,
      writesBeforeExploring,
      'Browsing does not invoke tools or save drafts',
    )
    await ui
      .getByRole('checkbox', { name: 'Select packages/protocol/review.ts', exact: true })
      .check()
    await saved(ui)
    await ui.getByRole('searchbox', { name: 'Filter Changed files' }).fill('')
    assert.match(await ui.getByRole('row').nth(1).innerText(), /protocol/)
    await ui
      .getByRole('checkbox', { name: 'Select packages/runtime/reviews.ts', exact: true })
      .check()
    await saved(ui)
    await ui.getByRole('searchbox', { name: 'Filter Changed files' }).fill('no-match')
    await ui.getByText('No rows match this filter.').waitFor()
    await ui.getByText('2 selected · 0 of 3 rows').waitFor()
    await ui.getByRole('searchbox', { name: 'Filter Changed files' }).fill('')
    assert.equal(
      await ui
        .getByRole('checkbox', { name: 'Select packages/runtime/reviews.ts', exact: true })
        .isChecked(),
      true,
    )
    await ui.getByRole('tab', { name: 'Changes', exact: true }).focus()
    await ui.getByRole('tab', { name: 'Changes', exact: true }).press('ArrowRight')
    assert.equal(
      await ui.getByRole('tab', { name: 'Configure' }).getAttribute('aria-selected'),
      'true',
    )
    await ui.getByLabel('Parallel checks', { exact: false }).fill('10')
    await ui.getByRole('status').filter({ hasText: 'allowed range' }).waitFor()
    await ui.getByRole('button', { name: 'Send review plan' }).click()
    await ui.getByRole('alert').filter({ hasText: 'allowed range' }).waitFor()
    assert.equal(s.approvals.list().length, 0)
    await ui.getByLabel('Parallel checks', { exact: false }).fill('')
    await ui.getByRole('button', { name: 'Send review plan' }).click()
    await ui.getByRole('alert').filter({ hasText: 'Parallel checks' }).waitFor()
    await ui.getByLabel('Parallel checks', { exact: false }).fill('4')
    await saved(ui)
    await ui.getByLabel('Include lint', { exact: true }).uncheck()
    await saved(ui)
    await ui.getByLabel('Review instructions').fill('Inspect the connection boundary')
    await saved(ui)
    await page.close()
    view = await open(published.id, mobile, 'Change review plan')
    ;({ page, ui } = view)
    await ui.getByRole('tab', { name: 'Configure' }).click()
    assert.equal(await ui.getByLabel('Parallel checks', { exact: false }).inputValue(), '4')
    assert.equal(await ui.getByLabel('Include lint', { exact: true }).isChecked(), false)
    assert.equal(
      await ui.getByLabel('Review instructions').inputValue(),
      'Inspect the connection boundary',
    )
    const update = (revision, status) =>
      s.mcpApps.a2uiCommand(task.id, 'a2ui-browser-run', {
        action: 'publish',
        key,
        title: workbench.title,
        expectedRevision: revision,
        messages: [
          {
            version: '1.0',
            updateDataModel: { surfaceId: 'review', path: '/status', value: status },
          },
        ],
      })
    update(1, 'Agent updated the summary')
    await page.evaluate(() => window.dovoMcpNotify())
    await ui.getByText('Agent updated the summary', { exact: true }).waitFor()
    await ui.getByRole('tab', { name: 'Configure' }).click()
    assert.equal(
      await ui.getByLabel('Review instructions').inputValue(),
      'Inspect the connection boundary',
    )
    view.failNextDraft('before')
    await ui.getByLabel('Review instructions').fill('Keep my unsaved local input')
    await ui.getByRole('alert').filter({ hasText: 'offline' }).waitFor()
    update(2, 'A newer agent update is available')
    await page.evaluate(() => window.dovoMcpNotify())
    await ui.getByRole('alert').filter({ hasText: 'local input is still shown' }).waitFor()
    assert.equal(
      await ui.getByLabel('Review instructions').inputValue(),
      'Keep my unsaved local input',
    )
    await ui.getByRole('button', { name: 'Load current card and replace this input' }).click()
    await ui.getByRole('button', { name: 'Keep input' }).click()
    assert.equal(
      await ui.getByLabel('Review instructions').inputValue(),
      'Keep my unsaved local input',
    )
    await ui.getByRole('button', { name: 'Load current card and replace this input' }).click()
    await ui.getByRole('button', { name: 'Replace input', exact: true }).click()
    await ui.getByText('A newer agent update is available', { exact: true }).waitFor()
    await ui.getByRole('tab', { name: 'Changes', exact: true }).click()
    assert.equal(
      await ui
        .getByRole('checkbox', { name: 'Select packages/runtime/reviews.ts', exact: true })
        .isChecked(),
      true,
    )
    const guest = page.frames().at(-1)
    assert.equal(
      await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
      'Workbench fits the host width',
    )
    await ui
      .locator('main')
      .screenshot({ path: `work/a2ui-workbench/${mobile ? 'mobile' : 'desktop'}.png` })
    const previousSent = sent.length
    await ui.getByRole('button', { name: 'Send review plan' }).click()
    s.approvals.respond((await pendingApproval()).id, true)
    await ui.getByRole('status').filter({ hasText: 'Response sent' }).waitFor()
    assert.equal(sent.length, previousSent + 1)
    assert.match(sent.at(-1)[2], /"parallel":4/)
    assert.match(sent.at(-1)[2], /"files":\["protocol","runtime"\]/)
    await ui.getByRole('tab', { name: 'Changes', exact: true }).click()
    assert.equal(
      await ui
        .getByRole('checkbox', { name: 'Select packages/runtime/reviews.ts', exact: true })
        .isDisabled(),
      true,
    )
    await ui.getByRole('searchbox', { name: 'Filter Changed files' }).fill('protocol')
    assert.equal(await ui.getByRole('row').count(), 2, 'Submitted workspaces remain browsable')
    await ui.getByRole('button', { name: 'Sort by Lines' }).click()
    await ui.getByRole('tab', { name: 'Overview' }).click()
    await ui.getByText('Proposed verification commands', { exact: true }).click()
    await ui.locator('pre').waitFor()
    assert.equal(
      sent.length,
      previousSent + 1,
      'Exploration after submission sends no further message',
    )
    await page.close()
  }
  assert.deepEqual(pageErrors, [])
  assert.deepEqual(externalRequests, [])
  console.log(
    'A2UI browser checks passed: desktop/mobile host, workbench tables, numeric validation, keyboard tabs, local exploration, draft restore, live revisions, conflicts, approval and response receipts.',
  )
} finally {
  await browser.close()
  await runtime.close()
  await f.cleanup()
}
