import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

// Run the actual, generated mobile WebView document, including embedded font bytes.
const html = JSON.parse(
  await readFile(new URL('../apps/mobile/assets/terminal.json', import.meta.url), 'utf8'),
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  const requests = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => requests.push(request.url()))
  await page.addInitScript(() => {
    window.messages = []
    window.sockets = []
    window.ReactNativeWebView = { postMessage: (text) => window.messages.push(JSON.parse(text)) }
    window.WebSocket = class {
      static OPEN = 1
      readyState = 1
      sent = []
      constructor() {
        window.sockets.push(this)
        setTimeout(() => {
          this.onopen?.()
          this.onmessage?.({ data: 'session preserved \ue0a0 main \uf07b src\r\n' })
        }, 0)
      }
      send(text) {
        const message = JSON.parse(text)
        this.sent.push(message)
        if (message.type === 'ping')
          setTimeout(
            () =>
              this.onmessage?.({
                data: new TextEncoder().encode(
                  JSON.stringify({ type: 'pong', nonce: message.nonce }),
                ).buffer,
              }),
            0,
          )
      }
      close() {
        this.readyState = 3
      }
    }
  })
  await page.route('http://terminal-fonts.test/', (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  )
  await page.goto('http://terminal-fonts.test/')
  await page.waitForFunction(() => window.messages.some((message) => message.type === 'ready'))
  await page.evaluate(() => window.connectTerminal('ws://fixture/terminal', 1))
  await page.waitForFunction(() =>
    document.querySelector('.xterm-rows')?.textContent.includes('session preserved'),
  )
  const before = await page.evaluate(() =>
    window.sockets[0].sent.filter((message) => message.type === 'resize').at(-1),
  )
  await page.evaluate(() => window.setTerminalFont('JetBrains Mono Nerd Font', 18))
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('.xterm-rows')).fontSize === '18px',
  )
  const after = await page.evaluate(async () => {
    await document.fonts.ready
    return {
      font: getComputedStyle(document.querySelector('.xterm-rows')).fontFamily,
      faces: [...document.fonts].map((font) => font.status),
      sockets: window.sockets.length,
      connected: window.sockets[0].readyState === 1,
      text: document.querySelector('.xterm-rows').textContent,
      resize: window.sockets[0].sent.filter((message) => message.type === 'resize').at(-1),
      errors: window.messages.filter((message) => message.error),
    }
  })
  assert.ok(after.font.includes('JetBrains Mono Nerd Font'))
  assert.deepEqual(after.faces, ['loaded', 'loaded'])
  assert.equal(after.sockets, 1)
  assert.equal(after.connected, true)
  assert.ok(after.text.includes('session preserved'))
  assert.ok(
    after.resize.cols < before.cols && after.resize.rows < before.rows,
    'Larger font resizes the existing PTY',
  )
  assert.deepEqual(after.errors, [])
  assert.deepEqual(
    requests,
    ['http://terminal-fonts.test/'],
    'Bundled terminal and fonts make no network requests',
  )
  await page.evaluate(() => window.setTerminalFont('', 12))
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('.xterm-rows')).fontSize === '12px',
  )
  assert.ok(
    await page
      .locator('.xterm-rows')
      .textContent()
      .then((text) => text.includes('session preserved')),
  )
  assert.equal(await page.evaluate(() => window.sockets.length), 1)
  assert.deepEqual(errors, [])
  console.log(
    'Mobile terminal: offline bundled Nerd Font, regular/bold loading, live font and size changes, PTY resizing and session continuity passed.',
  )
} finally {
  await browser.close()
}
