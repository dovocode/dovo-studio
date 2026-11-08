import { afterEach, expect, it, vi } from 'vite-plus/test'
import type {
  TerminalRenderCell,
  TerminalRenderFrame,
  TerminalRenderOptions,
} from '../render-types'
import { AtlasPacking, GlyphAtlas, drawCursor } from './scene'
import { createCanvas2D } from './canvas2d'

const fills: number[][] = []
class FakeContext {
  fillStyle = ''
  font = ''
  textBaseline = ''
  globalAlpha = 1
  save() {}
  restore() {}
  setTransform() {}
  translate() {}
  scale() {}
  beginPath() {}
  rect() {}
  clip() {}
  fillText() {}
  measureText() {
    return { actualBoundingBoxLeft: 0, actualBoundingBoxRight: 4 }
  }
  clearRect() {}
  getImageData() {
    return { data: new Uint8ClampedArray([0, 0, 0, 255]) }
  }
  fillRect(...values: number[]) {
    fills.push(values)
  }
}
class FakeCanvas extends EventTarget {
  private context = new FakeContext()
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    super()
  }
  getContext() {
    return this.context
  }
}
vi.stubGlobal('OffscreenCanvas', FakeCanvas)
afterEach(() => {
  fills.length = 0
})
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
const cell = (text: string, width = 1): TerminalRenderCell => ({
  text,
  width,
  foreground: '#fff',
  background: '#000',
  flags: 0,
})
const frame = (cells: TerminalRenderCell[]): TerminalRenderFrame => ({
  cols: cells.length,
  rows: 1,
  cells: [cells],
  cursor: { x: 0, y: 0, visible: false, style: 'block' },
})

it('requests a software-friendly Canvas2D backing for the emergency renderer', () => {
  const canvas = new OffscreenCanvas(16, 8)
  const getContext = vi.spyOn(canvas, 'getContext')
  const renderer = createCanvas2D(canvas)
  expect(getContext).toHaveBeenCalledWith('2d', { willReadFrequently: true })
  renderer.dispose()
})

it('packs tiles with gutters and never places a tile outside the page', () => {
  const pack = new AtlasPacking(12)
  expect(pack.allocate(4, 4)).toEqual({ x: 1, y: 1 })
  expect(pack.allocate(4, 4)).toEqual({ x: 6, y: 1 })
  expect(pack.allocate(4, 4)).toEqual({ x: 1, y: 6 })
  expect(pack.allocate(12, 1)).toBeUndefined()
  for (const invalid of [0, -1, 1.5, NaN, Infinity]) {
    expect(pack.allocate(invalid, 1)).toBeUndefined()
    expect(pack.allocate(1, invalid)).toBeUndefined()
  }
})

it('reuses atlas tiles, marks only newly drawn tiles dirty, and invalidates changed metrics', () => {
  const atlas = new GlyphAtlas(32, 2)
  const first = atlas.scene(frame([cell('a')]), options, 16, 8)
  const page = first.batches[0].page
  expect(page.dirty).toBeDefined()
  page.dirty = undefined
  atlas.scene(frame([cell('a')]), options, 16, 8)
  expect(page.dirty).toBeUndefined()
  atlas.scene(frame([cell('a'), cell('b')]), options, 16, 8)
  expect(page.dirty).toMatchObject({ width: 4, height: 4 })
  atlas.scene(frame([cell('a')]), { ...options, fontSize: 5 }, 16, 8)
  expect(atlas.pages[0]).toBe(page)
  expect(page.dirty).toEqual({ x: 0, y: 0, width: 32, height: 32 })
})

it('evicts stale tiles at the page limit and rejects a viewport that cannot fit', () => {
  const atlas = new GlyphAtlas(12, 1)
  atlas.scene(frame([cell('a'), cell('b'), cell('c'), cell('d')]), options, 16, 8)
  const old = atlas.pages[0]
  old.dirty = undefined
  atlas.scene(frame([cell('e'), cell('f')]), options, 16, 8)
  expect(atlas.pages[0]).toBe(old)
  expect(old.dirty).toEqual({ x: 0, y: 0, width: 12, height: 12 })
  expect(() =>
    atlas.scene(frame([cell('a'), cell('b'), cell('c'), cell('d'), cell('e')]), options, 20, 8),
  ).toThrow('viewport exceeds')
})

it('keeps page changes in draw order and places a transparent cursor last', () => {
  const atlas = new GlyphAtlas(12, 3)
  const value = frame([cell('a'), cell('b'), cell('c'), cell('d'), cell('e'), cell('a')])
  value.cursor = { x: 5, y: 0, visible: true, style: 'bar' }
  const { batches } = atlas.scene(value, options, 24, 8)
  expect(batches.length).toBeGreaterThan(2)
  expect(batches[0].page).toBe(batches[batches.length - 2].page)
  expect(batches.at(-1)).toMatchObject({ offset: 36, count: 6, opaque: false })
})

it('clears default blanks without allocating atlas pages or vertices', () => {
  const atlas = new GlyphAtlas(32, 2)
  const scene = atlas.scene(
    frame([cell(' '), cell(''), { ...cell('hidden'), flags: 32 }]),
    options,
    12,
    4,
  )
  expect(scene.background).toEqual([0, 0, 0, 1])
  expect(scene.batches).toEqual([])
  expect(scene.vertices).toHaveLength(0)
  expect(atlas.pages).toHaveLength(0)
})

it('coalesces opaque blank backgrounds while preserving decorations and transparent draws', () => {
  const atlas = new GlyphAtlas(32, 2)
  const selected = { ...cell(' '), background: '#123456' }
  const decorated = { ...selected, flags: 4 }
  const transparent = { ...selected, background: 'rgba(1,2,3,0.5)' }
  const scene = atlas.scene(
    frame([selected, selected, decorated, transparent, transparent]),
    options,
    20,
    4,
  )
  expect(scene.vertices).toHaveLength(4 * 24)
  expect(scene.vertices[2]).toBe(scene.vertices[6])
  expect(scene.vertices[3]).toBe(scene.vertices[11])
  expect(Array.from(scene.vertices.subarray(0, 2))).toEqual([-1, 1])
  expect(Array.from(scene.vertices.subarray(4, 6))).toEqual([expect.closeTo(-0.2), 1])
  expect(Array.from(scene.vertices.subarray(8, 10))).toEqual([-1, -1])
  expect(scene.batches.map(({ count, opaque }) => ({ count, opaque }))).toEqual([
    { count: 12, opaque: true },
    { count: 12, opaque: false },
  ])
})

it('keeps alpha-bearing CSS colors blended, including rgb with an alpha component', () => {
  const atlas = new GlyphAtlas(32, 2)
  const scene = atlas.scene(
    frame([
      { ...cell('a'), background: 'rgb(1,2,3,0.5)' },
      { ...cell('b'), background: '#0008' },
      { ...cell('c'), background: 'rgb(1,2,3)' },
    ]),
    options,
    12,
    4,
  )
  expect(scene.batches.map(({ opaque }) => opaque)).toEqual([false, true])
})

it('reuses vertex storage for novel text and retains fractional wide-cell geometry', () => {
  const atlas = new GlyphAtlas(64, 2)
  const fractional = { ...options, cellWidth: 7.2246, devicePixelRatio: 1.25 }
  const first = atlas.scene(frame([cell('你', 2), cell('', 0)]), fractional, 19, 5)
  const storage = first.vertices.buffer
  const next = atlas.scene(frame([cell('好', 2), cell('', 0)]), fractional, 19, 5)
  expect(next.vertices.buffer).toBe(storage)
  expect(next.vertices).toHaveLength(24)
  expect(next.vertices[4]).toBeCloseTo(((2 * 7.2246 * 1.25) / 19) * 2 - 1)
  const page = atlas.pages[0]
  expect(page.dirty?.width).toBeLessThanOrEqual(64)
  expect(page.dirty?.height).toBeLessThanOrEqual(64)
})

it('packs complete passthrough triangles and reuses grown storage without stale vertices', () => {
  const atlas = new GlyphAtlas(32, 2)
  const one = atlas.scene(frame([cell('a')]), options, 8, 4)
  const u1 = 1 / 32,
    v1 = 1 / 32,
    u2 = 5 / 32,
    v2 = 5 / 32
  expect(Array.from(one.vertices)).toEqual([
    -1,
    1,
    u1,
    v1,
    0,
    1,
    u2,
    v1,
    -1,
    -1,
    u1,
    v2,
    -1,
    -1,
    u1,
    v2,
    0,
    1,
    u2,
    v1,
    0,
    -1,
    u2,
    v2,
  ])
  const many = atlas.scene(frame(Array.from({ length: 100 }, () => cell('a'))), options, 400, 4)
  expect(many.vertices).toHaveLength(100 * 24)
  expect(many.batches).toMatchObject([{ offset: 0, count: 600 }])
  expect(many.vertices[many.vertices.length - 4]).toBe(1)
  const buffer = many.vertices.buffer
  const small = atlas.scene(frame([cell('b')]), options, 8, 4)
  expect(small.vertices.buffer).toBe(buffer)
  expect(small.vertices).toHaveLength(24)
  expect(small.batches).toMatchObject([{ offset: 0, count: 6 }])
})

it('keeps a default blank that overwrites an overlapping wide cell', () => {
  const atlas = new GlyphAtlas(32, 2)
  const scene = atlas.scene(frame([cell('你', 2), cell(' ')]), options, 8, 4)
  expect(scene.vertices).toHaveLength(48)
  expect(scene.batches[0].count).toBe(12)
})

it('uses every retained atlas page again after eviction without reallocating canvases', () => {
  const atlas = new GlyphAtlas(12, 2)
  atlas.scene(frame(Array.from('abcdefgh', (text) => cell(text))), options, 32, 4)
  const pages = [...atlas.pages]
  const clear = pages.map((page) => vi.spyOn(page.context, 'clearRect'))
  const scene = atlas.scene(frame(Array.from('ijklmnop', (text) => cell(text))), options, 32, 4)
  expect(atlas.pages).toEqual(pages)
  expect(scene.vertices).toHaveLength(8 * 24)
  for (const spy of clear) expect(spy).toHaveBeenCalledWith(0, 0, 12, 12)
})

it('draws a block cursor across the full width of a wide cell', () => {
  const context = new OffscreenCanvas(1, 1).getContext('2d')
  if (!context) throw new Error('missing context')
  const value = frame([cell('😀', 2), cell('', 0)])
  value.cursor = { x: 0, y: 0, visible: true, style: 'block' }
  drawCursor(context, value, options)
  expect(fills[0]).toEqual([0, 0, 8, 4])
})

it('suspends Canvas2D during loss and requests one redraw when restored', () => {
  vi.useFakeTimers()
  const canvas = new OffscreenCanvas(16, 8)
  const onSuspend = vi.fn<() => void>(),
    onRestore = vi.fn<() => void>(),
    onPermanentLoss = vi.fn<(error: Error) => void>()
  const renderer = createCanvas2D(canvas, { onSuspend, onRestore, onPermanentLoss })
  const loss = new Event('contextlost', { cancelable: true })
  canvas.dispatchEvent(loss)
  expect(loss.defaultPrevented).toBe(false)
  renderer.render(frame([cell('a')]), options)
  expect(fills).toHaveLength(0)
  expect(onSuspend).toHaveBeenCalledOnce()
  canvas.dispatchEvent(new Event('contextrestored'))
  expect(onRestore).toHaveBeenCalledOnce()
  renderer.render(frame([cell('a')]), options)
  expect(fills.length).toBeGreaterThan(0)
  vi.advanceTimersByTime(6000)
  expect(onPermanentLoss).not.toHaveBeenCalled()
  renderer.dispose()
  vi.useRealTimers()
})

it('reports a persistent Canvas2D loss once, and permits a late restoration', () => {
  vi.useFakeTimers()
  const canvas = new OffscreenCanvas(16, 8)
  const onRestore = vi.fn<() => void>(),
    onPermanentLoss = vi.fn<(error: Error) => void>()
  const renderer = createCanvas2D(canvas, { onRestore, onPermanentLoss })
  canvas.dispatchEvent(new Event('contextlost'))
  vi.advanceTimersByTime(5000)
  expect(onPermanentLoss).toHaveBeenCalledOnce()
  expect(onPermanentLoss.mock.calls[0][0].message).toContain('not restored')
  expect(() => renderer.render(frame([cell('a')]), options)).not.toThrow()
  canvas.dispatchEvent(new Event('contextrestored'))
  expect(onRestore).toHaveBeenCalledOnce()
  renderer.render(frame([cell('a')]), options)
  expect(fills.length).toBeGreaterThan(0)
  renderer.dispose()
  vi.useRealTimers()
})

it('surfaces a persistent loss once without callbacks and cancels timers on disposal', () => {
  vi.useFakeTimers()
  const canvas = new OffscreenCanvas(16, 8)
  const renderer = createCanvas2D(canvas)
  canvas.dispatchEvent(new Event('contextlost'))
  vi.advanceTimersByTime(5000)
  expect(() => renderer.render(frame([cell('a')]), options)).toThrow('not restored')
  expect(() => renderer.render(frame([cell('a')]), options)).not.toThrow()
  renderer.dispose()
  const onPermanentLoss = vi.fn<(error: Error) => void>()
  const next = createCanvas2D(canvas, { onPermanentLoss })
  canvas.dispatchEvent(new Event('contextlost'))
  next.dispose()
  vi.advanceTimersByTime(5000)
  expect(onPermanentLoss).not.toHaveBeenCalled()
  vi.useRealTimers()
})
