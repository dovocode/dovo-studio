import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { chromium } from './browser/harness.mjs'
import { AccountStore } from '../apps/connect-server/dist/store.js'
import { createConnectServer } from '../apps/connect-server/dist/server.js'

const store = new AccountStore(':memory:')
let app, connectOrigin
const ingress = createServer((req, res) => app.emit('request', req, res))
const identity = createServer((req, res) => {
  const url = new URL(req.url, 'http://identity.test')
  res.writeHead(302, {
    Location: `${connectOrigin}/auth/callback?state=${url.searchParams.get('state')}&code=browser-code`,
  })
  res.end()
})
const listen = async (server) => {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return `http://127.0.0.1:${server.address().port}`
}
const close = (server) =>
  new Promise((resolve) => {
    server.close(resolve)
    server.closeAllConnections()
  })
let browser
try {
  connectOrigin = await listen(ingress)
  const identityOrigin = await listen(identity)
  app = createConnectServer({
    store,
    origin: connectOrigin,
    authorizationOrigin: identityOrigin,
    authorize: async (login) => {
      login.state = 'browser-state'
      return `${identityOrigin}/authorize?state=browser-state`
    },
    exchange: async (login, code) => {
      assert.equal(login.state, 'browser-state')
      assert.equal(code, 'browser-code')
      return { id: 'browser-user', name: 'Browser user' }
    },
  })
  browser = await chromium.launch()
  const page = await browser.newPage()
  const violations = []
  await page.addInitScript(() => {
    window.addEventListener('securitypolicyviolation', (event) =>
      console.error(`CSP violation: ${event.violatedDirective}`),
    )
  })
  page.on('console', (message) => {
    if (message.text().includes('CSP violation:')) violations.push(message.text())
  })
  const { login, token } = store.createLogin()
  await page.goto(`${connectOrigin}/auth/start?id=${login.id}`)
  await page.getByRole('button', { name: 'Continue to sign in' }).click()
  try {
    await page
      .getByRole('heading', { name: 'You are signed in', exact: true })
      .waitFor({ timeout: 5000 })
  } catch (error) {
    console.error({ url: page.url(), body: await page.locator('body').innerText(), violations })
    throw error
  }
  assert.equal(store.directory(token)?.user.id, 'browser-user')
  assert.deepEqual(violations, [])
  assert.equal(new URL(page.url()).origin, connectOrigin)
  console.log('Connect browser sign-in: cross-origin provider redirect, callback and CSP pass.')
} finally {
  await browser?.close()
  await Promise.all([close(ingress), close(identity)])
  app?.closeAllConnections()
  store.db.close()
}
