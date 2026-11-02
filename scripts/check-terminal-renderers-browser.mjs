import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite-plus'

const root = process.cwd()
const server = await createServer({
  configFile: false,
  root,
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0 },
  plugins: [
    {
      name: 'renderer-smoke-fixture',
      configureServer(vite) {
        vite.middlewares.use('/renderer-smoke', (_request, response) => {
          response.setHeader('content-type', 'text/html')
          response.end(
            '<!doctype html><meta charset="utf-8"><title>Terminal renderer smoke</title><body style="background:#444"></body>',
          )
        })
      },
    },
  ],
})
await server.listen()
const address = server.httpServer.address()
if (!address || typeof address === 'string') throw new Error('Vite did not provide a TCP address')
const browser = await chromium.launch({
  args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader'],
})
try {
  const page = await browser.newPage({
    viewport: { width: 400, height: 300 },
    deviceScaleFactor: 1,
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${address.port}/renderer-smoke`)
  const gpuUnavailable = await page.evaluate(async () => {
    try {
      if (!navigator.gpu) return 'no navigator.gpu'
      const a = await navigator.gpu.requestAdapter()
      if (!a) return 'no adapter'
      const d = await a.requestDevice()
      const c = new OffscreenCanvas(4, 4)
      const ctx = c.getContext('webgpu')
      if (!ctx) return 'no context'
      ctx.configure({
        device: d,
        format: navigator.gpu.getPreferredCanvasFormat(),
        alphaMode: 'opaque',
      })
      const encoder = d.createCommandEncoder()
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: ctx.getCurrentTexture().createView(),
            clearValue: [1, 0, 0, 1],
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      })
      pass.end()
      d.queue.submit([encoder.finish()])
      const bitmap = c.transferToImageBitmap()
      const target = new OffscreenCanvas(4, 4).getContext('2d')
      target.drawImage(bitmap, 0, 0)
      const pixel = Array.from(target.getImageData(0, 0, 1, 1).data)
      await d.queue.onSubmittedWorkDone()
      d.destroy()
      return pixel[0] === 255 && pixel[3] === 255
        ? null
        : `WebGPU baseline readback was ${pixel.join(',')}`
    } catch (error) {
      return `WebGPU baseline failed: ${String(error)}`
    }
  })
  const results = await page.evaluate(async (gpuUnavailable) => {
    const { createTerminalRenderer } =
      await import('/packages/terminal/src/browser/renderers/index.ts')
    const counts = { pages: 0, webglUploads: 0, webgpuUploads: 0 }
    const NativeCanvas = window.OffscreenCanvas
    window.OffscreenCanvas = class extends NativeCanvas {
      constructor(width, height) {
        super(width, height)
        if (width === 1024 && height === 1024) counts.pages++
      }
    }
    const glUpload = WebGL2RenderingContext.prototype.texSubImage2D
    WebGL2RenderingContext.prototype.texSubImage2D = function (...args) {
      counts.webglUploads++
      return glUpload.apply(this, args)
    }
    if (window.GPUQueue) {
      const gpuUpload = GPUQueue.prototype.copyExternalImageToTexture
      GPUQueue.prototype.copyExternalImageToTexture = function (...args) {
        counts.webgpuUploads++
        return gpuUpload.apply(this, args)
      }
    }
    const options = {
      fontFamily: 'monospace',
      fontSize: 18,
      cellWidth: 20,
      cellHeight: 28,
      baseline: 21,
      devicePixelRatio: 1,
      background: '#123456',
      cursor: '#ff00ff',
    }
    const cell = (text, extra = {}) => ({
      text,
      width: 1,
      foreground: '#ffffff',
      background: '#123456',
      flags: 0,
      ...extra,
    })
    const frame = {
      cols: 8,
      rows: 2,
      cells: [
        [
          cell('A'),
          cell('B', { background: '#008800' }),
          cell('U', { flags: 4 }),
          cell('S', { flags: 8 }),
          cell('😀', { width: 2 }),
          cell('', { width: 0 }),
          cell('C'),
          cell(' '),
        ],
        [cell('x'), cell(' '), cell(' '), cell(' '), cell(' '), cell(' '), cell(' '), cell(' ')],
      ],
      cursor: { x: 4, y: 0, visible: true, style: 'block' },
    }
    const out = []
    for (const preferred of ['canvas2d', 'webgpu', 'webgl2']) {
      if (preferred === 'webgpu' && gpuUnavailable) {
        out.push({ preferred, skipped: gpuUnavailable })
        continue
      }
      const canvas = new OffscreenCanvas(160, 56)
      const losses = []
      let renderer
      try {
        renderer = await createTerminalRenderer(canvas, preferred, (error) =>
          losses.push(error.message),
        )
      } catch (error) {
        out.push({ preferred, error: String(error) })
        continue
      }
      if (renderer.kind !== preferred) {
        const supported = preferred === 'webgpu' || !!new NativeCanvas(1, 1).getContext(preferred)
        out.push(
          supported
            ? { preferred, error: `capability is available but factory selected ${renderer.kind}` }
            : { preferred, skipped: `${preferred} context is unavailable` },
        )
        renderer.dispose()
        continue
      }
      renderer.resize(160, 56)
      renderer.render(frame, options)
      const visible = document.createElement('canvas')
      visible.width = 160
      visible.height = 56
      visible.title = preferred
      document.body.append(visible, document.createElement('br'))
      const context = visible.getContext('2d', { willReadFrequently: true })
      const bitmap = await createImageBitmap(canvas)
      context.drawImage(bitmap, 0, 0)
      bitmap.close()
      const sample = (x, y) => Array.from(context.getImageData(x, y, 1, 1).data)
      const pixels = context.getImageData(0, 0, 160, 56).data
      let white = 0,
        colored = 0
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] > 220 && pixels[i + 1] > 220 && pixels[i + 2] > 220) white++
        if (pixels[i] !== 18 || pixels[i + 1] !== 52 || pixels[i + 2] !== 86) colored++
      }
      const firstCounts = { ...counts }
      renderer.render(frame, options)
      const secondCounts = { ...counts }
      const secondBitmap = await createImageBitmap(canvas)
      context.drawImage(secondBitmap, 0, 0)
      secondBitmap.close()
      const secondBackground = sample(1, 1)
      const beforeLoss = {
        background: sample(1, 1),
        green: sample(21, 1),
        underline: sample(41, 25),
        strike: sample(61, 14),
        cursorLeft: sample(81, 1),
        cursorRight: sample(119, 1),
        white,
        colored,
      }
      const fractional = []
      for (const dpr of [1, 1.25, 2])
        for (const selected of [false, true]) {
          const fracOptions = {
            ...options,
            cellWidth: 7.2246,
            cellHeight: 17,
            fontSize: 12,
            baseline: 13,
            devicePixelRatio: dpr,
          }
          const background = selected ? '#32608f' : '#123456'
          const fracCell = () => cell(' ', { background })
          const fracFrame = {
            cols: 60,
            rows: 2,
            cells: [
              Array.from({ length: 60 }, fracCell),
              Array.from({ length: 60 }, (_, i) =>
                cell('fractional text 你好 '[i % 19] ?? ' ', { background }),
              ),
            ],
            cursor: { x: 0, y: 0, visible: false, style: 'block' },
          }
          const w = Math.ceil(fracFrame.cols * fracOptions.cellWidth * dpr),
            h = Math.ceil(fracFrame.rows * fracOptions.cellHeight * dpr)
          renderer.resize(w, h)
          renderer.render(fracFrame, fracOptions)
          const dest = document.createElement('canvas')
          dest.width = w
          dest.height = h
          const destCtx = dest.getContext('2d', { willReadFrequently: true })
          const image = await createImageBitmap(canvas)
          destCtx.drawImage(image, 0, 0)
          image.close()
          const y = Math.floor(8 * dpr)
          const data = destCtx.getImageData(
            0,
            y,
            Math.floor(fracFrame.cols * fracOptions.cellWidth * dpr),
            1,
          ).data
          const expected = selected ? [50, 96, 143, 255] : [18, 52, 86, 255]
          const failures = []
          for (let x = 0; x < data.length / 4; x++)
            if (expected.some((v, i) => data[x * 4 + i] !== v)) {
              if (failures.length < 5)
                failures.push({ x, color: Array.from(data.slice(x * 4, x * 4 + 4)) })
            }
          fractional.push({ dpr, selected, failures })
          if (dpr === 1) {
            dest.id = `fractional-${preferred}-${selected ? 'selected' : 'unselected'}`
            document.body.append(dest, document.createElement('br'))
          }
        }
      if (preferred === 'webgl2') {
        const gl = canvas.getContext('webgl2')
        const extension = gl?.getExtension('WEBGL_lose_context')
        if (!extension) throw new Error('WEBGL_lose_context is unavailable')
        extension.loseContext()
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('WebGL loss callback timed out')), 3000)
          canvas.addEventListener(
            'webglcontextlost',
            () => {
              clearTimeout(timeout)
              resolve()
            },
            { once: true },
          )
        })
      }
      renderer.dispose()
      out.push({
        preferred,
        kind: renderer.kind,
        beforeLoss,
        secondBackground,
        firstCounts,
        secondCounts,
        losses,
        fractional,
      })
    }
    return out
  }, gpuUnavailable)
  await page.screenshot({ path: '/tmp/dovo-terminal-renderers-smoke.png' })
  for (const state of ['selected', 'unselected']) {
    const target = page.locator(`#fractional-webgl2-${state}`)
    if (await target.count())
      await target.screenshot({ path: `/tmp/dovo-renderer-webgl2-${state}.png` })
  }
  assert.deepEqual(errors, [], `Browser errors: ${errors.join('; ')}`)
  for (const result of results) {
    if (result.skipped) {
      console.log(`${result.preferred}: skipped (${result.skipped})`)
      continue
    }
    assert.equal(result.error, undefined, `${result.preferred}: ${result.error}`)
    const pixels = result.beforeLoss
    assert.deepEqual(pixels.background, [18, 52, 86, 255], `${result.preferred} background`)
    assert.deepEqual(result.secondBackground, [18, 52, 86, 255], `${result.preferred} second frame`)
    assert.deepEqual(pixels.green, [0, 136, 0, 255], `${result.preferred} cell background`)
    assert.deepEqual(pixels.underline, [255, 255, 255, 255], `${result.preferred} underline`)
    assert.deepEqual(pixels.strike, [255, 255, 255, 255], `${result.preferred} strike`)
    assert.deepEqual(pixels.cursorLeft, [255, 0, 255, 255], `${result.preferred} cursor left`)
    assert.deepEqual(
      pixels.cursorRight,
      [255, 0, 255, 255],
      `${result.preferred} cursor wide right`,
    )
    assert.ok(
      pixels.white > 20 && pixels.colored > 500,
      `${result.preferred} glyphs/colored pixels`,
    )
    if (result.preferred !== 'canvas2d') {
      assert.equal(
        result.secondCounts.pages,
        result.firstCounts.pages,
        `${result.preferred} recreated atlas pages`,
      )
      const key = result.preferred === 'webgl2' ? 'webglUploads' : 'webgpuUploads'
      assert.equal(
        result.secondCounts[key],
        result.firstCounts[key],
        `${result.preferred} reuploaded an unchanged atlas`,
      )
    }
    for (const sample of result.fractional)
      assert.deepEqual(
        sample.failures,
        [],
        `${result.preferred}: fractional backgrounds at DPR ${sample.dpr}, selected=${sample.selected}: ${JSON.stringify(sample.failures)}`,
      )
    if (result.preferred === 'webgl2') assert.match(result.losses[0] ?? '', /context lost/i)
    console.log(
      `${result.preferred}: rendered${result.preferred !== 'canvas2d' ? '; atlas reused' : ''}${result.preferred === 'webgl2' ? '; context loss reported' : ''}`,
    )
  }
  console.log('Screenshot: /tmp/dovo-terminal-renderers-smoke.png')
} finally {
  await browser.close()
  await server.close()
}
