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
  const requests = [],
    errors = []
  page.on('request', (request) => requests.push({ url: request.url(), data: request.postData() }))
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(url)
  await page.getByRole('heading', { name: 'Encrypted thread title' }).waitFor()
  await page.getByText('the cause', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.compromised), undefined)
  assert.equal(await page.getByText('Unsent private draft', { exact: true }).count(), 0)
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
  let restored = null
  const otherDevice = new AccountClient(
    {
      read: async () => login.token,
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
  await otherDevice.sharing.restoreKey(recovery, origin)
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
