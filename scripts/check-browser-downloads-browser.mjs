import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { WebSocket } from 'ws'
import { chromium } from './browser/harness.mjs'
import { remoteBrowserHtml } from '../packages/protocol/dist/generated/browser-viewer.js'
import { startRuntime } from '../packages/runtime/dist/index.js'
import { STUDIO_BROWSER_SCOPE } from '../packages/protocol/dist/index.js'

const root = await mkdtemp(join(tmpdir(), 'dovo-download-check-'))
const csv = 'name,value\nreport,42\n'
const fixture = createServer((request, response) => {
  if (request.url === '/report.csv' || request.url === '/empty.csv') {
    response.writeHead(200, {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${request.url.slice(1)}"`,
    })
    response.end(request.url === '/empty.csv' ? '' : csv)
  } else if (request.url === '/oversize') {
    response.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="oversize.bin"',
      'Content-Length': 60 * 1024 * 1024,
    })
    response.write(Buffer.alloc(1024))
    const timer = setInterval(() => response.write(Buffer.alloc(1024)), 100)
    response.once('close', () => clearInterval(timer))
  } else if (request.url === '/slow') {
    response.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="slow.bin"',
    })
    response.write(Buffer.alloc(1024))
    const timer = setInterval(() => response.write(Buffer.alloc(1024)), 100)
    response.once('close', () => clearInterval(timer))
  } else {
    response.setHeader('Content-Type', 'text/html')
    response.end(
      '<title>Report fixture</title><a href="/report.csv">Download report</a><a href="/empty.csv">Empty report</a><a href="/oversize">Oversize</a><a href="/slow">Slow</a><iframe src="/iframe"></iframe>'.replace(
        request.url === '/iframe' ? '<iframe src="/iframe"></iframe>' : 'UNUSED',
        '',
      ),
    )
  }
})
fixture.listen(0, '127.0.0.1')
await once(fixture, 'listening')
const origin = `http://127.0.0.1:${fixture.address().port}`
const token = 'download-check-owner-token-with-at-least-32-characters'
const runtime = await startRuntime({
  databasePath: join(root, 'runtime.db'),
  ownerToken: token,
  port: 0,
})
const base = `http://127.0.0.1:${runtime.port}`
const sockets = []
let viewerBrowser
const until = async (condition, message) => {
  for (let i = 0; i < 120; i++) {
    const result = await condition()
    if (result) return result
    await delay(50)
  }
  throw new Error(message)
}
const open = async (deviceToken = token, url = origin) => {
  const tabId = randomUUID()
  const response = await fetch(base + '/api/previews/browser/open', {
    method: 'POST',
    headers: { Authorization: `Bearer ${deviceToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId: STUDIO_BROWSER_SCOPE, tabId, url }),
  })
  assert.equal(response.status, 200)
  const { ticket } = await response.json()
  const messages = []
  const socket = new WebSocket(base.replace('http:', 'ws:') + '/ws/browser?ticket=' + ticket)
  socket.on('message', (raw) => {
    const data = JSON.parse(raw.toString())
    if (data.type !== 'frame') messages.push(data)
  })
  sockets.push(socket)
  await once(socket, 'open')
  const id = JSON.stringify([STUDIO_BROWSER_SCOPE, tabId])
  const session = await runtime.services.browsers.sessions.get(id)
  assert.ok(session)
  return { tabId, id, session, socket, messages }
}
const ready = async (tab, name, previous = new Set()) =>
  until(
    () =>
      tab.messages.find(
        (m) =>
          m.type === 'download' && m.status === 'ready' && m.name === name && !previous.has(m.id),
      ),
    `Download did not become ready: ${name}`,
  )
const grant = async (tab, id) => {
  const requestId = randomUUID()
  tab.socket.send(JSON.stringify({ type: 'downloadRequest', id, requestId }))
  return until(
    () => tab.messages.find((m) => m.requestId === requestId),
    'Download grant did not return',
  )
}
try {
  const a = await open()
  await a.session.page.getByText('Download report', { exact: true }).click()
  const first = await ready(a, 'report.csv')
  assert.equal(first.size, Buffer.byteLength(csv))
  const offered = await grant(a, first.id)
  assert.equal(offered.type, 'downloadReady')
  assert.ok(!offered.url.includes(token))
  const response = await fetch(base + offered.url)
  assert.equal(response.status, 200)
  assert.equal(await response.text(), csv)
  assert.match(response.headers.get('content-disposition'), /^attachment;/)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal((await fetch(base + offered.url)).status, 401, 'Grants are single-use')

  viewerBrowser = await chromium.launch()
  for (const mobile of [false, true]) {
    const viewer = await viewerBrowser.newPage({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1100, height: 760 },
      hasTouch: mobile,
    })
    const errors = []
    viewer.on('pageerror', (error) => errors.push(error.message))
    viewer.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning')
        console.error('Download viewer:', message.text())
    })
    await viewer.context().grantPermissions(['local-network-access'])
    await viewer.route(base + '/download-viewer-fixture', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: (mobile
          ? remoteBrowserHtml
          : '<!doctype html><html><head></head><body></body></html>'
        ).replace(
          '<head>',
          '<head><script>window.handoffs=[];' +
            (mobile
              ? 'window.ReactNativeWebView={postMessage(raw){const message=JSON.parse(raw);if(message.type==="downloadSave")window.handoffs.push(message)}};'
              : '') +
            '</script>',
        ),
      }),
    )
    await viewer.goto(base + '/download-viewer-fixture')
    if (!mobile) {
      // Match the production remote-browser wrapper: opaque origin, explicit download permission.
      await viewer.evaluate((html) => {
        document.body.innerHTML =
          '<iframe title="Browser" sandbox="allow-scripts allow-forms allow-downloads" style="width:100%;height:100vh"></iframe>'
        document.querySelector('iframe').srcdoc = html
      }, remoteBrowserHtml)
      await until(
        () => viewer.frames().find((frame) => frame.parentFrame()),
        'Sandbox viewer did not mount',
      )
    }
    const surface = mobile ? viewer : viewer.frames().find((frame) => frame.parentFrame())
    await surface.waitForSelector('#page', { state: 'attached' })
    const reconnect = await fetch(base + '/api/previews/browser/open', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: STUDIO_BROWSER_SCOPE, tabId: a.tabId }),
    })
    const ticket = (await reconnect.json()).ticket
    await viewer.evaluate(
      ({ url, mobile }) =>
        (mobile ? window : document.querySelector('iframe').contentWindow).postMessage(
          { channel: 'dovo-browser', type: 'connect', url },
          '*',
        ),
      { url: base.replace('http:', 'ws:') + '/ws/browser?ticket=' + ticket, mobile },
    )
    await surface.getByText('Connected', { exact: true }).waitFor()
    const saved = mobile ? null : viewer.waitForEvent('download')
    await surface.getByRole('button', { name: 'Save report.csv', exact: true }).click()
    if (mobile) {
      const handoff = await until(
        () => viewer.evaluate(() => window.handoffs[0]),
        'Native handoff was not offered',
      )
      assert.equal(handoff.name, 'report.csv')
      assert.equal(handoff.size, Buffer.byteLength(csv))
      assert.equal(await (await fetch(handoff.url)).text(), csv)
    } else {
      const file = await saved.catch(async (error) => {
        console.error('Download surface state', await surface.locator('#downloads').innerText())
        throw error
      })
      assert.equal(file.suggestedFilename(), 'report.csv')
      assert.equal(await file.failure(), null)
      const stream = await file.createReadStream()
      const parts = []
      for await (const part of stream) parts.push(part)
      assert.equal(Buffer.concat(parts).toString(), csv)
      await file.delete()
    }
    assert.equal(
      await surface.locator('#downloads').evaluate((node) => node.scrollWidth > node.clientWidth),
      false,
      'Downloads must fit narrow layouts',
    )
    assert.deepEqual(errors, [])
    await viewer.close()
  }

  const b = await open()
  assert.equal(
    (await grant(b, first.id)).type,
    'downloadError',
    'Another tab cannot read the first tab’s file',
  )
  const before = new Set(a.messages.filter((m) => m.type === 'download').map((m) => m.id))
  await runtime.services.browsers.input(a.id, { type: 'navigate', url: origin + '/report.csv' })
  const direct = await ready(a, 'report.csv', before)
  assert.notEqual(direct.id, first.id)
  assert.equal(
    a.messages.filter((m) => m.type === 'error' && /Download is starting/.test(m.message)).length,
    0,
  )
  assert.equal(
    b.messages.filter((m) => m.type === 'download').length,
    0,
    'Downloads stay with their originating page in a shared context',
  )

  await a.session.page.getByText('Empty report', { exact: true }).click()
  const empty = await ready(a, 'empty.csv')
  assert.equal(empty.size, 0)
  const emptyGrant = await grant(a, empty.id)
  assert.equal((await (await fetch(base + emptyGrant.url)).arrayBuffer()).byteLength, 0)

  await a.session.page.frameLocator('iframe').getByText('Download report', { exact: true }).click()
  await until(
    () =>
      a.messages
        .filter((m) => m.type === 'download' && m.status === 'ready')
        .map((m) => m.id)
        .filter((id, i, ids) => ids.indexOf(id) === i).length >= 4,
    'Iframe download was not offered',
  )

  await a.session.page.getByText('Slow', { exact: true }).click()
  const slow = await until(
    () => a.messages.find((m) => m.type === 'download' && m.name === 'slow.bin'),
    'Slow download did not start',
  )
  a.socket.send(JSON.stringify({ type: 'downloadCancel', id: slow.id }))
  await until(
    () => a.messages.some((m) => m.type === 'downloadRemoved' && m.id === slow.id),
    'Cancelled download was not removed',
  )
  assert.equal((await grant(a, slow.id)).type, 'downloadError')

  await a.session.page.getByText('Oversize', { exact: true }).click()
  await until(
    () => a.messages.some((m) => m.type === 'error' && /50 MB/.test(m.message)),
    'Oversized download was not cancelled from its advertised size',
  )
  await until(
    () => !a.session.downloads.messages().some((m) => m.name === 'oversize.bin'),
    'Oversized download was retained',
  )

  const removedGrant = await grant(a, first.id)
  a.socket.send(JSON.stringify({ type: 'downloadCancel', id: first.id }))
  await until(
    () => a.messages.some((m) => m.type === 'downloadRemoved' && m.id === first.id),
    'Removed download retained its entry',
  )
  assert.equal((await fetch(base + removedGrant.url)).status, 404)

  const deviceToken = 'download-check-revocable-device-with-at-least-32-characters'
  const device = runtime.services.devices.add('Download fixture device', deviceToken)
  const revoked = await open(deviceToken)
  await revoked.session.page.getByText('Download report', { exact: true }).click()
  const revocable = await ready(revoked, 'report.csv')
  const revocableGrant = await grant(revoked, revocable.id)
  runtime.services.devices.revoke(device)
  assert.equal((await fetch(base + revocableGrant.url)).status, 401)

  const initial = await open(token, origin + '/report.csv')
  await ready(initial, 'report.csv')
  assert.ok(
    !initial.session.failedNavigation,
    'An initial download is not a failed page navigation',
  )
  const closeGrant = await grant(b, randomUUID())
  assert.equal(closeGrant.type, 'downloadError')
  const validBeforeClose = await grant(a, direct.id)
  await runtime.services.browsers.close(a.id)
  assert.equal((await fetch(base + validBeforeClose.url)).status, 404)
  console.log(
    'Browser downloads: clicked/direct/initial/iframe/empty files, streaming HTTP, one-use grants, shared-context tab isolation, cancellation, advertised oversize rejection, removal, revocation and close passed.',
  )
} finally {
  for (const socket of sockets) socket.terminate()
  await viewerBrowser?.close()
  await runtime.close()
  assert.equal(
    (await readdir(join(root, 'browser-transfers'))).filter((name) =>
      /^run-[0-9a-f-]{36}$/.test(name),
    ).length,
    0,
  )
  fixture.closeAllConnections()
  fixture.close()
  await rm(root, { recursive: true, force: true })
}
