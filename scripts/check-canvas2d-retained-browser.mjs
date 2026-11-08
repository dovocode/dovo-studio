// Pixel comparison of the retained Canvas2D renderer against scene.ts drawFrame.
//
// For every configuration (fractional cell sizes and device pixel ratios) a
// sequence of frames is rendered three ways:
//   reference   - drawFrame on a fresh canvas (the previous Canvas2D renderer)
//   fresh       - a new createCanvas2D renderer per frame (full repaint)
//   incremental - one persistent createCanvas2D renderer across all frames
// incremental must equal fresh exactly (retained invalidation is correct), and
// fresh must match reference within CANVAS2D_TOLERANCE per channel (default 0).
// Pixels are read with getImageData, which does not disturb the retained canvas.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite-plus'

const tolerance = Number(process.env.CANVAS2D_TOLERANCE ?? 0)
const root = process.cwd()
const server = await createServer({
  configFile: false,
  root,
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0 },
  plugins: [
    {
      name: 'canvas2d-retained-fixture',
      configureServer(vite) {
        vite.middlewares.use('/canvas2d-retained', (_request, response) => {
          response.setHeader('content-type', 'text/html')
          response.end(
            '<!doctype html><meta charset="utf-8"><title>Canvas2D retained check</title><body></body>',
          )
        })
      },
    },
  ],
})
await server.listen()
const address = server.httpServer.address()
if (!address || typeof address === 'string') throw new Error('Vite did not provide a TCP address')
const browser = await chromium.launch()
let failed = false
try {
  const page = await browser.newPage({ viewport: { width: 200, height: 200 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${address.port}/canvas2d-retained`)
  const results = await page.evaluate(async () => {
    const { createCanvas2D } = await import('/packages/terminal/src/browser/renderers/canvas2d.ts')
    const { drawFrame } = await import('/packages/terminal/src/browser/renderers/scene.ts')

    let seed = 0x2545f491
    const random = () => {
      seed ^= seed << 13
      seed ^= seed >>> 17
      seed ^= seed << 5
      return (seed >>> 0) / 0x100000000
    }
    const pick = (values) => values[Math.floor(random() * values.length)]
    const COLS = 26,
      ROWS = 9
    const theme = { background: '#101820', foreground: '#d8dee9' }
    const colors = ['#d8dee9', '#ff5555', '#50fa7b', '#f1fa8c', '#bd93f9', '#8be9fd', '#ffb86c']
    const backgrounds = ['#101820', '#101820', '#101820', '#44475a', '#6272a4', '#003b46']
    const narrow = [
      'a',
      'g',
      'W',
      'M',
      'm',
      'f',
      'j',
      'i',
      '_',
      '|',
      '@',
      '0',
      'Q',
      'y',
      'é',
      'é',
      'ạ̈',
      '─',
      '│',
      '┼',
      '█',
      '▌',
      '░',
      '→',
      'λ',
      ' ',
      ' ',
      ' ',
    ]
    const wide = ['界', '漢', '🙂', '👍🏽', '🇳🇱', '한']
    // bold, italic, underline, strikethrough, invisible, faint
    const flagChoices = [0, 0, 0, 0, 1, 2, 3, 4, 8, 32, 128, 129, 2 | 4, 1 | 8]
    const blank = () => ({
      text: ' ',
      width: 1,
      foreground: theme.foreground,
      background: theme.background,
      flags: 0,
    })
    const randomRow = () => {
      const row = []
      while (row.length < COLS) {
        if (row.length + 1 < COLS && random() < 0.12) {
          const extra = {
            foreground: pick(colors),
            background: pick(backgrounds),
            flags: pick(flagChoices),
          }
          row.push({ text: pick(wide), width: 2, ...extra })
          row.push({ text: '', width: 0, ...extra })
          continue
        }
        row.push({
          text: pick(narrow),
          width: 1,
          foreground: pick(colors),
          background: pick(backgrounds),
          flags: pick(flagChoices),
        })
      }
      return row
    }
    const clone = (frame) => ({
      ...frame,
      cells: frame.cells.map((row) => row.map((cell) => ({ ...cell }))),
      cursor: { ...frame.cursor },
    })
    const setNarrow = (row, x, cell) => {
      // Replacing half of a wide cell must also repair its partner.
      if (row[x].width === 0 && x > 0) row[x - 1] = blank()
      if (row[x].width === 2 && x + 1 < COLS) row[x + 1] = blank()
      row[x] = cell
    }
    const sequence = () => {
      const frames = []
      let frame = {
        cols: COLS,
        rows: ROWS,
        cells: Array.from({ length: ROWS }, randomRow),
        cursor: { x: 3, y: 2, visible: true, style: 'block' },
      }
      const push = (label, next, options) => {
        frames.push({ label, frame: next, options })
        frame = next
      }
      push('initial', frame)
      let next = clone(frame)
      next.cursor = { x: 10, y: 5, visible: true, style: 'bar' }
      push('cursor move + bar', next)
      next = clone(frame)
      next.cursor = { x: 0, y: ROWS - 1, visible: true, style: 'underline' }
      next.cells[2] = Array.from({ length: COLS }, blank)
      push('erase row + underline cursor', next)
      next = clone(frame)
      for (const cell of next.cells[4]) {
        cell.background = pick(backgrounds)
        cell.flags = pick(flagChoices)
      }
      push('background and style change', next)
      push('identical frame', clone(frame))
      next = clone(frame)
      next.cells.shift()
      next.cells.push(randomRow())
      push('scroll by one row', next)
      next = clone(frame)
      for (let x = 0; x < COLS; x++)
        if (next.cells[3][x].width === 2) {
          setNarrow(next.cells[3], x, { ...blank(), text: 'x', foreground: '#ff5555' })
          break
        }
      push('wide cell replaced by narrow', next)
      next = clone(frame)
      setNarrow(next.cells[6], 7, {
        text: '🙂',
        width: 2,
        foreground: '#fff',
        background: '#6272a4',
        flags: 2,
      })
      setNarrow(next.cells[6], 8, {
        text: '',
        width: 0,
        foreground: '#fff',
        background: '#6272a4',
        flags: 2,
      })
      push('narrow cells replaced by emoji', next)
      next = clone(frame)
      next.cursor = { ...next.cursor, visible: false }
      push('cursor hidden', next)
      next = clone(frame)
      for (let y = 1; y <= 3; y++)
        for (let x = y === 1 ? 5 : 0; x < (y === 3 ? 12 : COLS); x++) {
          next.cells[y][x].background = '#3e4452'
          next.cells[y][x].foreground = '#ffffff'
        }
      push('selection', next)
      next = clone(frame)
      for (const row of next.cells)
        for (const cell of row)
          if (cell.background === '#3e4452') cell.background = theme.background
      next.cursor = { x: COLS - 2, y: 0, visible: true, style: 'block' }
      push('selection cleared + cursor on edge', next)
      for (let step = 0; step < 40; step++) {
        next = clone(frame)
        const edits = 1 + Math.floor(random() * 4)
        for (let edit = 0; edit < edits; edit++) {
          const y = Math.floor(random() * ROWS)
          const x = Math.floor(random() * COLS)
          setNarrow(next.cells[y], x, {
            text: pick(narrow),
            width: 1,
            foreground: pick(colors),
            background: pick(backgrounds),
            flags: pick(flagChoices),
          })
        }
        if (random() < 0.5)
          next.cursor = {
            x: Math.floor(random() * COLS),
            y: Math.floor(random() * ROWS),
            visible: random() < 0.85,
            style: pick(['block', 'bar', 'underline']),
          }
        if (random() < 0.1) next.cells[Math.floor(random() * ROWS)] = randomRow()
        push(`random edit ${step}`, next)
      }
      return frames
    }

    const measure = new OffscreenCanvas(1, 1).getContext('2d')
    measure.font = '13px monospace'
    const measured = measure.measureText('M').width
    const configs = [
      { dpr: 1, cellWidth: measured, cellHeight: 17, baseline: 13 },
      { dpr: 1.25, cellWidth: measured, cellHeight: 17, baseline: 13 },
      { dpr: 1.5, cellWidth: 7.3, cellHeight: 16.6, baseline: 12.6 },
      { dpr: 1.75, cellWidth: measured, cellHeight: 17.2, baseline: 13 },
      { dpr: 2, cellWidth: measured, cellHeight: 17, baseline: 13 },
      { dpr: 2.5, cellWidth: 7.9, cellHeight: 16.3, baseline: 12.4 },
    ]

    let clips = 0
    let clipTarget
    const nativeClip = Object.getOwnPropertyDescriptor(
      OffscreenCanvasRenderingContext2D.prototype,
      'clip',
    ).value
    OffscreenCanvasRenderingContext2D.prototype.clip = function (...args) {
      if (this === clipTarget) clips++
      return nativeClip.apply(this, args)
    }

    const pixels = (canvas) =>
      canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    const compare = (a, b, width) => {
      let max = 0,
        count = 0
      const samples = []
      for (let index = 0; index < a.length; index += 4) {
        let pixel = 0
        for (let channel = 0; channel < 4; channel++)
          pixel = Math.max(pixel, Math.abs(a[index + channel] - b[index + channel]))
        if (pixel) {
          count++
          if (samples.length < 6)
            samples.push({ x: (index / 4) % width, y: Math.floor(index / 4 / width), diff: pixel })
        }
        max = Math.max(max, pixel)
      }
      return { max, count, samples }
    }

    const results = []
    for (const config of configs) {
      seed = 0x2545f491
      const frames = sequence()
      const base = {
        fontFamily: 'monospace',
        fontSize: 13,
        cellWidth: config.cellWidth,
        cellHeight: config.cellHeight,
        baseline: config.baseline,
        devicePixelRatio: config.dpr,
        background: theme.background,
        cursor: '#f8f8f2',
      }
      // Theme change mid-sequence forces a full repaint with new defaults.
      const themed = { ...base, background: '#202020', cursor: '#00ff99' }
      const width = Math.ceil((COLS * config.cellWidth + 3) * config.dpr)
      const height = Math.ceil((ROWS * config.cellHeight + 2) * config.dpr)
      const persistent = new OffscreenCanvas(width, height)
      const incremental = createCanvas2D(persistent)
      incremental.resize(width, height)
      const geometry = {
        dpr: config.dpr,
        cellWidth: config.cellWidth,
        cellHeight: config.cellHeight,
      }
      const worst = { reference: { max: 0, count: 0 }, retained: { max: 0, count: 0 } }
      const failures = []
      let referenceClips = 0,
        optimizedClips = 0
      frames.forEach(({ label, frame }, index) => {
        const options = index >= frames.length - 10 ? themed : base
        const reference = new OffscreenCanvas(width, height)
        const referenceContext = reference.getContext('2d', { willReadFrequently: true })
        clipTarget = referenceContext
        clips = 0
        drawFrame(referenceContext, frame, options, width, height)
        referenceClips += clips
        const freshCanvas = new OffscreenCanvas(width, height)
        const fresh = createCanvas2D(freshCanvas)
        clipTarget = freshCanvas.getContext('2d')
        clips = 0
        fresh.render(frame, options)
        optimizedClips += clips
        fresh.dispose()
        clipTarget = undefined
        incremental.render(frame, options)
        if (index === 20) {
          // A same-size resize clears the bitmap; the next frame must repaint it all.
          incremental.resize(width, height)
          incremental.render(frame, options)
        }
        if (index === 30) {
          // A restored context invalidates the retained frame. Blank the bitmap
          // first so a missed invalidation shows up as a pixel difference.
          persistent.dispatchEvent(new Event('contextlost'))
          persistent.getContext('2d').clearRect(0, 0, width, height)
          persistent.dispatchEvent(new Event('contextrestored'))
          incremental.render(frame, options)
        }
        const expected = pixels(reference)
        const full = pixels(freshCanvas)
        const retained = pixels(persistent)
        const versusReference = compare(expected, full, width)
        const versusFresh = compare(full, retained, width)
        if (versusReference.max > worst.reference.max) worst.reference.max = versusReference.max
        worst.reference.count += versusReference.count
        if (versusFresh.max > worst.retained.max) worst.retained.max = versusFresh.max
        worst.retained.count += versusFresh.count
        if (versusFresh.count || versusReference.max > 0)
          failures.push({ label, versusReference, versusFresh })
      })
      incremental.dispose()
      results.push({
        config: geometry,
        frames: frames.length,
        worst,
        referenceClips,
        optimizedClips,
        failures: failures.slice(0, 8),
      })
    }
    OffscreenCanvasRenderingContext2D.prototype.clip = nativeClip
    return results
  })
  assert.deepEqual(errors, [])
  for (const result of results) {
    const { config, worst } = result
    console.log(
      `dpr ${config.dpr} cell ${config.cellWidth.toFixed(3)}x${config.cellHeight}: ${result.frames} frames; ` +
        `vs drawFrame max ${worst.reference.max} (${worst.reference.count} px); ` +
        `retained vs full max ${worst.retained.max} (${worst.retained.count} px); ` +
        `clips ${result.optimizedClips}/${result.referenceClips}`,
    )
    for (const failure of result.failures) console.log('  ', JSON.stringify(failure))
    if (worst.retained.count !== 0) {
      failed = true
      console.error('  retained frames differ from a full repaint')
    }
    if (worst.reference.max > tolerance) {
      failed = true
      console.error(`  full repaint differs from drawFrame beyond tolerance ${tolerance}`)
    }
  }
} finally {
  await browser.close()
  await server.close()
}
if (failed) process.exit(1)
console.log('Canvas2D retained rendering matches drawFrame')
