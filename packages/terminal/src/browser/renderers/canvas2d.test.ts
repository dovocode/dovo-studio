import { afterEach, expect, it, vi } from 'vite-plus/test'
import type {
  TerminalRenderCell,
  TerminalRenderFrame,
  TerminalRenderOptions,
} from '../render-types'
import { Canvas2DPainter, createCanvas2D } from './canvas2d'

type Op = { op: string; args: unknown[]; fill: string; font: string; alpha: number }

/** Records drawing calls with the state they were issued under. */
class RecordingContext {
  ops: Op[] = []
  fillStyle = ''
  font = ''
  textBaseline = ''
  globalAlpha = 1
  /** Ink extents per glyph; unspecified glyphs fit comfortably. */
  bounds = new Map<string, { left: number; right: number }>()
  measured: string[] = []
  private stack: { fillStyle: string; font: string; globalAlpha: number }[] = []
  private record(op: string, args: unknown[]) {
    this.ops.push({ op, args, fill: this.fillStyle, font: this.font, alpha: this.globalAlpha })
  }
  save() {
    this.stack.push({ fillStyle: this.fillStyle, font: this.font, globalAlpha: this.globalAlpha })
    this.record('save', [])
  }
  restore() {
    Object.assign(this, this.stack.pop())
    this.record('restore', [])
  }
  setTransform(...args: number[]) {
    this.record('setTransform', args)
  }
  translate() {}
  scale() {}
  beginPath() {}
  rect(...args: number[]) {
    this.record('rect', args)
  }
  clip() {
    this.record('clip', [])
  }
  clearRect(...args: number[]) {
    this.record('clearRect', args)
  }
  fillRect(...args: number[]) {
    this.record('fillRect', args)
  }
  fillText(...args: unknown[]) {
    this.record('fillText', args)
  }
  measureText(text: string) {
    this.measured.push(`${this.font}|${text}`)
    const bounds = this.bounds.get(text) ?? { left: -1, right: 3 }
    return { actualBoundingBoxLeft: bounds.left, actualBoundingBoxRight: bounds.right }
  }
  take(op?: string) {
    const ops = op ? this.ops.filter((entry) => entry.op === op) : this.ops
    this.ops = []
    return ops
  }
}

const options: TerminalRenderOptions = {
  fontFamily: 'monospace',
  fontSize: 4,
  cellWidth: 4,
  cellHeight: 4,
  baseline: 3,
  devicePixelRatio: 1,
  background: '#000',
  cursor: '#fff',
}
const cell = (text: string, extra: Partial<TerminalRenderCell> = {}): TerminalRenderCell => ({
  text,
  width: 1,
  foreground: '#fff',
  background: '#000',
  flags: 0,
  ...extra,
})
const frame = (
  rows: TerminalRenderCell[][],
  cursor: Partial<TerminalRenderFrame['cursor']> = {},
): TerminalRenderFrame => ({
  cols: rows[0].length,
  rows: rows.length,
  cells: rows,
  cursor: { x: 0, y: 0, visible: false, style: 'block', ...cursor },
})
const text = (ops: Op[]) => ops.filter((op) => op.op === 'fillText').map((op) => op.args[0])
const setup = () => {
  const context = new RecordingContext()
  const painter = new Canvas2DPainter(context as unknown as OffscreenCanvasRenderingContext2D)
  return { context, painter }
}

afterEach(() => vi.unstubAllGlobals())

it('skips blank glyphs and default backgrounds and merges background runs on device pixels', () => {
  const { context, painter } = setup()
  const red = { background: '#f00' }
  const scaled = { ...options, cellWidth: 4.3, devicePixelRatio: 1.25 }
  painter.render(
    frame([[cell('a', red), cell(' ', red), cell('b'), cell(' '), cell('c', red)]]),
    scaled,
    32,
    8,
  )
  const ops = context.take()
  expect(text(ops)).toEqual(['a', 'b', 'c'])
  const fills = ops.filter((op) => op.op === 'fillRect')
  // Whole-canvas background, one merged red run, and the separate trailing cell.
  expect(fills.map((op) => [op.fill, ...op.args])).toEqual([
    ['#000', 0, 0, 32, 8],
    ['#f00', 0, 0, Math.round(2 * 4.3 * 1.25), 5],
    [
      '#f00',
      Math.round(4 * 4.3 * 1.25),
      0,
      Math.round(5 * 4.3 * 1.25) - Math.round(4 * 4.3 * 1.25),
      5,
    ],
  ])
  // One row clip, no per-cell clip for fitting glyphs, and state set once.
  expect(ops.filter((op) => op.op === 'clip')).toHaveLength(1)
  expect(ops.filter((op) => op.op === 'fillText').every((op) => op.font === '4px monospace')).toBe(
    true,
  )
})

it('keeps clipping glyphs that overflow their cell, including wide cells', () => {
  const { context, painter } = setup()
  context.bounds.set('W', { left: 0.2, right: 4.1 })
  context.bounds.set('界', { left: -0.5, right: 7.4 })
  context.bounds.set('🙂', { left: -0.5, right: 8.4 })
  painter.render(
    frame([
      [
        cell('W'),
        cell('界', { width: 2 }),
        cell('', { width: 0 }),
        cell('🙂', { width: 2 }),
        cell('', { width: 0 }),
      ],
    ]),
    options,
    32,
    4,
  )
  const ops = context.take()
  expect(text(ops)).toEqual(['W', '界', '🙂'])
  const rects = ops.filter((op) => op.op === 'rect').map((op) => op.args)
  // Row clip, then cell clips for the overflowing narrow glyph and emoji only.
  expect(rects).toEqual([
    [0, 0, 28, 4],
    [0, 0, 4, 4],
    [12, 0, 8, 4],
  ])
})

it('routes decorations and faint text through the unchanged styles', () => {
  const { context, painter } = setup()
  painter.render(
    frame([[cell('a', { flags: 4 }), cell('b', { flags: 128 | 1 }), cell('c', { flags: 32 })]]),
    options,
    12,
    4,
  )
  const ops = context.take()
  expect(text(ops)).toEqual(['a', 'b'])
  const faint = ops.find((op) => op.op === 'fillText' && op.args[0] === 'b')
  expect(faint).toMatchObject({ alpha: 0.5, font: 'bold 4px monospace' })
  // drawCell paints the underline for the decorated cell.
  expect(ops.filter((op) => op.op === 'fillRect' && op.fill === '#fff')).toHaveLength(1)
  const after = ops.find((op) => op.op === 'fillText' && op.args[0] === 'a')
  expect(after?.alpha).toBe(1)
})

it('repaints only changed row bands and leaves an unchanged frame untouched', () => {
  const { context, painter } = setup()
  const rows = () => [[cell('a')], [cell('b')], [cell('c')], [cell('d')]]
  painter.render(frame(rows()), options, 4, 16)
  context.take()
  painter.render(frame(rows()), options, 4, 16)
  expect(context.take()).toEqual([])
  const next = rows()
  next[2][0] = cell('x', { background: '#00f' })
  painter.render(frame(next), options, 4, 16)
  const ops = context.take()
  expect(ops.find((op) => op.op === 'clearRect')?.args).toEqual([0, 8, 4, 4])
  // At integer row edges only the band's own glyphs are needed.
  expect(text(ops)).toEqual(['x'])
})

it('includes neighbouring rows when fractional row edges share device pixels', () => {
  const { context, painter } = setup()
  const scaled = { ...options, devicePixelRatio: 1.3 }
  const rows = () =>
    Array.from({ length: 8 }, (_, index) => [cell(String.fromCharCode(97 + index))])
  painter.render(frame(rows()), scaled, 6, 42)
  context.take()
  const next = rows()
  next[4][0] = cell('x')
  painter.render(frame(next), scaled, 6, 42)
  const ops = context.take()
  // Rows 3–5 are cleared; glyphs of rows 2–6 are repainted under the band clip.
  expect(ops.find((op) => op.op === 'clearRect')?.args).toEqual([
    0,
    Math.round(3 * 4 * 1.3),
    6,
    Math.round(6 * 4 * 1.3) - Math.round(3 * 4 * 1.3),
  ])
  expect(text(ops)).toEqual(['c', 'd', 'x', 'f', 'g'])
})

it('extends the last row band to the canvas bottom for its antialiased fringe', () => {
  const { context, painter } = setup()
  // Seven rows of 4 CSS px at DPR 1.3 end at 36.4 device px: the rounded band
  // ends at 36, but the cursor's fringe reaches pixel row 36 of a 37 px canvas.
  const scaled = { ...options, devicePixelRatio: 1.3 }
  const rows = () => Array.from({ length: 7 }, () => [cell('a')])
  painter.render(frame(rows(), { visible: true, y: 6 }), scaled, 6, 37)
  context.take()
  painter.render(frame(rows(), { visible: false, y: 6 }), scaled, 6, 37)
  const band = context.take().find((op) => op.op === 'clearRect')?.args
  // Rows 5–6 (the change plus its fractional neighbour) through the canvas end.
  expect(band).toEqual([0, Math.round(5 * 4 * 1.3), 6, 37 - Math.round(5 * 4 * 1.3)])
})

it('repaints the old and new cursor rows when the cursor moves or hides', () => {
  const { context, painter } = setup()
  const rows = () => [[cell('a')], [cell('b')], [cell('c')], [cell('d')]]
  painter.render(frame(rows(), { visible: true, y: 0 }), options, 4, 16)
  context.take()
  painter.render(frame(rows(), { visible: true, y: 2 }), options, 4, 16)
  let ops = context.take()
  expect(ops.filter((op) => op.op === 'clearRect').map((op) => op.args[1])).toEqual([0, 8])
  // The block cursor is drawn with the cursor colour and the cell's inverse text.
  expect(ops.some((op) => op.op === 'fillRect' && op.fill === '#fff')).toBe(true)
  expect(ops.find((op) => op.op === 'fillText' && op.fill === '#000')?.args[0]).toBe('c')
  painter.render(frame(rows(), { visible: false, y: 2 }), options, 4, 16)
  ops = context.take()
  expect(ops.filter((op) => op.op === 'clearRect').map((op) => op.args[1])).toEqual([8])
  expect(ops.some((op) => op.op === 'fillRect' && op.fill === '#fff')).toBe(false)
})

it('detects in-place cell mutation, such as selection colours', () => {
  const { context, painter } = setup()
  const rows = [[cell('a')], [cell('b')], [cell('c')]]
  const shown = frame(rows)
  painter.render(shown, options, 4, 12)
  context.take()
  rows[1][0].background = '#335'
  painter.render(shown, options, 4, 12)
  const ops = context.take()
  expect(ops.filter((op) => op.op === 'clearRect').map((op) => op.args[1])).toEqual([4])
  expect(ops.some((op) => op.op === 'fillRect' && op.fill === '#335')).toBe(true)
})

it('repaints everything after option, theme, geometry, or invalidation changes', () => {
  const { context, painter } = setup()
  const rows = () => [[cell('a')], [cell('b')], [cell('c')]]
  const full = () => {
    const ops = context.take()
    return ops.some((op) => op.op === 'clearRect' && op.args[1] === 0 && op.args[3] === 12)
  }
  painter.render(frame(rows()), options, 4, 12)
  expect(full()).toBe(true)
  for (const changed of [
    { ...options, background: '#111' },
    { ...options, background: '#111', fontFamily: 'Fira Code' },
    { ...options, background: '#111', fontFamily: 'Fira Code', devicePixelRatio: 2 },
  ]) {
    painter.render(frame(rows()), changed, 4, 12)
    expect(full()).toBe(true)
  }
  const last = { ...options, background: '#111', fontFamily: 'Fira Code', devicePixelRatio: 2 }
  painter.render(
    frame([
      [cell('a'), cell('z')],
      [cell('b'), cell('z')],
      [cell('c'), cell('z')],
    ]),
    last,
    4,
    12,
  )
  expect(full()).toBe(true)
  painter.invalidate()
  painter.render(
    frame([
      [cell('a'), cell('z')],
      [cell('b'), cell('z')],
      [cell('c'), cell('z')],
    ]),
    last,
    4,
    12,
  )
  expect(full()).toBe(true)
})

it('does not skip default backgrounds that may be translucent', () => {
  const { context, painter } = setup()
  const translucent = { ...options, background: 'rgba(0, 0, 0, 0.5)' }
  painter.render(frame([[cell('a', { background: translucent.background })]]), translucent, 4, 4)
  const fills = context.take('fillRect')
  expect(fills).toHaveLength(2)
})

it('measures each glyph once per font and resets the bounded cache on font changes', () => {
  const { context, painter } = setup()
  const row = [cell('a'), cell('a'), cell('a', { flags: 1 }), cell('b')]
  painter.render(frame([row]), options, 16, 4)
  painter.invalidate()
  painter.render(frame([row]), options, 16, 4)
  expect(context.measured).toEqual(['4px monospace|a', 'bold 4px monospace|a', '4px monospace|b'])
  expect(painter.glyphCount).toBe(3)
  painter.render(frame([row]), { ...options, fontSize: 5 }, 16, 4)
  expect(painter.glyphCount).toBe(3)
  expect(context.measured).toHaveLength(6)
})

it('repaints in full after a same-size resize or a context restore', () => {
  const context = new RecordingContext()
  class FakeCanvas extends EventTarget {
    width = 4
    height = 4
    getContext() {
      return context
    }
  }
  vi.stubGlobal('OffscreenCanvas', FakeCanvas)
  const canvas = new FakeCanvas() as unknown as OffscreenCanvas
  const renderer = createCanvas2D(canvas)
  const shown = frame([[cell('a')]])
  const painted = () => text(context.take()).length
  renderer.render(shown, options)
  expect(painted()).toBe(1)
  renderer.render(shown, options)
  expect(painted()).toBe(0)
  renderer.resize(4, 4)
  renderer.render(shown, options)
  expect(painted()).toBe(1)
  canvas.dispatchEvent(new Event('contextlost'))
  renderer.render(shown, options)
  expect(painted()).toBe(0)
  canvas.dispatchEvent(new Event('contextrestored'))
  renderer.render(shown, options)
  expect(painted()).toBe(1)
  renderer.dispose()
})

it('keeps the cell clip whenever ink reaches a partially covered device pixel', () => {
  const { context, painter } = setup()
  // At x = 0 the ink spans device pixels 0.3–3.9 of a 0–4.5 cell: no partial
  // column is touched. The same glyph at x = 4.5 starts at 4.8, inside the
  // partially covered column 4, so it must stay clipped.
  context.bounds.set('i', { left: -0.8, right: 3.4 })
  painter.render(frame([[cell('i'), cell('i')]]), { ...options, cellWidth: 4.5 }, 9, 4)
  const rects = context.take('rect').map((op) => op.args)
  expect(rects).toEqual([
    [0, 0, 18, 4],
    [4.5, 0, 4.5, 4],
  ])
})

it('preserves compositing for alpha-bearing CSS rgb backgrounds', () => {
  const { context, painter } = setup()
  const background = 'rgb(0 0 0 / 50%)'
  painter.render(
    frame([[cell(' ', { background }), cell(' ', { background })]]),
    { ...options, background },
    8,
    4,
  )
  // The canvas background and cell background are separate translucent layers.
  expect(context.take('fillRect')).toHaveLength(2)
})
