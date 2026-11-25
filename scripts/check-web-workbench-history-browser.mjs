import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serve } from '../apps/web/node_modules/srvx/dist/adapters/node.mjs'
import web from '../apps/web/serve.mjs'
import {
  decode,
  repositorySchema,
  runtimeSnapshotCacheSchema,
  taskSchema,
} from '../packages/protocol/dist/index.js'
import { startRuntime } from '../packages/runtime/dist/index.js'
import { chromium } from './browser/harness.mjs'

const directory = await mkdtemp(join(tmpdir(), 'dovo-web-history-'))
const runtimes = new Set()
const pullUrl = (number) => 'https://github.com/dovo-fixture/project/pull/' + number
const start = async (name, withPulls = false) => {
  const data = join(directory, name)
  await mkdir(data)
  const runtime = await startRuntime({
    databasePath: join(data, 'runtime.sqlite'),
    host: '127.0.0.1',
    port: 0,
    ownerToken: randomBytes(32).toString('base64url'),
  })
  runtimes.add(runtime)
  runtime.services.store.update((workspace) => ({
    ...workspace,
    repositories: withPulls
      ? [
          decode(repositorySchema, {
            id: 'fixture-project',
            name: 'History project',
            path: data,
            branch: 'main',
            gitIdentity: 'github.com/dovo-fixture/project',
            pullIdentity: 'github.com/dovo-fixture/project',
          }),
        ]
      : workspace.repositories,
    tasks: [
      decode(taskSchema, {
        id: 'same-thread-id',
        title: name + ' thread',
        repositoryId: withPulls ? 'fixture-project' : '',
        ...(withPulls
          ? {
              linkedPullRequests: [
                {
                  number: 42,
                  url: pullUrl(42),
                  title: 'Fixture PR 42',
                  repositoryUrl: 'https://github.com/dovo-fixture/project',
                },
              ],
            }
          : {}),
        agentId: '',
        status: 'review',
        createdAt: new Date().toISOString(),
        messages: [],
        files: [],
        draft: '',
        example: false,
      }),
    ],
  }))
  return runtime
}
const server = serve({
  ...web,
  hostname: '127.0.0.1',
  port: 0,
  silent: true,
})
let browser
try {
  browser = await chromium.launch()
  await server.ready()
  const shell = await fetch(server.url)
  assert.equal(shell.status, 200)
  assert.doesNotMatch(shell.headers.get('cache-control') ?? '', /immutable/)
  const html = await shell.text()
  const assets = new Set(
    [...html.matchAll(/(?:src|href)="(\/assets\/[^"?]+\.(?:css|js))"/g)].map((match) => match[1]),
  )
  assert([...assets].some((asset) => asset.endsWith('.css')))
  assert([...assets].some((asset) => asset.endsWith('.js')))
  for (const asset of assets) {
    const result = await fetch(new URL(asset, server.url), { method: 'HEAD' })
    assert.equal(result.status, 200, asset)
    assert.match(result.headers.get('cache-control') ?? '', /max-age=31536000, immutable/)
  }
  const first = await start('First computer')
  const second = await start('Second computer')
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(server.url)
  const mainNavigation = page.getByRole('navigation', { name: 'Main navigation' })
  const pair = async (runtime) => {
    try {
      await page.getByRole('button', { name: 'Connect computer', exact: true }).last().click()
    } catch (error) {
      throw new Error('Pairing entry not visible: ' + (await page.locator('body').innerText()), {
        cause: error,
      })
    }
    const dialog = page
      .getByRole('dialog')
      .filter({
        has: page.getByRole('textbox', { name: 'Runtime address' }),
      })
      .last()
    await dialog
      .getByRole('textbox', { name: 'Runtime address' })
      .fill('http://127.0.0.1:' + runtime.port)
    await dialog
      .getByRole('textbox', { name: 'Pairing code' })
      .fill(runtime.services.pairing.createCode(true).code)
    const persisted = page.waitForResponse(
      (response) => response.url().endsWith('/api/pair/confirm') && response.ok(),
    )
    await dialog.getByRole('button', { name: 'Connect runtime' }).click()
    await persisted
    await dialog.waitFor({ state: 'hidden' })
  }
  await pair(first)
  const runtimeSettings = page.getByRole('dialog', { name: 'Settings' })
  await pair(second)
  await runtimeSettings.getByRole('button', { name: 'Connection map', exact: true }).click()
  const map = runtimeSettings.getByRole('region', { name: 'Connection map' })
  for (const runtime of [first, second])
    await map
      .getByText(`HTTP requests · Saved address · http://127.0.0.1:${runtime.port}`, {
        exact: true,
      })
      .waitFor()
  await runtimeSettings.getByRole('button', { name: 'Connection list', exact: true }).click()
  await runtimeSettings.getByRole('button', { name: 'Close', exact: true }).click()
  const selectThread = async (name) => {
    await page
      .getByRole('button', { name: new RegExp(name + ' thread') })
      .first()
      .press('Enter')
  }
  const measureThreadFrame = async (name) => {
    await page.evaluate((expected) => {
      window.threadFrame = new Promise((resolve) => {
        const onKey = (event) => {
          if (event.key !== 'Enter') return
          document.removeEventListener('keydown', onKey, true)
          const started = performance.now()
          const visibleReply = (frameTime) => {
            const reply = [...document.querySelectorAll('p, [data-message-id]')].find((element) => {
              if (element.textContent !== expected || !element.checkVisibility()) return false
              const rect = element.getBoundingClientRect()
              return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight
            })
            if (reply) requestAnimationFrame(() => resolve(Math.max(0, frameTime - started)))
            else if (frameTime - started > 10000) resolve(null)
            else requestAnimationFrame(visibleReply)
          }
          requestAnimationFrame(visibleReply)
        }
        document.addEventListener('keydown', onKey, true)
      })
    }, `Fixture reply from ${name}`)
    await selectThread(name)
    const ms = await page.evaluate(() => window.threadFrame)
    assert.notEqual(ms, null, `${name} did not render its own reply`)
    return ms
  }
  const thread = async (active, runtime, name) => {
    await active.waitForURL(
      (url) =>
        url.searchParams.get('thread') === 'same-thread-id' &&
        url.searchParams.get('computer') === runtime.services.runtimeId,
    )
    try {
      await active
        .getByRole('button', { name: 'Thread actions', exact: true })
        .filter({ hasText: name + ' thread' })
        .waitFor()
    } catch (error) {
      throw new Error(`${errors.join('\n')}\n${await active.locator('body').innerText()}`, {
        cause: error,
      })
    }
  }
  await selectThread('First computer')
  await thread(page, first, 'First computer')
  const firstUrl = page.url()
  await selectThread('Second computer')
  await thread(page, second, 'Second computer')
  const secondUrl = page.url()
  await page.keyboard.press('Control+k')
  const commands = page.getByRole('combobox', { name: 'Search commands' })
  await commands.waitFor()
  await page.getByRole('option', { name: 'Settle thread', exact: true }).waitFor()
  await page.getByRole('option', { name: 'Archive thread', exact: true }).waitFor()
  await page
    .getByRole('option', { name: /^Snooze thread/ })
    .first()
    .waitFor()
  const pin = page.waitForResponse(
    (response) =>
      response.url() === `http://127.0.0.1:${second.port}/api/workspace` &&
      response.request().method() === 'PATCH' &&
      response.ok(),
  )
  await page.getByRole('option', { name: 'Pin thread', exact: true }).click()
  await pin
  assert.equal(second.services.store.taskSummary('same-thread-id').pinned, true)
  assert.notEqual(first.services.store.taskSummary('same-thread-id').pinned, true)
  await page.keyboard.press('Control+k')
  await page.getByRole('option', { name: 'Unpin thread', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  const composer = page.getByRole('textbox', { name: 'Message thread' })
  await composer.fill('Draft on the second computer')
  await mainNavigation.getByRole('button', { name: 'Terminals', exact: true }).click()
  await page.waitForURL((url) => url.searchParams.get('section') === 'terminals')
  await mainNavigation.getByRole('button', { name: 'Settings', exact: true }).click()
  await runtimeSettings.getByRole('button', { name: 'Thread list & projects', exact: true }).click()
  const snoozeDurations = runtimeSettings.getByRole('textbox', { name: 'Snooze durations' })
  await snoozeDurations.fill('25m, 2h')
  const discard = page.getByRole('dialog', { name: 'Discard unsaved changes?' })
  await page.evaluate(() => history.back())
  await discard.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.waitForURL((url) => url.searchParams.get('section') === 'terminals')
  assert.equal(await snoozeDurations.inputValue(), '25m, 2h')
  await page.evaluate(() => history.back())
  await discard.getByRole('button', { name: 'Discard changes', exact: true }).click()
  await thread(page, second, 'Second computer')
  assert.match(await composer.textContent(), /Draft on the second computer/)
  await page.goBack()
  await thread(page, first, 'First computer')
  await page.goForward()
  await thread(page, second, 'Second computer')
  console.log('Browser Back and Forward restored the correct owner for matching thread IDs.')
  await page.reload()
  await thread(page, second, 'Second computer')
  const other = await context.newPage()
  other.setDefaultTimeout(15000)
  await other.goto(firstUrl)
  try {
    await thread(other, first, 'First computer')
  } catch (error) {
    throw new Error('New-tab thread did not open: ' + (await other.locator('body').innerText()), {
      cause: error,
    })
  }
  await other.close()

  // A cached thread summary restores the title. The composer needs the saved conversation.
  const cachedSnapshot = await page.evaluate(async (runtimeId) => {
    const database = await new Promise((resolve, reject) => {
      const open = indexedDB.open('dovo-read-cache', 1)
      open.onerror = () => reject(open.error)
      open.onsuccess = () => resolve(open.result)
    })
    try {
      const deadline = Date.now() + 15000
      do {
        const cached = await new Promise((resolve, reject) => {
          const transaction = database.transaction('entries')
          const entries = transaction.objectStore('entries').openCursor()
          let value
          entries.onsuccess = () => {
            const cursor = entries.result
            if (!cursor) return
            if (String(cursor.key).endsWith('.snapshot')) {
              const entry = JSON.parse(cursor.value).value
              if (
                entry?.snapshot?.runtimeId === runtimeId &&
                entry.snapshot.detailTaskIds?.includes('same-thread-id')
              )
                value = entry
            }
            cursor.continue()
          }
          transaction.oncomplete = () => resolve(value)
          transaction.onerror = () => reject(transaction.error)
        })
        if (cached) return cached
        await new Promise((resolve) => setTimeout(resolve, 100))
      } while (Date.now() < deadline)
      throw new Error('The second computer conversation was not cached')
    } finally {
      database.close()
    }
  }, second.services.runtimeId)
  decode(runtimeSnapshotCacheSchema, cachedSnapshot)
  let offlineRequests = 0
  await context.route('http://127.0.0.1:' + second.port + '/**', (route) => {
    offlineRequests++
    return route.abort()
  })
  await page.reload()
  try {
    await thread(page, second, 'Second computer')
    assert.match(await composer.textContent(), /Draft on the second computer/)
  } catch (error) {
    throw new Error('Offline thread did not open: ' + (await page.locator('body').innerText()), {
      cause: error,
    })
  }
  assert.ok(offlineRequests > 0)
  assert.deepEqual(errors, [])
  console.log('Web workbench uses same-owner thread URLs for Back, Forward, reload, and a new tab.')
  const pullComputer = await start('PR computer', true)
  await mainNavigation.getByRole('button', { name: 'Settings', exact: true }).click()
  await runtimeSettings.getByRole('button', { name: 'Devices & runtime', exact: true }).click()
  await pair(pullComputer)
  await runtimeSettings.getByRole('button', { name: 'Close', exact: true }).click()
  const pullSummary = (number) => ({
    number,
    title: 'Fixture PR ' + number,
    url: pullUrl(number),
    state: 'open',
    draft: false,
    author: 'Fixture',
    updatedAt: '2026-10-14',
    head: 'history',
    base: 'main',
    labels: [],
    destination: 'history-destination',
  })
  await page.route('http://127.0.0.1:' + pullComputer.port + '/api/scm/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization,content-type',
      'access-control-allow-methods': 'POST,OPTIONS',
    }
    if (request.method() === 'OPTIONS') return route.fulfill({ headers })
    if (path === '/api/scm/source/identity')
      return route.fulfill({
        headers,
        json: { readerIdentity: 'history-reader', destination: 'history-destination' },
      })
    if (path === '/api/scm/pulls/overview')
      return route.fulfill({
        headers,
        json: {
          destination: 'history-destination',
          pulls: [pullSummary(41), pullSummary(42)],
          page: 1,
          hasMore: false,
        },
      })
    if (path === '/api/scm/pulls/detail')
      return route.fulfill({
        headers,
        json: {
          destination: 'history-destination',
          pull: {
            ...pullSummary(request.postDataJSON().number),
            body: 'PR history fixture',
            headSha: 'a'.repeat(40),
            baseSha: 'b'.repeat(40),
            repositoryUrl: 'https://github.com/dovo-fixture/project',
            additions: 1,
            deletions: 1,
            changedFiles: 1,
            mergeable: true,
            reviewers: [],
            assignees: [],
          },
          capabilities: { actions: ['inline-comment'], mergeMethods: [], reviewDecisions: [] },
          files: [
            {
              path: 'history.txt',
              status: 'modified',
              additions: 1,
              deletions: 1,
              patch: '@@ -9,1 +10,1 @@\n-previous line\n+changed line\n',
            },
          ],
          comments: [],
          checks: [],
          warnings: [],
        },
      })
    return route.fallback()
  })
  await mainNavigation.getByRole('button', { name: 'Pull requests', exact: true }).click()
  const selectPull = (number) =>
    page
      .getByRole('button', { name: new RegExp('Fixture PR ' + number) })
      .first()
      .click()
  const selectedPull = (number) => page.getByRole('heading', { name: 'Fixture PR ' + number })
  await selectPull(41)
  await selectedPull(41).waitFor()
  await selectPull(42)
  await selectedPull(42).waitFor()
  await page
    .getByRole('region', { name: 'Linked Studio threads' })
    .getByRole('button', { name: /PR computer thread/ })
    .click()
  await thread(page, pullComputer, 'PR computer')
  await page.goBack()
  await selectedPull(42).waitFor()
  const changes = page.getByRole('tab', { name: /Changes/ })
  await changes.click()
  await page.waitForFunction(() => history.state?.dovoPull?.pullTarget?.tab === 'changes')
  const patchLine = page.locator('diffs-container [data-line="10"]').getByText('changed line')
  await patchLine.waitFor()
  const picker = page.locator('summary').filter({ hasText: /^Comment on line$/ })
  const side = page.getByRole('combobox', { name: 'Diff side' })
  const lineInput = page.getByRole('spinbutton', { name: 'Line in the diff' })
  const lineComment = page.getByRole('textbox', { name: 'Line comment', exact: true })
  const isFocused = (locator) => locator.evaluate((element) => element.matches(':focus'))
  const tabTo = async (target) => {
    for (let index = 0; index < 20; index++) {
      await page.keyboard.press('Tab')
      if (await isFocused(target)) return
    }
    assert.fail('The line comment action was missing from the keyboard tab order')
  }
  await changes.focus()
  assert.equal(await picker.count(), 1)
  await tabTo(picker)
  await page.keyboard.press('Enter')
  await page.keyboard.press('Tab')
  assert.equal(await isFocused(side), true)
  await page.keyboard.press('ArrowDown')
  assert.equal(await side.inputValue(), 'deletions')
  await page.keyboard.press('Tab')
  assert.equal(await isFocused(lineInput), true)
  await page.keyboard.type('10')
  await page.keyboard.press('Enter')
  await page.getByText('Enter a line shown on the selected side of the diff.').waitFor()
  assert.equal(await lineComment.count(), 0)
  await page.keyboard.press('Control+a')
  await page.keyboard.type('9')
  await page.keyboard.press('Enter')
  await page.getByText('history.txt:9–9', { exact: true }).waitFor()
  await page.waitForFunction(
    () => document.activeElement?.getAttribute('aria-label') === 'Line comment',
  )
  const cancelComment = page.locator('diffs-container').getByRole('button', { name: 'Cancel' })
  await tabTo(cancelComment)
  await page.keyboard.press('Enter')
  assert.equal(await isFocused(picker), true)
  await page.keyboard.press('Enter')
  await page.keyboard.press('Tab')
  await page.keyboard.press('ArrowUp')
  assert.equal(await side.inputValue(), 'additions')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Control+a')
  await page.keyboard.type('10')
  await page.keyboard.press('Enter')
  await page.getByText('history.txt:10–10', { exact: true }).waitFor()
  await page.waitForFunction(
    () => document.activeElement?.getAttribute('aria-label') === 'Line comment',
  )
  await tabTo(cancelComment)
  await page.keyboard.press('Enter')
  assert.equal(await isFocused(picker), true)

  // The next history entry remains the linked thread after changing tabs on the PR.
  await page.goForward()
  await thread(page, pullComputer, 'PR computer')
  await page.goBack()
  await selectedPull(42).waitFor()
  assert.equal(await changes.getAttribute('aria-selected'), 'true')
  await page.goBack()
  await selectedPull(41).waitFor()
  await page.evaluate(() => history.forward())
  await selectedPull(42).waitFor()
  assert.equal(await changes.getAttribute('aria-selected'), 'true')
  assert.equal(new URL(page.url()).search, '?section=pulls')

  // Model a PR entry written under a different pairing of the same saved profile.
  await page.evaluate(() => {
    const { dovoPull, ...state } = history.state
    history.replaceState({ ...state, dovoPull: { ...dovoPull, ownerScope: '0'.repeat(64) } }, '')
    history.forward()
  })
  await thread(page, pullComputer, 'PR computer')
  await page.goBack()
  await page.waitForURL((url) => url.searchParams.get('section') === 'pulls')
  await changes.waitFor({ state: 'hidden' })
  await page
    .getByRole('button', { name: /Fixture PR 42/ })
    .first()
    .waitFor()
  console.log('PR Back and Forward restored PR 42 on Changes and PR 41 on Overview.')

  // A fresh browser has no device token. Even an identical thread ID must not open there.
  const unpaired = await browser.newPage()
  await unpaired.goto(secondUrl)
  await unpaired.getByRole('heading', { name: 'Pair computer to open this thread' }).waitFor()
  assert.equal(unpaired.url(), secondUrl)
  await unpaired.close()
  const unknown = await context.newPage()
  const unknownUrl = new URL(firstUrl)
  unknownUrl.searchParams.set('computer', 'unknown-owner')
  await unknown.goto(unknownUrl.href)
  await unknown.getByRole('heading', { name: 'Pair computer to open this thread' }).waitFor()
  assert.equal(unknown.url(), unknownUrl.href)
  await unknown.close()

  // Measure the real production workbench once the route and draft scenarios have finished.
  await context.unroute('http://127.0.0.1:' + second.port + '/**')
  for (const { runtime, name } of [
    { runtime: first, name: 'First computer' },
    { runtime: second, name: 'Second computer' },
  ]) {
    runtime.services.store.updateTaskHistory('same-thread-id', (task) => ({
      ...task,
      messages: [{ id: 'reply', role: 'assistant', text: `Fixture reply from ${name}` }],
    }))
  }
  await page.goto(firstUrl)
  await page.getByText('Fixture reply from First computer', { exact: true }).waitFor()
  const firstSwitch = await measureThreadFrame('Second computer')
  const warmFrames = []
  for (let index = 0; index < 4; index++) {
    warmFrames.push(await measureThreadFrame('First computer'))
    warmFrames.push(await measureThreadFrame('Second computer'))
  }
  const rounded = (value) => Math.round(value * 10) / 10
  console.log('Key press to first animation frame with the correct visible reply', {
    firstSwitchMs: rounded(firstSwitch),
    warmMs: warmFrames.map(rounded),
  })
} finally {
  await browser?.close()
  await Promise.all([server.close(), ...[...runtimes].map((runtime) => runtime.close())])
  await rm(directory, { recursive: true, force: true })
}
