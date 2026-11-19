import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID, X509Certificate } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from './browser/harness.mjs'
import { startRuntime } from '../packages/runtime/dist/index.js'
import { STUDIO_BROWSER_SCOPE } from '../packages/protocol/dist/index.js'
import { remoteBrowserHtml } from '../packages/protocol/dist/generated/browser-viewer.js'

const directory = await mkdtemp(join(tmpdir(), 'dovo-paired-certificate-'))
let tls, runtime, viewer
try {
  const key = join(directory, 'key.pem'),
    certificate = join(directory, 'certificate.pem')
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=127.0.0.1',
      '-addext',
      'subjectAltName=IP:127.0.0.1',
      '-keyout',
      key,
      '-out',
      certificate,
    ],
    { stdio: 'pipe' },
  )
  const cert = await readFile(certificate)
  const fingerprint = new X509Certificate(cert).fingerprint256
  let visits = 0
  tls = createServer({ key: await readFile(key), cert }, (req, res) => {
    if (req.url === '/fixture') visits++
    res.setHeader('Content-Type', 'text/html')
    res.end('<title>Paired TLS fixture</title><link rel="icon" href="data:,">TLS fixture')
  })
  tls.listen(0, '127.0.0.1')
  await once(tls, 'listening')
  const origin = 'https://127.0.0.1:' + tls.address().port
  const token = 'paired-certificate-test-owner-token-with-more-than-32-characters'
  runtime = await startRuntime({
    databasePath: join(directory, 'runtime.db'),
    ownerToken: token,
    port: 0,
  })
  const base = 'http://127.0.0.1:' + runtime.port
  const tabId = randomUUID()
  const ticket = async () => {
    const res = await fetch(base + '/api/previews/browser/open', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: STUDIO_BROWSER_SCOPE, tabId }),
    })
    assert.ok(res.ok)
    return (await res.json()).ticket
  }
  const first = await ticket()
  const id = JSON.stringify([STUDIO_BROWSER_SCOPE, tabId])
  const session = await runtime.services.browsers.sessions.get(id)
  // Only this temporary Chromium process accepts the fixture's one-day self-signed certificate.
  await session.cdp.send('Security.setIgnoreCertificateErrors', { ignore: true })
  await runtime.services.browsers.input(id, { type: 'navigate', url: origin + '/fixture' })
  viewer = await chromium.launch()
  for (const mobile of [false, true]) {
    const page = await viewer.newPage({
      viewport: mobile ? { width: 390, height: 800 } : { width: 1000, height: 720 },
      hasTouch: mobile,
    })
    try {
      await page.context().grantPermissions(['local-network-access'])
      page.setDefaultTimeout(8000)
      await page.route(base + '/viewer', (route) =>
        route.fulfill({ contentType: 'text/html', body: remoteBrowserHtml }),
      )
      await page.goto(base + '/viewer')
      const url =
        base.replace('http:', 'ws:') + '/ws/browser?ticket=' + (mobile ? await ticket() : first)
      await page.evaluate(
        (url) => window.postMessage({ channel: 'dovo-browser', type: 'connect', url }, '*'),
        url,
      )
      const info = page.getByRole('button', { name: 'Site information', exact: true })
      await page.waitForFunction(() => !document.getElementById('siteInfo').disabled)
      await info.click()
      const dialog = page.getByRole('dialog', { name: 'Site information' })
      await dialog.getByText(fingerprint, { exact: true }).waitFor({ timeout: 8000 })
      assert.ok((await dialog.innerText()).includes(origin))
      assert.match(await dialog.innerText(), /TLS 1\.[23]/)
      if (!mobile) {
        runtime.services.preferences.save({ enableStudioBrowsers: true })
        const call = async (command) => {
          const res = await fetch(base + '/api/studio/tools', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskId: 'studio-integration', part: 'browsers', command }),
          })
          const result = await res.json()
          assert.ok(res.ok, JSON.stringify(result))
          return result
        }
        const sessions = (await call({ action: 'list' })).sessions
        const tab = sessions.find((entry) => entry.id === 'workspace:' + tabId)
        assert.equal(tab?.certificateSupported, true)
        const tool = await call({ action: 'certificate', id: tab.reference })
        assert.equal(tool.certificate.origin, origin)
        assert.equal(tool.certificate.chain[0].fingerprint256, fingerprint)
      }
      assert.equal(visits, 1, 'Viewer and agent inspections use the existing page connection')
      if (mobile) {
        let previous = session.certificateDocumentId
        await runtime.services.browsers.input(id, { type: 'reload' })
        await dialog.waitFor({ state: 'hidden' })
        await page.waitForFunction(
          () => document.getElementById('reload').getAttribute('aria-busy') === 'false',
        )
        await assert.rejects(
          runtime.services.browsers.certificate(id, previous, () => {}),
          /page changed/,
        )
        await info.click()
        await dialog.getByText(fingerprint, { exact: true }).waitFor()
        assert.equal(visits, 2, 'Reload visits the website once')
        previous = session.certificateDocumentId
        await runtime.services.browsers.input(id, {
          type: 'navigate',
          url: base + '/fixture-over-http',
        })
        await dialog.waitFor({ state: 'hidden' })
        await info.click()
        await dialog.getByText('This HTTP page has no website certificate.').waitFor()
        await assert.rejects(
          runtime.services.browsers.certificate(id, previous, () => {}),
          /page changed/,
        )
      }
    } finally {
      await page.close()
    }
  }
  console.log(
    'Paired browser certificate: real HTTPS fingerprint and TLS details, desktop and touch viewer, HTTP fallback and navigation invalidation passed.',
  )
} finally {
  await viewer?.close()
  await runtime?.close()
  if (tls) await new Promise((resolve) => tls.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
