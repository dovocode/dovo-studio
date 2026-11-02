import assert from 'node:assert/strict'
import { createServer } from 'vite-plus'
import { chromium } from 'playwright'
import { WebSocketServer } from 'ws'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { encodeTerminalStreamFrame } from '../packages/protocol/dist/index.js'

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const server = await createServer({
  configFile: false,
  root,
  server: { host: '127.0.0.1', port: 0, fs: { allow: [root] } },
  logLevel: 'error',
  plugins: [
    {
      name: 'terminal-fixture',
      configureServer(server) {
        server.middlewares.use('/ghostty-check', serveFixture)
        server.middlewares.use('/xterm-check', serveXtermFixture)
      },
    },
  ],
})
const peers = new Set()
const received = []
const payload =
  Array.from({ length: 16000 }, (_, index) => `line-${index}: λ 漢字 🙂 output\r\n`).join('') +
  'GHOSTTY_REPLAY_END\r\n'
const sockets = new WebSocketServer({ port: 0, host: '127.0.0.1' })
await once(sockets, 'listening')
const socketPort = sockets.address().port
let totalAck = 0
sockets.on('connection', (socket) => {
  peers.add(socket)
  const send = (frame) => socket.send(encodeTerminalStreamFrame(frame))
  send({ type: 'replayStart' })
  const bytes = new TextEncoder().encode(payload)
  for (let offset = 0; offset < bytes.length;) {
    let end = Math.min(bytes.length, offset + 16384)
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--
    send({ type: 'data', data: bytes.subarray(offset, end) })
    offset = end
  }
  send({ type: 'replayEnd' })
  socket.on('message', (raw) => {
    const value = JSON.parse(raw.toString())
    received.push(value)
    if (value.type === 'ping') send({ type: 'pong', nonce: value.nonce })
    if (value.type === 'ack') totalAck += value.bytes
    if (value.type === 'input') send({ type: 'data', data: new TextEncoder().encode(value.data) })
  })
  socket.on('close', () => peers.delete(socket))
})
function serveFixture(_request, response) {
  response.setHeader('Content-Type', 'text/html')
  response.end(`<!doctype html><style>html,body{margin:0;width:100%;height:100%;background:#101113}#terminal{height:300px;width:800px}</style><div id="terminal"></div><script type="module">
import {BrowserTerminal} from '/packages/terminal/src/browser/index.ts';
import '/packages/terminal/src/browser/styles.css';
import {terminalFontSources} from '/packages/studio-ui/src/terminal-fonts.ts';window.fontSources=terminalFontSources;
window.errors=[];window.frames=[];window.maxGap=0;let last=performance.now();setInterval(()=>{const now=performance.now();window.maxGap=Math.max(window.maxGap,now-last);last=now},10);
window.term=new BrowserTerminal({fontFamily:'monospace',fontSize:12,theme:{background:'#101113',foreground:'#ededee',cursor:'#eeeeee',selectionBackground:'#446688'},scrollbackBytes:16*1024*1024,renderer:new URLSearchParams(location.search).get('renderer')||undefined});
term.onError=error=>window.errors.push(error.message);term.onViewport=frame=>{window.lastFrame=frame;window.frames.push(performance.now());};term.open(document.getElementById('terminal'));
window.abort=new AbortController();await term.ready;window.started=performance.now();window.maxGap=0;
term.connect('ws://127.0.0.1:${socketPort}/ws/terminal?ticket=fixture&stream=binary-v1',abort.signal,()=>{window.connected=true}).catch(error=>window.errors.push(error.message));
</script>`)
}
function serveXtermFixture(_request, response) {
  response.setHeader('Content-Type', 'text/html')
  response.end(`<!doctype html><style>html,body{margin:0;background:#101113}#terminal{height:300px;width:788px}</style><div id="terminal"></div><script type="module">
import {Terminal} from '/apps/mobile/node_modules/@xterm/xterm/lib/xterm.mjs';
import '/apps/mobile/node_modules/@xterm/xterm/css/xterm.css';
const term=new Terminal({cols:109,rows:18,fontSize:12,fontFamily:'monospace',scrollback:5000});term.open(document.getElementById('terminal'));
window.maxGap=0;let last=performance.now();setInterval(()=>{const now=performance.now();window.maxGap=Math.max(window.maxGap,now-last);last=now},10);
const socket=new WebSocket('ws://127.0.0.1:${socketPort}/ws/terminal?ticket=fixture&stream=binary-v1');socket.binaryType='arraybuffer';
window.started=performance.now();socket.onmessage=event=>{const data=new Uint8Array(event.data);if(data[0]===0)term.write(data.subarray(1));if(data[0]===2)term.write('',()=>{window.result={renderer:'previous xterm DOM',replayMs:Math.round(performance.now()-window.started),history:term.buffer.active.baseY};setTimeout(()=>{window.result.maxMainThreadGapMs=Math.round(window.maxGap);window.replayFinished=true},30)})};
</script>`)
}
async function screenshotGlyphs(page, screenshot) {
  return await page.evaluate(async (base64) => {
    const bitmap = await createImageBitmap(
      await (await fetch('data:image/png;base64,' + base64)).blob(),
    )
    const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')
    context.drawImage(bitmap, 0, 0)
    bitmap.close()
    const data = context.getImageData(
      0,
      0,
      Math.min(120, context.canvas.width),
      context.canvas.height,
    ).data
    let white = 0
    for (let i = 0; i < data.length; i += 4)
      if (data[i] > 150 && data[i + 1] > 150 && data[i + 2] > 150) white++
    return white
  }, screenshot.toString('base64'))
}
await server.listen()
const address = server.httpServer.address()
const browser = await chromium.launch({
  args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader'],
})
try {
  const baseline = await browser.newPage()
  await baseline.goto(`http://127.0.0.1:${address.port}/xterm-check`)
  await baseline.waitForFunction(() => window.replayFinished)
  console.log(JSON.stringify(await baseline.evaluate(() => window.result)))
  await baseline.close()
  for (const renderer of ['canvas2d', 'webgl2', 'webgpu']) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 600 } })
    page.on('pageerror', (error) => console.error(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error')
        console.error('Browser console:', message.text(), JSON.stringify(message.location()))
    })
    page.on('requestfailed', (request) =>
      console.error('Request failed:', request.url(), request.failure()),
    )
    page.on('response', (response) => {
      if (response.status() >= 400) console.error('HTTP error:', response.status(), response.url())
    })
    await page.goto(`http://127.0.0.1:${address.port}/ghostty-check?renderer=${renderer}`)
    await page
      .waitForFunction(
        () => window.lastFrame?.lines.some((line) => line.text.includes('GHOSTTY_REPLAY_END')),
        {},
        { timeout: 30000 },
      )
      .catch(async (error) => {
        console.error(
          await page.evaluate(() => ({
            errors: window.errors,
            frame: window.lastFrame,
            body: document.body.innerText,
            term: !!window.term,
          })),
        )
        throw error
      })
    assert.deepEqual(await page.evaluate(() => window.errors), [])
    const result = await page.evaluate(() => ({
      requested: new URLSearchParams(location.search).get('renderer'),
      actual: term.renderer,
      replayMs: Math.round(performance.now() - window.started),
      maxMainThreadGapMs: Math.round(window.maxGap),
      history: window.lastFrame.history,
    }))
    assert.ok(result.history > 5000)
    if (renderer === 'canvas2d') assert.equal(result.actual, 'canvas2d')
    if (renderer === 'webgl2') assert.equal(result.actual, 'webgl2')
    await page.evaluate(() => term.focus())
    await page.keyboard.type('GHOSTTY_INPUT')
    await page.keyboard.press('Enter')
    await page.waitForFunction(() =>
      window.lastFrame.lines.some((line) => line.text.includes('GHOSTTY_INPUT')),
    )
    assert.ok(received.some((value) => value.type === 'resize'))
    assert.ok(received.some((value) => value.type === 'input' && value.data === '\r'))
    const wrappedText = 'GHOSTTY_WRAPPED_' + 'abc'.repeat(400) + '_END'
    const wrapOutput =
      '\r\n' +
      wrappedText +
      '\r\n' +
      Array.from({ length: 30 }, () => 'after wrap\r\n').join('') +
      'AFTER_WRAP\r\n'
    for (const peer of peers)
      peer.send(
        encodeTerminalStreamFrame({ type: 'data', data: new TextEncoder().encode(wrapOutput) }),
      )
    await page.waitForFunction(() =>
      window.lastFrame.lines.some((line) => line.text.includes('AFTER_WRAP')),
    )
    await page.evaluate(() => term.selectAll())
    await page.waitForFunction(() => term.getSelection().includes('GHOSTTY_REPLAY_END'))
    assert.ok(
      await page.evaluate((text) => term.getSelection().includes(text), wrappedText),
      'Soft-wrapped scrollback copies as one logical line',
    )
    await page.evaluate(() => {
      term.post({ type: 'clearSelection' })
      term.scrollToBottom()
    })
    await page.waitForFunction(
      async () => {
        const canvas = document.querySelector('.dovo-terminal-canvas')
        const bitmap = await createImageBitmap(canvas)
        const target = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')
        target.drawImage(bitmap, 0, 0)
        bitmap.close()
        const pixels = target.getImageData(0, 0, Math.min(120, canvas.width), canvas.height).data
        let light = 0
        for (let i = 0; i < pixels.length; i += 4)
          if (pixels[i] > 150 && pixels[i + 1] > 150 && pixels[i + 2] > 150) light++
        return light > 50
      },
      {},
      { timeout: 10000 },
    )
    const screenshot = await page
      .locator('.dovo-terminal')
      .screenshot({ path: `/tmp/dovo-terminal-${renderer}.png` })
    const visiblePixels = await screenshotGlyphs(page, screenshot)
    assert.ok(
      visiblePixels > 50,
      `${renderer}: compositor screenshot must show terminal glyphs (actual ${await page.evaluate(() => term.renderer)})`,
    )
    if (renderer === 'canvas2d') {
      const worker = page.workers()[0]
      await worker.evaluate(() => {
        self.originalFontLoad = FontFace.prototype.load
        self.fontHeld = new Promise((resolve) => {
          self.fontLoadHeld = resolve
        })
        FontFace.prototype.load = async function () {
          const face = await self.originalFontLoad.call(this)
          self.fontLoadHeld()
          await new Promise((resolve) => {
            self.releaseFontLoad = resolve
          })
          return face
        }
      })
      await page.evaluate(() =>
        term.configure({
          ...term.options,
          fontFamily: 'monospace, "' + window.fontSources[0].family + '"',
          fonts: [window.fontSources[0]],
        }),
      )
      await worker.evaluate(() =>
        Promise.race([
          self.fontHeld,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Font did not reach the held load barrier')), 10000),
          ),
        ]),
      )
      for (const peer of peers)
        peer.send(
          encodeTerminalStreamFrame({
            type: 'data',
            data: new TextEncoder().encode('FONT_LOADING_OUTPUT\r\n'),
          }),
        )
      await page.waitForFunction(() =>
        window.lastFrame.lines.some((line) => line.text.includes('FONT_LOADING_OUTPUT')),
      )
      await page.evaluate(() => {
        window.beforeFontRelease = frames.length
      })
      await worker.evaluate(() => {
        FontFace.prototype.load = self.originalFontLoad
        self.releaseFontLoad()
      })
      await page.waitForFunction(() => frames.length > window.beforeFontRelease)
    }
    await page.evaluate(() =>
      term.configure({
        ...term.options,
        fontFamily: '"JetBrains Mono Nerd Font", monospace',
        fontSize: 18,
        fonts: window.fontSources,
      }),
    )
    await page.waitForFunction(() => window.lastFrame.metrics.cellHeight === 24)
    assert.deepEqual(
      await page.workers()[0].evaluate(() => [...self.fonts].map((font) => font.status)),
      ['loaded', 'loaded'],
    )
    await page.evaluate(() =>
      term.configure({ ...term.options, fontFamily: 'monospace', fontSize: 12, fonts: [] }),
    )
    await page.waitForFunction(() => window.lastFrame.metrics.cellHeight === 16)
    const history = await page.evaluate(() => window.lastFrame.history)
    await page.evaluate(() => {
      window.beforeRecovery = frames.length
      term.worker.dispatchEvent(
        new MessageEvent('message', { data: { type: 'replaceCanvas', renderer: 'canvas2d' } }),
      )
    })
    await page.waitForFunction(
      () => term.renderer === 'canvas2d' && frames.length > window.beforeRecovery,
    )
    assert.equal(await page.evaluate(() => window.lastFrame.history), history)
    const recovered = await page
      .locator('.dovo-terminal')
      .screenshot({ path: `/tmp/dovo-terminal-${renderer}-recovered.png` })
    assert.ok(
      (await screenshotGlyphs(page, recovered)) > 50,
      'Software recovery paints retained output',
    )
    // A redundant layout notification must preserve retained software pixels.
    await page.evaluate(async () => {
      term.fit()
      term.fit()
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    })
    const unchanged = await page.locator('.dovo-terminal').screenshot()
    assert.deepEqual(unchanged, recovered, 'Repeated fitting preserves the rendered terminal')
    // Paint a change through the bitmap fallback, then verify it did not erase
    // previously retained rows when only the final line changed.
    for (const peer of peers)
      peer.send(
        encodeTerminalStreamFrame({
          type: 'data',
          data: new TextEncoder().encode('RETAINED_BITMAP_UPDATE'),
        }),
      )
    await page.waitForFunction(() =>
      window.lastFrame.lines.some((line) => line.text.includes('RETAINED_BITMAP_UPDATE')),
    )
    const updated = await page.locator('.dovo-terminal').screenshot()
    assert.ok(
      (await screenshotGlyphs(page, updated)) > 50,
      'Incremental software frames retain glyphs',
    )
    assert.notDeepEqual(updated, recovered, 'Changed output reaches software presentation')
    assert.deepEqual(await page.evaluate(() => window.errors), [])
    console.log(JSON.stringify(result))
    await page.evaluate(() => {
      abort.abort()
      term.dispose()
    })
    await page.close()
  }
  assert.ok(totalAck > new TextEncoder().encode(payload).length)
  console.log(
    'Ghostty worker: binary replay, Unicode, input, resize, selection, scrollback, three renderer requests and canvas replacement passed.',
  )
} finally {
  await browser.close()
  for (const peer of peers) peer.terminate()
  await new Promise((resolve) => sockets.close(resolve))
  await server.close()
}
