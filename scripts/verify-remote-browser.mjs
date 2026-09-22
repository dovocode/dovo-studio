import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { startRuntime } from '../packages/runtime/dist/index.js'
import { remoteBrowserHtml } from '../packages/protocol/dist/generated/browser-viewer.js'
const require = createRequire(new URL('../packages/runtime/package.json', import.meta.url))
const { chromium } = require('playwright')
const { WebSocket } = require('ws')
const token = randomBytes(32).toString('base64url')
const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
const captured = []
const errors = []
const site = createServer(async (request, response) => {
  if (request.url === '/capture' && request.method === 'POST') {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    captured.push(Buffer.concat(chunks).toString())
    response.end('ok')
  } else if (request.url === '/viewer') {
    response.setHeader('Content-Type', 'text/html')
    response.end(remoteBrowserHtml)
  } else if (request.url === '/shell') {
    response.setHeader('Content-Type', 'text/html')
    response.end(
      '<style>html,body{margin:0;height:100%}iframe{width:100%;height:100%;border:0}</style><iframe title="Host browser" sandbox="allow-scripts allow-forms" src="/viewer"></iframe>',
    )
  } else if (request.url === '/second') {
    response.setHeader('Content-Type', 'text/html')
    response.end('<h1>Second page</h1><a href="/">Home</a>')
  } else {
    response.setHeader('Content-Type', 'text/html')
    response.end(
      `<!doctype html><title>Remote browser test</title><style>body{margin:0;background:#f2f5ff;color:#111;font:18px system-ui;height:2200px}input,button,a{position:absolute;left:20px;width:260px;height:44px;box-sizing:border-box}input{top:60px;font-size:18px}button{top:120px}a{top:180px}h1{margin:8px 20px;font-size:24px}#bottom{position:absolute;top:1700px}</style><h1>Host-only browser fixture</h1><input aria-label="Fixture input" oninput="fetch('/capture',{method:'POST',body:this.value})"><button onclick="fetch('/capture',{method:'POST',body:'clicked'})">Click on the host</button><a href="/second">Second page</a><div id="bottom">Scrolled on the host</div><script>for(const type of ['touchstart','touchmove','touchend'])addEventListener(type,()=>fetch('/capture',{method:'POST',body:type}),{passive:true});addEventListener('scroll',()=>fetch('/capture',{method:'POST',body:'scroll:'+scrollY}));</script>`,
    )
  }
})
await new Promise((resolve) => site.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${site.address().port}`
const call = (path, body, credential = token) =>
  fetch(`http://127.0.0.1:${runtime.port}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
let browser
let page
try {
  runtime.services.store.update((workspace) => ({
    ...workspace,
    tasks: [
      {
        id: 'browser-task',
        title: 'Browser QA',
        repositoryId: '',
        agentId: '',
        status: 'draft',
        createdAt: new Date().toISOString(),
        messages: [],
        files: [],
        draft: '',
        example: false,
      },
    ],
  }))
  assert.equal(
    (await call('/api/previews/browser/open', { taskId: 'browser-task' }, 'bad')).status,
    401,
  )
  assert.equal((await call('/api/previews/browser/open', { taskId: 'missing' })).status, 404)
  const deviceToken = randomBytes(32).toString('base64url')
  const device = runtime.services.devices.add('Browser QA', deviceToken)
  const open = async (credential = token) => {
    const response = await call(
      '/api/previews/browser/open',
      { taskId: 'browser-task' },
      credential,
    )
    const value = await response.json()
    assert.equal(response.status, 200, JSON.stringify(value))
    return `ws://127.0.0.1:${runtime.port}/ws/browser?ticket=${value.ticket}`
  }
  const socketUrl = await open(deviceToken)
  const socket = new WebSocket(socketUrl)
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString())
    if (message.type === 'error') errors.push(message.message)
  })
  await once(socket, 'open')
  const replay = new WebSocket(socketUrl)
  await assert.rejects(once(replay, 'open'), /401/)
  const closed = once(socket, 'close')
  runtime.services.devices.revoke(device)
  assert.equal((await closed)[0], 1008)
  console.log('Authentication, one-time tickets and revocation passed')
  browser = await chromium.launch({
    executablePath:
      process.env.DOVO_BROWSER_EXECUTABLE ||
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    chromiumSandbox: true,
  })
  if (process.argv.includes('--slow-decoder')) {
    const originalNewPage = browser.newPage.bind(browser)
    browser.newPage = async (...args) => {
      const page = await originalNewPage(...args)
      await page.addInitScript(() => {
        const decode = window.createImageBitmap.bind(window)
        window.createImageBitmap = async (...args) => {
          await new Promise((resolve) => setTimeout(resolve, 80))
          return decode(...args)
        }
      })
      return page
    }
  }
  page = await browser.newPage({ viewport: { width: 1024, height: 800 } })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${base}/shell`)
  const viewer = page.frameLocator('iframe')
  await viewer.getByLabel('Host browser URL').waitFor()
  const connect = async () => {
    const url = await open()
    await page.evaluate(
      (url) =>
        document
          .querySelector('iframe')
          .contentWindow.postMessage({ channel: 'dovo-browser', type: 'connect', url }, '*'),
      url,
    )
    await viewer.getByRole('button', { name: 'Go', exact: true }).waitFor()
    await until(
      async () => !(await viewer.getByRole('button', { name: 'Go', exact: true }).isDisabled()),
    )
  }
  await connect()
  await viewer.getByLabel('Host browser URL').fill(base)
  await viewer.getByRole('button', { name: 'Go', exact: true }).click()
  await until(async () => (await viewer.getByLabel('Host browser URL').inputValue()) === `${base}/`)
  const canvas = viewer.locator('canvas')
  await canvas.waitFor({ state: 'visible' })
  await until(async () => (await canvas.getAttribute('data-viewport-width')) === '1024')
  const clickAt = async (x, y) => {
    const bounds = await canvas.boundingBox()
    const w = Number(await canvas.getAttribute('data-viewport-width'))
    const h = Number(await canvas.getAttribute('data-viewport-height'))
    await page.mouse.click(bounds.x + (x * bounds.width) / w, bounds.y + (y * bounds.height) / h)
  }
  await clickAt(100, 140)
  await until(() => captured.includes('clicked'))
  await clickAt(100, 80)
  await page.keyboard.type('hello remote')
  await until(() => captured.includes('hello remote'))
  await page.keyboard.press('Backspace')
  await until(() => captured.includes('hello remot'))
  await viewer.getByRole('button', { name: 'Keyboard', exact: true }).click()
  await viewer.getByLabel('Type into remote page').pressSequentially('e!')
  await until(() => captured.includes('hello remote!'))
  await viewer.getByRole('button', { name: 'Keyboard', exact: true }).click()
  await clickAt(250, 80)
  // A keyboard paste must retain the browser's default paste event and forward
  // its explicit text, without reading or changing the machine's clipboard.
  await canvas.evaluate((target) => {
    for (const modifier of ['ctrlKey', 'metaKey']) {
      const allowed = target.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'v', [modifier]: true, cancelable: true }),
      )
      if (!allowed) throw new Error('Paste shortcut was intercepted')
    }
    const clipboardData = new DataTransfer()
    clipboardData.setData('text/plain', ' pasted')
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData, cancelable: true }))
  })
  await until(() => captured.includes('hello remote! pasted'))
  await clickAt(100, 195)
  await until(
    async () => (await viewer.getByLabel('Host browser URL').inputValue()) === `${base}/second`,
  )
  await viewer.getByRole('button', { name: 'Back', exact: true }).click()
  await until(async () => (await viewer.getByLabel('Host browser URL').inputValue()) === `${base}/`)
  await viewer.getByRole('button', { name: 'Forward', exact: true }).click()
  await until(
    async () => (await viewer.getByLabel('Host browser URL').inputValue()) === `${base}/second`,
  )
  await viewer.getByRole('button', { name: 'Back', exact: true }).click()
  await until(async () => (await viewer.getByLabel('Host browser URL').inputValue()) === `${base}/`)
  await clickAt(350, 300)
  await page.mouse.wheel(0, 400)
  await until(() =>
    captured.some((value) => value.startsWith('scroll:') && Number(value.slice(7)) > 0),
  )
  // Trusted touch events exercise the viewer's pointer capture and the host's CDP touch path.
  const touchSession = await page.context().newCDPSession(page)
  const bounds = await canvas.boundingBox()
  const touchX = bounds.x + bounds.width * 0.75
  const touchY = bounds.y + bounds.height * 0.8
  await touchSession.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: touchX, y: touchY, id: 0 }],
  })
  await until(() => captured.includes('touchstart'))
  await canvas.evaluate((target) => {
    for (const type of ['pointerdown', 'pointermove', 'pointerup'])
      target.dispatchEvent(
        new PointerEvent(type, {
          pointerId: 999,
          pointerType: 'touch',
          clientX: 10,
          clientY: 10,
        }),
      )
  })
  for (let step = 1; step <= 8; step++) {
    await touchSession.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: touchX, y: touchY - step * 15, id: 0 }],
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  await touchSession.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await until(() => captured.includes('touchmove') && captured.includes('touchend'))
  await touchSession.detach()
  assert.equal(captured.filter((value) => value === 'touchstart').length, 1)
  console.log('Native touch start, swipe and release reached the remote page')
  await canvas.evaluate((target) => {
    target.addEventListener('pointerdown', (event) => {
      target.dataset.pointerId = String(event.pointerId)
    })
  })
  const releaseSession = await page.context().newCDPSession(page)
  const startTouch = () =>
    releaseSession.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: touchX, y: touchY, id: 0 }],
    })
  const endTouch = () =>
    releaseSession.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    })
  const movesBeforeRelease = captured.filter((value) => value === 'touchmove').length
  await startTouch()
  await canvas.evaluate(
    (target, point) => {
      target.dispatchEvent(
        new PointerEvent('pointerup', {
          pointerId: Number(target.dataset.pointerId),
          pointerType: 'touch',
          clientX: point.x,
          clientY: point.y - 90,
        }),
      )
    },
    { x: touchX, y: touchY },
  )
  await endTouch()
  await until(() => captured.filter((value) => value === 'touchmove').length > movesBeforeRelease)
  await startTouch()
  await canvas.evaluate((target) => {
    target.dispatchEvent(
      new PointerEvent('lostpointercapture', {
        pointerId: Number(target.dataset.pointerId),
        pointerType: 'touch',
      }),
    )
  })
  await endTouch()
  // The next gesture must work without reconnecting after capture was lost.
  await until(() => captured.filter((value) => value === 'touchend').length >= 3)
  const startsBeforeRecovery = captured.filter((value) => value === 'touchstart').length
  await startTouch()
  await endTouch()
  await until(
    () => captured.filter((value) => value === 'touchstart').length > startsBeforeRecovery,
  )
  await releaseSession.detach()
  console.log('Release-only swipe movement and pointer-capture recovery passed')

  // Deterministically reproduce Chromium's document-replacement race on the real session.
  // Internal access is confined to this integration test; no production test hooks are needed.
  const host = runtime.services.browsers
  const session = await host.sessions.get('browser-task')
  const originalSend = session.cdp.send.bind(session.cdp)
  const messages = []
  const listener = (message) => messages.push(message)
  session.listeners.add(listener)
  try {
    for (const failure of [
      'cdpSession.send: Protocol error (Page.getNavigationHistory): Not attached to an active page',
      'Execution context was destroyed, most likely because of a navigation',
    ]) {
      session.cdp.send = async (method, ...args) => {
        if (method === 'Page.getNavigationHistory') throw new Error(failure)
        return originalSend(method, ...args)
      }
      await until(() => !session.statePending)
      messages.length = 0
      await host.state(session)
      assert.ok(messages.some((message) => message.type === 'state'))
      assert.ok(!messages.some((message) => message.type === 'error'))
    }
    session.cdp.send = async (method, ...args) => {
      if (method === 'Page.getNavigationHistory') throw new Error('Unexpected protocol failure')
      return originalSend(method, ...args)
    }
    await assert.rejects(host.state(session), /Unexpected protocol failure/)
  } finally {
    session.cdp.send = originalSend
    session.listeners.delete(listener)
  }
  await host.state(session)
  console.log('Navigation replacement retains state; unexpected failures remain visible')

  await viewer.getByLabel('Viewport', { exact: true }).selectOption('phone')
  await until(async () => (await canvas.getAttribute('data-viewport-width')) === '390')
  await viewer.getByRole('button', { name: 'Rotate viewport' }).click()
  await until(async () => (await canvas.getAttribute('data-viewport-width')) === '844')
  const retainedWidth = await canvas.evaluate((target) => {
    window.dispatchEvent(new Event('pagehide'))
    return target.getAttribute('width')
  })
  assert.equal(await canvas.getAttribute('width'), retainedWidth)
  assert.equal(await canvas.isVisible(), true)
  assert.equal(await viewer.getByRole('button', { name: 'Go', exact: true }).isDisabled(), true)
  await connect()
  await until(async () => (await viewer.getByLabel('Host browser URL').inputValue()) === `${base}/`)
  console.log(
    'Canvas click, hardware/mobile typing, Back/Forward, scrolling, viewport and reconnect passed',
  )
  await mkdir('work/design/remote-browser', { recursive: true })
  await clickAt(100, 100)
  await page.mouse.wheel(0, -4000)
  await until(() => captured.at(-1) === 'scroll:0')
  await viewer.getByLabel('Viewport', { exact: true }).selectOption('fill')
  await until(async () => (await canvas.getAttribute('data-viewport-width')) === '1024')
  await page.screenshot({ path: 'work/design/remote-browser/desktop.png' })
  await page.setViewportSize({ width: 393, height: 852 })
  await viewer.getByLabel('Viewport', { exact: true }).selectOption('fill')
  await until(async () => (await canvas.getAttribute('data-viewport-width')) === '393')
  await page.screenshot({ path: 'work/design/remote-browser/mobile-canvas.png' })
  await viewer.getByRole('button', { name: 'Close browser session' }).click()
  // This isolated viewer does not include the app wrapper; call its corresponding endpoint.
  await call('/api/previews/browser/close', { taskId: 'browser-task' })
  await until(
    async () => await viewer.getByRole('button', { name: 'Reconnect', exact: true }).isVisible(),
  )
  assert.deepEqual(errors, [])
  await writeFile(
    'work/design/remote-browser/verification.json',
    JSON.stringify(
      {
        authentication: true,
        frames: true,
        input: true,
        navigation: true,
        resize: true,
        reconnect: true,
        closed: true,
        errors,
      },
      null,
      2,
    ),
  )
  console.log('Remote browser verification passed')
} catch (error) {
  if (page) {
    await mkdir('work/design/remote-browser', { recursive: true })
    await page.screenshot({ path: 'work/design/remote-browser/failure.png' })
    console.error(
      'Viewer failure state:',
      await page.frameLocator('iframe').locator('body').innerText(),
      errors,
    )
    console.error(
      'Canvas:',
      await page.frameLocator('iframe').locator('canvas').getAttribute('data-viewport-width'),
      await page.frameLocator('iframe').locator('canvas').getAttribute('data-viewport-height'),
    )
  }
  throw error
} finally {
  await browser?.close()
  await runtime.close()
  await new Promise((resolve) => site.close(resolve))
}
async function until(test) {
  const end = Date.now() + 15000
  while (!(await test())) {
    if (Date.now() > end) throw new Error('Browser assertion timed out')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}
