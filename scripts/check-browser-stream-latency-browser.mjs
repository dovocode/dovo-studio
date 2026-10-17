// Real WebSocket flow control and canvas decoder, with a synthetic 60Hz JPEG
// source and emulated network delay. Excludes host capture and physical networks.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { chromium } from './browser/harness.mjs'
import { attachBrowserSocket } from '../packages/runtime/dist/http/support/browser-socket.js'
import { remoteBrowserHtml } from '../packages/protocol/dist/generated/browser-viewer.js'
const require = createRequire(new URL('../packages/runtime/package.json', import.meta.url))
const { WebSocketServer } = require('ws')
const sharp = require('sharp')
const width = 480,
  height = 320
const images = await Promise.all(
  Array.from({ length: 256 }, async (_, id) => {
    const pixels = Buffer.alloc(width * height * 3, 32)
    for (let bit = 0; bit < 8; bit++)
      for (let y = 0; y < 40; y++)
        pixels.fill(
          id & (1 << bit) ? 255 : 0,
          (y * width + bit * 50) * 3,
          (y * width + bit * 50 + 40) * 3,
        )
    const jpeg = await sharp(pixels, { raw: { width, height, channels: 3 } })
      .jpeg({ quality: 70 })
      .toBuffer()
    // Test-only ID after JPEG end-of-image; avoids GPU pixel readbacks that
    // would contaminate the very decoder timing this benchmark measures.
    return Buffer.concat([jpeg, Buffer.from([id])])
  }),
)
let publish
let observeInput = () => {}
// Only the frame source is a fixture; ticket/auth coverage lives in browser.test
// and verify-remote-browser. Every frame uses the production socket/decoder path.
const services = {
  devices: { authenticate() {} },
  store: { taskSummary() {} },
  browsers: {
    async attach(_id, listener) {
      publish = listener
      listener({
        type: 'state',
        url: 'http://fixture/',
        title: 'Latency fixture',
        back: false,
        forward: false,
        loading: false,
        editable: false,
      })
      return () => {
        publish = undefined
      }
    },
    async input(_id, input, authorize) {
      authorize()
      observeInput(input)
    },
  },
}
const server = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html')
  response.end(remoteBrowserHtml)
})
const sockets = new WebSocketServer({ server })
sockets.on('connection', (client) =>
  attachBrowserSocket(
    client,
    'task',
    'token',
    services,
    true,
    undefined,
    undefined,
    undefined,
    true,
  ),
)
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = `127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ headless: true })
try {
  const reports = []
  for (const scenario of [
    { name: 'legacy-two-frame', legacy: true, decodeDelay: 0 },
    { name: 'adaptive', legacy: false, decodeDelay: 0 },
    { name: 'slow-decoder', legacy: false, decodeDelay: 80 },
    { name: 'limited-legacy', legacy: true, decodeDelay: 0, mbps: 2 },
    { name: 'limited-adaptive', legacy: false, decodeDelay: 0, mbps: 2 },
    { name: 'decoder-slows', legacy: false, decodeDelay: 0, slows: true },
  ]) {
    const page = await browser.newPage({ viewport: { width, height: 400 } })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.addInitScript(({ legacy, decodeDelay, mbps }) => {
      window.draws = []
      window.decodeSamples = []
      window.movementDelays = []
      window.decodeDelay = decodeDelay
      let available = 0
      const NativeSocket = WebSocket
      window.WebSocket = class extends NativeSocket {
        set onmessage(handler) {
          super.onmessage = (event) => {
            const now = performance.now()
            const transfer = mbps
              ? ((event.data.byteLength ?? event.data.length) * 8) / (mbps * 1000)
              : 0
            available = Math.max(now, available) + transfer
            setTimeout(() => handler(event), 40 + available - now)
          }
        }
        send(data) {
          const value = JSON.parse(data)
          if (value.type === 'scroll')
            window.movementDelays.push(performance.now() - window.inputStarted)
          if (value.type === 'frameAck' && !value.dropped) window.decodeSamples.push(value.decodeMs)
          if (legacy) delete value.decodeMs
          setTimeout(() => {
            if (this.readyState === NativeSocket.OPEN) super.send(JSON.stringify(value))
          }, 40)
        }
      }
      const decode = window.createImageBitmap.bind(window)
      const ids = new WeakMap()
      window.createImageBitmap = async (blob, ...args) => {
        const data = new Uint8Array(await blob.arrayBuffer())
        if (window.decodeDelay)
          await new Promise((resolve) => setTimeout(resolve, window.decodeDelay))
        const image = await decode(blob, ...args)
        ids.set(image, data.at(-1))
        return image
      }
      const draw = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'drawImage')
      if (!draw) throw new Error('Canvas drawImage is unavailable')
      CanvasRenderingContext2D.prototype.drawImage = function (...args) {
        draw.value.apply(this, args)
        window.draws.push({ id: ids.get(args[0]), at: Date.now() })
      }
    }, scenario)
    await page.goto(`http://${address}/`)
    await page.evaluate(
      (url) => window.postMessage({ channel: 'dovo-browser', type: 'connect', url }, '*'),
      `ws://${address}/`,
    )
    await page.waitForFunction(() => !document.querySelector('#go').disabled)
    await page.waitForTimeout(150)
    const sent = new Map()
    for (let index = 0; index < 180; index++) {
      if (scenario.slows && index === 60)
        await page.evaluate(() => {
          window.decodeDelay = 80
        })
      sent.set(index, Date.now())
      const data = scenario.mbps
        ? Buffer.concat([images[index], Buffer.alloc(24 * 1024 - images[index].length)])
        : images[index]
      data[data.length - 1] = index
      publish({ type: 'frame', width, height, data })
      await new Promise((resolve) => setTimeout(resolve, 16))
    }
    await page.waitForTimeout(scenario.mbps ? 1200 : 400)
    const draws = await page.evaluate(() => window.draws)
    const ages = draws.map((frame) => frame.at - sent.get(frame.id)).sort((a, b) => a - b)
    const steady = draws.filter((frame) => frame.id >= 90)
    const steadyAges = steady.map((frame) => frame.at - sent.get(frame.id)).sort((a, b) => a - b)
    const duration = sent.get(179) - sent.get(0)
    const decodeSamples = (await page.evaluate(() => window.decodeSamples)).sort((a, b) => a - b)
    reports.push({
      scenario: scenario.name,
      emulatedRttMs: 80,
      decodeP95Ms: Math.round(decodeSamples[Math.floor(decodeSamples.length * 0.95)]),
      sourceFrames: 180,
      renderedFrames: draws.length,
      renderedFps: Math.round((draws.length * 1000) / duration),
      frameAgeMedianMs: ages[Math.floor(ages.length / 2)],
      frameAgeP95Ms: ages[Math.floor(ages.length * 0.95)],
      steadyFrameAgeP95Ms: steadyAges[Math.floor(steadyAges.length * 0.95)],
      steadyRenderedFps: Math.round((steady.length * 1000) / (sent.get(179) - sent.get(90))),
    })
    if (scenario.name === 'adaptive') {
      await page.waitForFunction(() =>
        /\d+ ms RTT/.test(document.querySelector('#streamSummary').textContent),
      )
      await page.locator('#streamSummary').click()
      assert.match(
        await page.locator('#streamDetails').textContent(),
        /Capture time and screen presentation are not measured/,
      )
      assert.match(await page.locator('#streamDetails').textContent(), /Decode and draw: [\d.]+ ms/)
      await page.waitForFunction(() =>
        document.querySelector('#streamSummary').textContent.startsWith('Idle'),
      )
      assert.equal(
        await page
          .locator('#streamPerformance')
          .evaluate((el) => el.getBoundingClientRect().right <= innerWidth),
        true,
      )
      const arrived = new Promise((resolve) => {
        observeInput = (input) => {
          if (input.type === 'scroll' && input.deltaY === 20) resolve()
        }
      })
      // Input dispatch must not wait for requestAnimationFrame, even at low FPS.
      await page.evaluate(() => {
        window.animationWaits = 0
        window.requestAnimationFrame = () => {
          window.animationWaits++
          return 1
        }
        window.inputStarted = performance.now()
        document
          .querySelector('canvas')
          .dispatchEvent(
            new WheelEvent('wheel', { deltaY: 20, clientX: 10, clientY: 10, cancelable: true }),
          )
      })
      const delays = await page.evaluate(() => window.movementDelays)
      assert.equal(delays.length, 1, 'leading input was deferred')
      assert.equal(await page.evaluate(() => window.animationWaits), 0)
      reports.at(-1).viewerInputDispatchMs = Number(delays[0].toFixed(2))
      let timeout
      try {
        await Promise.race([
          arrived,
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error('Scroll did not reach the runtime')), 2000)
          }),
        ])
      } finally {
        clearTimeout(timeout)
      }
    }
    assert.deepEqual(errors, [])
    await page.close()
    // Allow server-side detach to finish before starting the next viewer.
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  console.log(
    JSON.stringify(
      {
        scope:
          'Synthetic JPEG source; real transport/canvas; 40ms delay each way; limited cases add 2Mbps serialization with 24KiB frames',
        reports,
      },
      null,
      2,
    ),
  )
  assert.ok(
    reports[1].renderedFrames > reports[0].renderedFrames * 1.5,
    'high-RTT frame flow did not improve',
  )
  assert.ok(
    reports[1].frameAgeP95Ms <= reports[0].frameAgeP95Ms + 20,
    'pipelining built a stale frame queue',
  )
  assert.ok(reports[2].renderedFps <= 15, 'slow decoder unexpectedly bypassed decoder backpressure')
  assert.ok(
    reports[4].steadyFrameAgeP95Ms <= reports[3].steadyFrameAgeP95Ms + 80,
    'bandwidth-limited flow built a stale frame queue',
  )
  assert.ok(reports[5].steadyRenderedFps <= 15, 'flow failed to contract after the decoder slowed')
} finally {
  await browser.close()
  for (const client of sockets.clients) client.terminate()
  sockets.close()
  const closed = once(server, 'close')
  server.close()
  await closed
}
