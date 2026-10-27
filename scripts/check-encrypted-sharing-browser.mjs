import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { chromium } from './browser/harness.mjs'
import { AccountClient } from '../packages/protocol/dist/auth/account-client.js'
import {
  decryptSharing,
  sharingReaderKeysSchema,
  decryptSharedContent,
  decode,
  taskSchema,
} from '../packages/protocol/dist/index.js'
import { AccountStore } from '../apps/connect-server/dist/store.js'
import { createConnectServer } from '../apps/connect-server/dist/server.js'
import { ArtifactStore } from '../apps/artifact-server/dist/store.js'
import { createArtifactServer } from '../apps/artifact-server/dist/server.js'
import { startRuntime } from '../packages/runtime/dist/index.js'

const servers = [],
  stores = []
let browser, runtime
const listen = async (server) => {
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return `http://127.0.0.1:${server.address().port}`
}
try {
  const accounts = new AccountStore(':memory:'),
    store = new ArtifactStore(':memory:')
  stores.push(accounts.db, store.db)
  const serviceKey = randomBytes(32).toString('base64url')
  let broker, host
  const connectOrigin = await listen(createServer((req, res) => broker.emit('request', req, res)))
  const origin = await listen(createServer((req, res) => host.emit('request', req, res)))
  host = createArtifactServer({
    store,
    origin,
    connectOrigin,
    serviceKey,
    brokerNamespace: 'sharing',
  }).server
  broker = createConnectServer({
    store: accounts,
    origin: connectOrigin,
    sharing: { origin, key: serviceKey },
    authorizationOrigin: connectOrigin,
    authorize: async () => connectOrigin,
    exchange: async () => ({ id: 'recipient', name: 'Recipient' }),
  })
  const landing = await fetch(origin)
  assert.equal(landing.status, 200)
  const landingHtml = await landing.text()
  assert.match(landingHtml, /<title>Dovo Share<\/title>/)
  assert.match(landingHtml, /src="\/sharing-viewer.js"/)
  const login = accounts.createLogin()
  accounts.approve(login.login, { id: 'owner', name: 'Owner' })
  let recovery = null
  const client = new AccountClient(
    {
      read: async () => login.token,
      write: async () => {},
      readSharingKey: async () => recovery,
      writeSharingKey: async (key) => {
        recovery = key
      },
    },
    async () => {},
    connectOrigin,
  )
  await client.load()
  assert.equal(await client.sharingService(), origin)
  await client.sharing.recoveryKey(true)
  const ownerToken = randomBytes(32).toString('base64url')
  runtime = await startRuntime({ databasePath: ':memory:', ownerToken, port: 0 })
  const taskId = randomUUID()
  runtime.services.store.update((workspace) => ({
    ...workspace,
    tasks: [
      ...workspace.tasks,
      decode(taskSchema, {
        id: taskId,
        repositoryId: '',
        agentId: '',
        title: 'Encrypted thread title',
        status: 'done',
        createdAt: new Date().toISOString(),
        files: [],
        draft: 'Unsent private draft',
        example: false,
        messages: [
          { id: randomUUID(), role: 'user', text: 'Investigate the private issue' },
          {
            id: randomUUID(),
            role: 'assistant',
            text: 'Found **the cause**.\n\n<script>window.compromised=true</script>',
          },
          ...Array.from({ length: 20 }, (_, index) => [
            {
              id: randomUUID(),
              role: 'user',
              text: `Question ${index + 1}: inspect the shared reader`,
            },
            {
              id: randomUUID(),
              role: 'assistant',
              text: `## Reply ${index + 1}\n\nA response with **formatting**, \`inline code\` and a [safe link](https://dovo.studio).\n\n- First detail\n- Second detail\n\n> A useful observation\n\n\`\`\`ts\nconst message = ${index + 1}\n\`\`\``,
            },
          ]).flat(),
        ],
      }),
    ],
  }))
  const source = 'computer:' + taskId
  let shared = await client.sharing.publish(
    origin,
    source,
    runtime.services.sharedThreads.preview(taskId),
  )
  shared = await client.sharing.invite(origin, shared, undefined, 3600)
  const linkId = shared.record.grants[0].id
  const url = client.sharing.link(origin, shared, linkId)
  const second = await client.sharing.invite(origin, shared, undefined, 3600)
  const otherId = second.record.grants[1].id
  const otherUrl = client.sharing.link(origin, second, otherId)
  const permission = await client.sharing.setPaused(origin, second, false)
  shared = permission.share
  await runtime.services.sharedThreads.enable(
    {
      taskId,
      id: shared.record.id,
      origin,
      writerSecret: permission.writer,
      contentKey: shared.vault.contentKey,
      signingSeed: shared.vault.signingSeed,
      generation: shared.record.packet.generation,
    },
    'owner',
  )
  browser = await chromium.launch()
  const context = await browser.newContext(),
    page = await context.newPage()
  page.setDefaultTimeout(15000)
  const requests = [],
    errors = []
  page.on('request', (request) => requests.push({ url: request.url(), data: request.postData() }))
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(url)
  await page.getByRole('heading', { name: 'Encrypted thread title' }).waitFor()
  await page.getByText('the cause', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.compromised), undefined)
  assert.equal(await page.getByText('Unsent private draft', { exact: true }).count(), 0)
  const log = page.getByRole('log', { name: 'Shared thread messages' })
  const scrollState = () =>
    log.evaluate((root) => {
      const scroll = [...root.querySelectorAll('div')].find(
        (element) => getComputedStyle(element).overflowY === 'auto',
      )
      if (!scroll) throw new Error('Conversation scroll container missing')
      return {
        top: scroll.scrollTop,
        remaining: scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop,
      }
    })
  const waitForLatest = () =>
    page.waitForFunction(() => {
      const root = document.querySelector('[role="log"]')
      const scroll =
        root &&
        [...root.querySelectorAll('div')].find(
          (element) => getComputedStyle(element).overflowY === 'auto',
        )
      return (
        scroll &&
        scroll.scrollHeight > scroll.clientHeight &&
        scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop < 4
      )
    })
  await waitForLatest()
  assert.equal(await page.getByRole('button', { name: 'Scroll to latest message' }).count(), 0)
  const appearance = await log.evaluate((root) => {
    const user = root.querySelector('.is-user'),
      assistant = root.querySelector('.is-assistant')
    const bubble = user.firstElementChild.firstElementChild
    return {
      userMax: getComputedStyle(user).maxWidth,
      userRadius: getComputedStyle(bubble).borderRadius,
      assistantBorder: getComputedStyle(assistant).borderTopWidth,
      width: root.getBoundingClientRect().width,
    }
  })
  assert.equal(appearance.userMax, '90%')
  assert.equal(appearance.userRadius, '16px')
  assert.equal(appearance.assistantBorder, '0px')
  // Real wheel input releases the same following lock used by Studio.
  await log.hover()
  await page.mouse.wheel(0, -1800)
  await page.getByRole('button', { name: 'Scroll to latest message' }).waitFor()
  const reading = await scrollState()
  assert.ok(reading.remaining > 500)
  await page.getByRole('button', { name: 'Scroll to latest message' }).click()
  await waitForLatest()
  await page.getByLabel('Your name (optional)').fill('A reader')
  await page
    .getByLabel('Suggested prompt', { exact: true })
    .fill('Could we inspect the related callers?')
  await page.getByRole('button', { name: 'Send suggestion', exact: true }).click()
  await page.getByText('Suggestion sent to the owner.').waitFor()
  const suggestions = await client.sharing.suggestions(origin, shared)
  assert.equal(suggestions.length, 1)
  assert.equal(suggestions[0].value.text, 'Could we inspect the related callers?')
  const stored =
    JSON.stringify(store.db.prepare('SELECT * FROM encrypted_shares').all()) +
    JSON.stringify(store.db.prepare('SELECT * FROM encrypted_suggestions').all())
  for (const secret of [
    'Encrypted thread title',
    'Investigate the private issue',
    'Could we inspect the related callers?',
    recovery,
    shared.vault.contentKey,
  ])
    assert.ok(!stored.includes(secret), 'hosting must not store plaintext or keys')
  await page.getByLabel('Suggested prompt', { exact: true }).fill('Keep my unfinished suggestion')
  await log.hover()
  await page.mouse.wheel(0, -1600)
  await page.getByRole('button', { name: 'Scroll to latest message' }).waitFor()
  const beforeUpdate = await scrollState()
  runtime.services.store.update((workspace) => ({
    ...workspace,
    tasks: workspace.tasks.map((task) =>
      task.id === taskId
        ? {
            ...runtime.services.store.task(taskId),
            messages: [
              ...runtime.services.store.task(taskId).messages,
              { id: randomUUID(), role: 'assistant', text: 'A new automatic message' },
            ],
          }
        : task,
    ),
  }))
  await runtime.services.sharedThreads.tick()
  await page.getByText('A new automatic message', { exact: true }).waitFor({ timeout: 20000 })
  assert.ok(
    Math.abs((await scrollState()).top - beforeUpdate.top) < 4,
    'incoming replies must preserve the reading position',
  )
  assert.equal(
    await page.getByLabel('Suggested prompt', { exact: true }).inputValue(),
    'Keep my unfinished suggestion',
  )
  await page.getByRole('button', { name: 'Scroll to latest message' }).click()
  await waitForLatest()
  await page.screenshot({ path: '/tmp/dovo-share-thread-desktop.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForFunction(() => {
    const composer = document.querySelector('.sharing-suggestion').getBoundingClientRect()
    return composer.bottom <= innerHeight + 1 && composer.top > 0
  })
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    'mobile reader must fit the viewport',
  )
  await page.waitForFunction(() => {
    const scroll = [...document.querySelector('[role="log"]').querySelectorAll('div')].find(
      (element) => getComputedStyle(element).overflowY === 'auto',
    )
    return scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop < 4
  })
  await log.hover()
  await page.mouse.wheel(0, -900)
  await page.getByRole('button', { name: 'Scroll to latest message' }).waitFor()
  await page.screenshot({ path: '/tmp/dovo-share-thread-mobile.png' })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('button', { name: 'Scroll to latest message' }).click()
  await waitForLatest()
  const secondPage = await context.newPage()
  await secondPage.goto(otherUrl)
  await secondPage.getByRole('heading', { name: 'Encrypted thread title' }).waitFor()
  const oldKey = shared.vault.contentKey
  shared = await client.sharing.revoke(origin, shared, linkId)
  assert.notEqual(shared.vault.contentKey, oldKey)
  await page.getByText('This link has expired', { exact: false }).waitFor({ timeout: 15000 })
  assert.equal(await page.getByRole('heading', { name: 'Encrypted thread title' }).count(), 0)
  await secondPage.getByText('Updates paused', { exact: false }).waitFor({ timeout: 15000 })
  const fragment = new URL(url).hash.slice(1),
    params = new URLSearchParams(fragment)
  const read = await fetch(origin + '/v2/shares/' + shared.record.id + '/read?access=' + otherId, {
    headers: {
      Authorization: 'DovoShare ' + shared.vault.grants.find((grant) => grant.id === otherId).token,
    },
  })
  const next = await read.json()
  assert.throws(() =>
    decryptSharedContent(shared.record.id, next.packet, {
      ...decode(
        sharingReaderKeysSchema,
        decryptSharing(next.box, shared.vault.grants.find((grant) => grant.id === otherId).key),
      ),
      contentKey: oldKey,
    }),
  )
  for (const request of requests) {
    assert.ok(!request.url.includes(params.get('key')))
    assert.ok(!request.url.includes(params.get('share')))
    assert.ok(!request.data?.includes('Could we inspect the related callers?'))
    assert.ok(!request.data?.includes(recovery))
  }
  const receiverLogin = accounts.createLogin()
  accounts.approve(receiverLogin.login, { id: 'owner', name: 'Owner' })
  let restored = null
  const otherDevice = new AccountClient(
    {
      read: async () => receiverLogin.token,
      write: async () => {},
      readSharingKey: async () => restored,
      writeSharingKey: async (key) => {
        restored = key
      },
    },
    async () => {},
    connectOrigin,
  )
  await otherDevice.load()
  await assert.rejects(() => otherDevice.sharing.restoreKey('0'.repeat(64), origin))
  assert.equal(restored, null)
  // An empty device requests access; an online owner answers without any human-entered key.
  assert.equal(await otherDevice.sharing.syncKey(), false)
  await assert.rejects(() => otherDevice.sharing.recoveryKey(true), /syncing/)
  await client.sharing.syncKey()
  assert.equal(await otherDevice.sharing.syncKey(), true)
  assert.equal(await otherDevice.sharing.recoveryKey(), recovery)
  const syncRows = JSON.stringify(accounts.db.prepare('SELECT * FROM sharing_key_sync').all())
  assert.ok(!syncRows.includes(recovery), 'Connect must not store the raw sharing key')
  assert.ok(
    !JSON.stringify(accounts.db.prepare('SELECT * FROM sharing_key_identity').all()).includes(
      recovery,
    ),
  )
  assert.equal(
    (await otherDevice.sharing.refresh(origin, shared.record.id)).content.title,
    'Encrypted thread title',
  )
  await client.sharing.dismiss(origin, shared.record.id, suggestions[0].id)
  assert.equal((await client.sharing.suggestions(origin, shared)).length, 0)
  await client.sharing.remove(origin, shared.record.id)
  assert.equal((await client.sharing.list(origin)).length, 0)
  assert.deepEqual(errors, [])
  console.log(
    'Encrypted sharing: reader, markdown isolation, encrypted suggestions, runtime updates, rotation, revocation, recovery and deletion passed',
  )
} finally {
  const openPage = browser?.contexts()[0]?.pages()[0]
  if (openPage) await openPage.screenshot({ path: '/tmp/dovo-share-thread-last.png' })
  await browser?.close()
  await runtime?.close()
  await Promise.all(
    servers.map(
      (server) =>
        new Promise((resolve) => {
          server.close(resolve)
          server.closeAllConnections()
        }),
    ),
  )
  for (const db of stores) db.close()
}
