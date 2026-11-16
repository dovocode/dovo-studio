import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from './browser/harness.mjs'
import { startRuntime } from '../packages/runtime/dist/index.js'
import { fixture } from '../packages/runtime/dist/testing/fixture.js'

const host = JSON.parse(await readFile('packages/studio-ui/mcp-apps/host.json', 'utf8'))
const example = JSON.parse(await readFile('examples/a2ui/issue-picker.json', 'utf8'))
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
async function open(id, mobile) {
  let draftFailure
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
    if (message.type !== 'request') return
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
    await ui.getByRole('heading', { name: 'Choose the next work' }).waitFor({ timeout: 10000 })
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
    failNextDraft: (when) => {
      draftFailure = when
    },
  }
}
async function saved(ui) {
  await ui.getByRole('status').filter({ hasText: 'Draft saved' }).waitFor()
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
    const pending = async () => {
      const deadline = Date.now() + 5000
      while (!s.approvals.list().length && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 10))
      assert.equal(s.approvals.list().length, 1)
      return s.approvals.list()[0]
    }
    s.approvals.respond((await pending()).id, false)
    try {
      await ui.getByRole('alert').filter({ hasText: 'declined' }).waitFor({ timeout: 5000 })
    } catch (error) {
      console.error(await page.frames().at(-1).locator('main').innerText())
      throw error
    }
    assert.equal(sent.length, mobile ? 1 : 0)
    await ui.getByRole('button', { name: 'Send selection' }).click()
    s.approvals.respond((await pending()).id, true)
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
  assert.deepEqual(pageErrors, [])
  assert.deepEqual(externalRequests, [])
  console.log(
    'A2UI browser checks passed: desktop/mobile host, theme, form bindings, draft restore, conflicts, approval, and response receipts.',
  )
} finally {
  await browser.close()
  await runtime.close()
  await f.cleanup()
}
