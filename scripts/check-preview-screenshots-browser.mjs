import assert from 'node:assert/strict'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = new URL('../', import.meta.url).pathname
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'ts',
      contents: `import {remoteBrowserHtml} from './packages/protocol/src/generated/browser-viewer';window.viewer=remoteBrowserHtml;`,
    },
    bundle: true,
    write: false,
    format: 'iife',
  },
  [],
)
const browser = await chromium.launch()
try {
  for (const native of [false, true]) {
    const page = await browser.newPage({ viewport: { width: 390, height: 850 } })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setContent(
      '<iframe title="Preview" sandbox="allow-scripts allow-forms" style="width:370px;height:780px"></iframe>',
    )
    await page.addScriptTag({ content: built.outputFiles[0].text })
    await page.evaluate((native) => {
      window.captures = []
      window.snapshots = []
      window.addEventListener('message', (event) => {
        if (
          event.source === document.querySelector('iframe').contentWindow &&
          event.data.type === 'snapshot'
        )
          window.snapshots.push(event.data)
        if (
          event.source === document.querySelector('iframe').contentWindow &&
          event.data.type === 'screenshot'
        )
          window.captures.push(event.data.image)
      })
      const shim = `<script>window.WebSocket=class {static OPEN=1;readyState=1;constructor(){window.socket=this;queueMicrotask(()=>this.onopen?.())}send(){}close(){this.readyState=3;this.onclose?.()}};${native ? 'window.ReactNativeWebView={postMessage:data=>parent.postMessage(JSON.parse(data),"*")};' : ''}</script>`
      document.querySelector('iframe').srcdoc = window.viewer.replace('<head>', '<head>' + shim)
    }, native)
    const frame = page.frameLocator('iframe')
    await frame.locator('#screenshot').waitFor({ state: 'attached' })
    await frame.getByLabel('Browser options', { exact: true }).click()
    await frame.getByRole('button', { name: 'Take screenshot', exact: true }).click()
    await frame.locator('#status').filter({ hasText: 'Wait for a preview image' }).waitFor()
    assert.equal(await page.evaluate(() => window.captures.length), 0)
    await page.evaluate(() =>
      document.querySelector('iframe').contentWindow.postMessage(
        {
          channel: 'dovo-browser',
          type: 'connect',
          url: 'ws://127.0.0.1:3000/ws/browser?ticket=test',
        },
        '*',
      ),
    )
    const child = page.frames()[1]
    await child.waitForFunction(() => window.socket)
    await child.evaluate(() => {
      window.socket.onmessage({
        data: JSON.stringify({
          type: 'state',
          url: 'http://localhost:3000',
          title: 'Preview',
          editable: false,
          back: false,
          forward: false,
          loading: false,
        }),
      })
      const canvas = document.createElement('canvas')
      canvas.width = 600
      canvas.height = 400
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#ef4444'
      ctx.fillRect(0, 0, 600, 400)
      window.socket.onmessage({
        data: JSON.stringify({
          type: 'frame',
          width: 600,
          height: 400,
          data: canvas.toDataURL('image/jpeg').split(',')[1],
        }),
      })
    })
    await frame.locator('#page[data-viewport-width="600"]').waitFor()
    await page.evaluate(() =>
      document
        .querySelector('iframe')
        .contentWindow.postMessage({ channel: 'dovo-browser', type: 'snapshot', id: 42 }, '*'),
    )
    await page.waitForFunction(() => window.snapshots.length === 1)
    assert.equal(await page.evaluate(() => window.snapshots[0].id), 42)
    assert.match(await page.evaluate(() => window.snapshots[0].image), /^data:image\/png;base64,/)
    assert.equal(
      await page.evaluate(() => window.captures.length),
      0,
      'Retaining the background must not open the image editor',
    )
    await frame.getByLabel('Browser options', { exact: true }).click()
    await frame.getByRole('button', { name: 'Take screenshot', exact: true }).click()
    await page.waitForFunction(() => window.captures.length === 1)
    assert.deepEqual(
      await page.evaluate(async () => {
        const image = await createImageBitmap(await (await fetch(window.captures[0])).blob())
        const canvas = document.createElement('canvas')
        canvas.width = image.width
        canvas.height = image.height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(image, 0, 0)
        const pixel = ctx.getImageData(300, 200, 1, 1).data
        return [image.width, image.height, pixel[0] > 200 && pixel[1] < 100]
      }),
      [600, 400, true],
    )
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log(
    'Preview screenshots: desktop iframe and native bridges capture PNG pixels at stream resolution; blank captures are rejected.',
  )
} finally {
  await browser.close()
}
