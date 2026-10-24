import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const source = await readFile(root + 'packages/protocol/src/generated/browser-viewer.ts', 'utf8')
const marker = 'export const remoteBrowserHtml = '
const html = JSON.parse(source.slice(source.indexOf(marker) + marker.length))
// Only the transport is simulated: exercise the actual viewer, controls and styles.
const shim = `<script>
window.outbox=[];window.bridges=[];
window.WebSocket=class {static OPEN=1;readyState=1;constructor(){window.socket=this;queueMicrotask(()=>this.onopen?.())}send(data){window.outbox.push(JSON.parse(data))}close(){this.readyState=3}};
window.addEventListener('message',event=>{if(event.data?.channel==='dovo-browser'&&['ready','reconnect','close'].includes(event.data.type))window.bridges.push(event.data.type)});
</script>`
const browser = await chromium.launch()
await mkdir('/tmp/dovo-browser-redesign', { recursive: true })
try {
  for (const [width, height, touch, native] of [
    [320, 600, true],
    [390, 844, true],
    [844, 390, true],
    [768, 1024, true],
    [1100, 760, false],
    [1024, 768, false, true],
  ]) {
    const page = await browser.newPage({ viewport: { width, height }, hasTouch: touch })
    page.setDefaultTimeout(5000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('http://viewer.test/', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: html.replace(
          '<head>',
          '<head>' +
            shim +
            (native ? '<script>window.ReactNativeWebView={postMessage(){}};</script>' : ''),
        ),
      }),
    )
    await page.goto('http://viewer.test/')
    const post = (message) =>
      page.evaluate(
        (message) => window.postMessage({ channel: 'dovo-browser', ...message }, '*'),
        message,
      )
    const address = page.getByRole('textbox', { name: 'Host browser URL', exact: true })
    await address.waitFor()
    assert.equal(
      await page.getByRole('button', { name: 'localhost:3000', exact: true }).isDisabled(),
      true,
    )
    await post({ type: 'connect', url: 'ws://fixture/browser' })
    await page.getByText('Connected', { exact: true }).waitFor()
    await page.evaluate(() =>
      window.socket.onmessage({
        data: JSON.stringify({
          type: 'state',
          url: 'about:blank',
          title: 'New tab',
          back: false,
          forward: false,
          loading: false,
          editable: false,
        }),
      }),
    )
    assert.ok(
      (await address.boundingBox()).width >= (width <= 520 ? 200 : 150),
      'Roomy address at ' + width,
    )
    if (touch)
      for (const name of ['Reload', 'Keyboard']) {
        const box = await page.getByRole('button', { name, exact: true }).boundingBox()
        assert.ok(box.width >= 44 && box.height >= 44, 'Touch target ' + name + ' at ' + width)
      }
    // The stream diagnostics no longer reserve an extra row below navigation.
    assert.equal(await page.locator('#streamPerformance').isVisible(), false)
    const viewportBefore = await page.locator('#viewport').boundingBox()
    const toolbar = await page.locator('#browserBar').boundingBox()
    if (touch || native) {
      assert.ok(viewportBefore.y + viewportBefore.height <= toolbar.y, 'Mobile toolbar below page')
      assert.equal(toolbar.y + toolbar.height, height, 'Mobile toolbar anchored to bottom')
    } else {
      assert.ok(toolbar.y + toolbar.height <= viewportBefore.y, 'Desktop toolbar above page')
    }
    await page.getByRole('button', { name: 'localhost:3000', exact: true }).click()
    assert.equal(await page.evaluate(() => window.outbox.at(-1).url), 'http://localhost:3000')
    await page.keyboard.press('Control+l')
    assert.equal(await address.evaluate((node) => node === document.activeElement), true)
    await address.fill('http://100.64.0.2:4310')
    await address.press('Enter')
    assert.equal(
      await page.evaluate(() => window.outbox.at(-1).url),
      'http://100.64.0.2:4310',
      'HTTP VPN addresses remain HTTP',
    )
    await page.evaluate(() =>
      window.socket.onmessage({
        data: JSON.stringify({
          type: 'state',
          url: 'http://100.64.0.2:4310',
          title: 'Project',
          back: true,
          forward: false,
          loading: true,
          editable: false,
        }),
      }),
    )
    assert.equal(
      await page.getByRole('button', { name: 'Reload', exact: true }).getAttribute('aria-busy'),
      'true',
    )
    await page.keyboard.press('Control+r')
    assert.equal(await page.evaluate(() => window.outbox.at(-1).type), 'reload')
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    assert.equal(await page.evaluate(() => window.outbox.at(-1).type), 'back')
    await page.evaluate(() =>
      window.socket.onmessage({
        data: JSON.stringify({
          type: 'state',
          url: 'about:blank',
          title: 'New tab',
          back: false,
          forward: false,
          loading: false,
          editable: false,
        }),
      }),
    )
    for (const theme of ['dark', 'light']) {
      await post({ type: 'appearance', theme })
      await page.waitForFunction((theme) => document.documentElement.dataset.theme === theme, theme)
      await page.getByLabel('Browser options', { exact: true }).click()
      const menu = page.locator('#menu')
      assert.equal(await menu.isVisible(), true)
      const box = await menu.boundingBox()
      assert.ok(
        box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height,
        'Options fit ' + width + '/' + theme + ': ' + JSON.stringify(box),
      )
      if (touch || native) assert.ok(box.y + box.height <= toolbar.y, 'Mobile options open upward')
      assert.equal(await page.locator('#streamPerformance').isVisible(), true)
      await page.getByLabel('Viewport', { exact: true }).selectOption('phone')
      const portrait = await page.evaluate(
        () => window.outbox.filter((message) => message.type === 'resize').at(-1).width,
      )
      await page.getByRole('button', { name: 'Rotate viewport', exact: true }).click()
      assert.equal(
        await page.evaluate(
          () => window.outbox.filter((message) => message.type === 'resize').at(-1).width,
        ),
        portrait === 390 ? 844 : 390,
      )
      await page.getByLabel('Viewport', { exact: true }).selectOption('fill')
      await page.keyboard.press('Escape')
      assert.equal(await menu.isVisible(), false)
      assert.equal(
        await page
          .getByLabel('Browser options', { exact: true })
          .evaluate((node) => node === document.activeElement),
        true,
      )
      assert.deepEqual(
        await page.locator('#viewport').boundingBox(),
        viewportBefore,
        'Opening options never resizes the page',
      )
      if (width === 390 || width === 1100)
        await page.screenshot({ path: `/tmp/dovo-browser-redesign/viewer-${width}-${theme}.png` })
      await page.getByLabel('Browser options', { exact: true }).click()
      await address.click()
      assert.equal(await menu.isVisible(), false, 'Outside press closes the menu')
    }
    await post({ type: 'presentation', expanded: true })
    await page.locator('#browserBar').waitFor({ state: 'hidden' })
    await post({ type: 'presentation', expanded: false })
    await page.locator('#browserBar').waitFor({ state: 'visible' })
    // Device previews keep hardware actions, without irrelevant browser viewport settings.
    await post({ type: 'configure', device: { platform: 'ios', kind: 'physical' } })
    await page.getByRole('button', { name: 'Home', exact: true }).waitFor()
    assert.equal(await address.isVisible(), false)
    await page.getByLabel('Browser options', { exact: true }).click()
    assert.equal(await page.getByLabel('Viewport', { exact: true }).isVisible(), false)
    await page.getByRole('button', { name: 'Close device preview', exact: true }).waitFor()
    await page.keyboard.press('Escape')
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    )
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log(
    'Shared browser viewer: phone/tablet/desktop, portrait/landscape, 44px touch controls, light/dark appearance, HTTP navigation, start shortcuts, loading state, anchored/dismissible menus, diagnostics, expanded and device modes passed.',
  )
} finally {
  await browser.close()
}
