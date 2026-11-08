import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from './browser/harness.mjs'

const source = await readFile(
  new URL('../packages/protocol/src/generated/browser-viewer.ts', import.meta.url),
  'utf8',
)
const html = JSON.parse(
  source.slice(
    source.indexOf('export const remoteBrowserHtml = ') +
      'export const remoteBrowserHtml = '.length,
  ),
)
const shim = `<script>
window.sent=[];window.native=[];
window.WebSocket=class {static OPEN=1;readyState=1;constructor(){window.socket=this;queueMicrotask(()=>this.onopen?.())}send(data){window.sent.push(JSON.parse(data))}close(){this.readyState=3}};
window.ReactNativeWebView={postMessage(data){window.native.push(JSON.parse(data))}};
</script>`
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  await page.route('http://viewer.test/', (route) =>
    route.fulfill({ contentType: 'text/html', body: html.replace('<head>', '<head>' + shim) }),
  )
  await page.goto('http://viewer.test/')
  await page.evaluate(() =>
    window.postMessage(
      {
        channel: 'dovo-browser',
        type: 'connect',
        url: 'ws://runtime.test/ws/browser?ticket=secret',
      },
      '*',
    ),
  )
  await page.getByText('Connected', { exact: true }).waitFor()
  const emit = (message) =>
    page.evaluate((message) => window.socket.onmessage({ data: JSON.stringify(message) }), message)
  const download = {
    type: 'download',
    id: '3b3732c8-bb09-435a-83b2-f9d07d959045',
    name: 'report.csv',
    size: 5,
    status: 'downloading',
  }
  await emit(download)
  assert.equal(await page.getByRole('button', { name: 'Save report.csv' }).count(), 0)
  await page.getByRole('button', { name: 'Cancel report.csv' }).click()
  assert.equal(await page.evaluate(() => window.sent.at(-1).type), 'downloadCancel')
  download.size = 12
  download.status = 'ready'
  await emit(download)
  await page.getByRole('button', { name: 'Save report.csv' }).click()
  const request = await page.evaluate(() =>
    window.sent.find((message) => message.type === 'downloadRequest'),
  )
  assert.equal(request.id, download.id)
  await emit({
    ...download,
    type: 'downloadReady',
    requestId: request.requestId,
    url: '//evil.test/api/previews/browser/download/grant',
  })
  assert.equal(await page.getByText('Invalid download response.').count(), 1)
  await page.getByRole('button', { name: 'Save report.csv' }).click()
  const next = await page.evaluate(() =>
    window.sent.filter((message) => message.type === 'downloadRequest').at(-1),
  )
  await emit({
    ...download,
    type: 'downloadReady',
    requestId: request.requestId,
    url: '/api/previews/browser/download/grant_123',
  })
  assert.equal(
    await page.evaluate(
      () => window.native.filter((message) => message.type === 'downloadSave').length,
    ),
    0,
  )
  await emit({
    ...download,
    type: 'downloadReady',
    requestId: next.requestId,
    url: '/api/previews/browser/download/grant_123',
  })
  const handoff = await page.evaluate(() =>
    window.native.find((message) => message.type === 'downloadSave'),
  )
  assert.equal(handoff.url, 'http://runtime.test/api/previews/browser/download/grant_123')
  assert.equal(JSON.stringify(handoff).includes('secret'), false)
  await page.evaluate(
    ({ id, requestId }) =>
      window.postMessage(
        { channel: 'dovo-browser', type: 'downloadResult', id, requestId, message: 'Shared' },
        '*',
      ),
    next,
  )
  await page.getByText('Shared').waitFor()
  await page.getByRole('button', { name: 'Remove report.csv' }).click()
  assert.equal(await page.evaluate(() => window.sent.at(-1).type), 'downloadCancel')
  await emit({ type: 'downloadRemoved', id: download.id })
  assert.equal(await page.getByRole('button', { name: 'Save report.csv' }).count(), 0)
  await emit(download)
  await page.evaluate(
    ({ id, requestId }) =>
      window.postMessage(
        { channel: 'dovo-browser', type: 'downloadResult', id, requestId, message: 'Stale result' },
        '*',
      ),
    next,
  )
  assert.equal(await page.getByText('Stale result').count(), 0)
  await page.close()
  const webPage = await browser.newPage({ acceptDownloads: true })
  await webPage.route('http://viewer.test/', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: html.replace(
        '<head>',
        '<head>' +
          shim.replace(
            'window.ReactNativeWebView={postMessage(data){window.native.push(JSON.parse(data))}};',
            '',
          ),
      ),
    }),
  )
  await webPage.route('http://runtime.test/api/previews/browser/download/grant_123', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'content-disposition': 'attachment; filename="report.csv"' },
      body: 'hello,world\n',
    }),
  )
  await webPage.goto('http://viewer.test/')
  await webPage.evaluate(() =>
    window.postMessage(
      {
        channel: 'dovo-browser',
        type: 'connect',
        url: 'ws://runtime.test/ws/browser?ticket=secret',
      },
      '*',
    ),
  )
  await webPage.getByText('Connected', { exact: true }).waitFor()
  await webPage.evaluate(
    (value) => window.socket.onmessage({ data: JSON.stringify(value) }),
    download,
  )
  await webPage.getByRole('button', { name: 'Save report.csv' }).click()
  const webRequest = await webPage.evaluate(() =>
    window.sent.find((message) => message.type === 'downloadRequest'),
  )
  const saving = webPage.waitForEvent('download')
  await webPage.evaluate((value) => window.socket.onmessage({ data: JSON.stringify(value) }), {
    ...download,
    type: 'downloadReady',
    requestId: webRequest.requestId,
    url: '/api/previews/browser/download/grant_123',
  })
  const saved = await saving
  assert.equal(saved.suggestedFilename(), 'report.csv')
  assert.equal(await saved.failure(), null)
  await webPage.close()
  console.log('Browser download viewer checks passed')
} finally {
  await browser.close()
}
