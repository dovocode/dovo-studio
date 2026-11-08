import type {
  TerminalRenderCell,
  TerminalRenderFrame,
  TerminalRenderOptions,
} from '../render-types'

export function drawCell(
  ctx: OffscreenCanvasRenderingContext2D,
  cell: TerminalRenderCell,
  x: number,
  y: number,
  options: TerminalRenderOptions,
  width: number,
): void {
  if (!(cell.flags & 32)) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(x, y, width, options.cellHeight)
    ctx.clip()
    ctx.fillStyle = cell.foreground
    ctx.font = `${cell.flags & 2 ? 'italic ' : ''}${cell.flags & 1 ? 'bold ' : ''}${options.fontSize}px ${options.fontFamily}`
    ctx.textBaseline = 'alphabetic'
    if (cell.flags & 128) ctx.globalAlpha = 0.5
    if (cell.text) ctx.fillText(cell.text, x, y + options.baseline)
    const thickness = Math.max(1, options.cellHeight / 16)
    if (cell.flags & 4) ctx.fillRect(x, y + options.cellHeight - thickness * 2, width, thickness)
    if (cell.flags & 8) ctx.fillRect(x, y + options.cellHeight / 2, width, thickness)
    ctx.restore()
  }
}

export function drawCursor(
  ctx: OffscreenCanvasRenderingContext2D,
  frame: TerminalRenderFrame,
  options: TerminalRenderOptions,
  blockFilled = false,
): void {
  const { cursor } = frame
  if (
    !cursor.visible ||
    cursor.x < 0 ||
    cursor.y < 0 ||
    cursor.x >= frame.cols ||
    cursor.y >= frame.rows
  )
    return
  const x = cursor.x * options.cellWidth
  const y = cursor.y * options.cellHeight
  ctx.fillStyle = options.cursor
  if (cursor.style === 'block') {
    const cell = frame.cells[cursor.y]?.[cursor.x]
    if (!blockFilled)
      ctx.fillRect(x, y, options.cellWidth * Math.max(1, cell?.width ?? 1), options.cellHeight)
    if (cell?.text) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(x, y, options.cellWidth * Math.max(1, cell.width), options.cellHeight)
      ctx.clip()
      ctx.fillStyle = cell.background
      ctx.font = `${cell.flags & 2 ? 'italic ' : ''}${cell.flags & 1 ? 'bold ' : ''}${options.fontSize}px ${options.fontFamily}`
      ctx.textBaseline = 'alphabetic'
      ctx.fillText(cell.text, x, y + options.baseline)
      ctx.restore()
    }
  } else if (cursor.style === 'underline') {
    ctx.fillRect(
      x,
      y + options.cellHeight - Math.max(1, options.cellHeight / 10),
      options.cellWidth,
      Math.max(1, options.cellHeight / 10),
    )
  } else {
    ctx.fillRect(x, y, Math.max(1, options.cellWidth / 8), options.cellHeight)
  }
}

export function drawFrame(
  ctx: OffscreenCanvasRenderingContext2D,
  frame: TerminalRenderFrame,
  options: TerminalRenderOptions,
  width: number,
  height: number,
): void {
  const dpr = options.devicePixelRatio
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = options.background
  ctx.fillRect(0, 0, width, height)
  // Rasterize background boundaries consistently in device pixels. Adjacent
  // fractional fillRects otherwise blend their partially covered edge pixels.
  for (let y = 0; y < frame.rows; y++)
    for (let x = 0; x < frame.cols; x++) {
      const cell = frame.cells[y]?.[x]
      if (!cell || cell.width === 0) continue
      const left = Math.round(x * options.cellWidth * dpr)
      const right = Math.round((x + Math.max(1, cell.width)) * options.cellWidth * dpr)
      const top = Math.round(y * options.cellHeight * dpr)
      const bottom = Math.round((y + 1) * options.cellHeight * dpr)
      ctx.fillStyle = cell.background
      ctx.fillRect(left, top, right - left, bottom - top)
    }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  for (let y = 0; y < frame.rows; y++)
    for (let x = 0; x < frame.cols; x++) {
      const cell = frame.cells[y]?.[x]
      if (!cell || cell.width === 0) continue
      drawCell(
        ctx,
        cell,
        x * options.cellWidth,
        y * options.cellHeight,
        options,
        options.cellWidth * Math.max(1, cell.width),
      )
    }
  drawCursor(ctx, frame, options)
}

// One pixel of padding separates tiles, including at fractional device scales.
export const ATLAS_SIZE = 1024
const MAX_PAGES = 8
export type AtlasPage = {
  canvas: OffscreenCanvas
  context: OffscreenCanvasRenderingContext2D
  dirty: { x: number; y: number; width: number; height: number } | undefined
}
type Tile = { page: AtlasPage; x: number; y: number; width: number; height: number }
// Consecutive batches address position/UV vertices in one reusable packed buffer.
export type Batch = { page: AtlasPage; offset: number; count: number; opaque: boolean }
export type AtlasScene = {
  batches: Batch[]
  vertices: Float32Array<ArrayBuffer>
  background: [number, number, number, number]
}

// Unknown CSS colors retain blending. These are the opaque forms emitted by the
// worker and common themes; alpha-bearing CSS is deliberately conservative.
function opaqueColor(color: string): boolean {
  return (
    /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(color) ||
    /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/i.test(color)
  )
}

function blankCell(cell: TerminalRenderCell): boolean {
  return !!(cell.flags & 32) || (!(cell.flags & 12) && (cell.text === '' || cell.text === ' '))
}

class AtlasFull extends Error {}

/** Packing is independent of canvas rendering so its bounded allocation can be tested. */
export class AtlasPacking {
  private x = 1
  private y = 1
  private rowHeight = 0
  constructor(readonly size: number) {}
  allocate(width: number, height: number): { x: number; y: number } | undefined {
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1 ||
      width + 2 > this.size ||
      height + 2 > this.size
    )
      return undefined
    if (this.x + width + 1 > this.size) {
      this.x = 1
      this.y += this.rowHeight + 1
      this.rowHeight = 0
    }
    if (this.y + height + 1 > this.size) return undefined
    const result = { x: this.x, y: this.y }
    this.x += width + 1
    this.rowHeight = Math.max(this.rowHeight, height)
    return result
  }
}

export class GlyphAtlas {
  readonly pages: AtlasPage[] = []
  private readonly cache = new Map<string, Tile>()
  private readonly packers: AtlasPacking[] = []
  private metrics = ''
  private pageIndex = 0
  private vertices = new Float32Array(0)
  private backgroundColor = ''
  private background: [number, number, number, number] = [0, 0, 0, 1]
  private colorContext: OffscreenCanvasRenderingContext2D | undefined
  constructor(
    private readonly size = ATLAS_SIZE,
    private readonly maxPages = MAX_PAGES,
  ) {}
  reset(): void {
    this.pages.length = 0
    this.packers.length = 0
    this.cache.clear()
    this.pageIndex = 0
    this.vertices = new Float32Array(0)
    this.colorContext = undefined
    this.backgroundColor = ''
  }
  private recycle(): void {
    this.cache.clear()
    this.pageIndex = 0
    for (let i = 0; i < this.pages.length; i++) {
      const page = this.pages[i]
      page.context.clearRect(0, 0, this.size, this.size)
      page.dirty = { x: 0, y: 0, width: this.size, height: this.size }
      this.packers[i] = new AtlasPacking(this.size)
    }
  }
  private tile(
    key: string,
    width: number,
    height: number,
    dpr: number,
    draw: (context: OffscreenCanvasRenderingContext2D) => void,
  ): Tile {
    const cached = this.cache.get(key)
    if (cached) return cached
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1 ||
      width + 2 > this.size ||
      height + 2 > this.size
    )
      throw new Error('Terminal cell exceeds glyph atlas size')
    let index = this.pageIndex
    let position = this.packers[index]?.allocate(width, height)
    while (!position) {
      if (this.pages[index]) index++
      if (index >= this.maxPages) throw new AtlasFull('Terminal glyph atlas is full')
      if (!this.pages[index]) {
        const canvas = new OffscreenCanvas(this.size, this.size)
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Unable to create terminal glyph atlas')
        this.pages.push({ canvas, context, dirty: undefined })
        this.packers.push(new AtlasPacking(this.size))
      }
      position = this.packers[index].allocate(width, height)
    }
    this.pageIndex = index
    const page = this.pages[index]
    const { x, y } = position
    page.context.save()
    page.context.translate(x, y)
    page.context.scale(dpr, dpr)
    draw(page.context)
    page.context.restore()
    const previous = page.dirty
    const left = Math.min(x, previous?.x ?? x),
      top = Math.min(y, previous?.y ?? y)
    const right = Math.max(x + width, previous ? previous.x + previous.width : x + width)
    const bottom = Math.max(y + height, previous ? previous.y + previous.height : y + height)
    page.dirty = { x: left, y: top, width: right - left, height: bottom - top }
    const tile = { page, x, y, width, height }
    this.cache.set(key, tile)
    return tile
  }
  scene(
    frame: TerminalRenderFrame,
    options: TerminalRenderOptions,
    width: number,
    height: number,
  ): AtlasScene {
    const metrics = JSON.stringify([
      options.fontFamily,
      options.fontSize,
      options.cellWidth,
      options.cellHeight,
      options.baseline,
      options.devicePixelRatio,
    ])
    if (metrics !== this.metrics) {
      this.recycle()
      this.metrics = metrics
    }
    try {
      return this.build(frame, options, width, height)
    } catch (error) {
      if (!(error instanceof AtlasFull)) throw error
      // Evict the entire cache between frames, then retry once. A viewport that
      // itself exceeds the bound fails explicitly instead of corrupting a batch.
      this.recycle()
      try {
        return this.build(frame, options, width, height)
      } catch (retry) {
        if (retry instanceof AtlasFull)
          throw new Error('Terminal viewport exceeds glyph atlas capacity')
        throw retry
      }
    }
  }
  private build(
    frame: TerminalRenderFrame,
    options: TerminalRenderOptions,
    width: number,
    height: number,
  ): AtlasScene {
    const batches: Batch[] = []
    const dpr = options.devicePixelRatio,
      cw = options.cellWidth,
      ch = options.cellHeight
    const pixelHeight = Math.max(1, Math.ceil(ch * dpr - 1e-6))
    let vertexCount = 0
    const tile = (
      key: string,
      w: number,
      h: number,
      draw: (context: OffscreenCanvasRenderingContext2D) => void,
    ) => this.tile(key, w, h, dpr, draw)
    const quad = (t: Tile, x: number, y: number, w: number, h: number, opaque: boolean) => {
      // Keep consecutive runs in submission order, including overlapping wide
      // cells and the transparent cursor. Only adjacent compatible draws batch.
      let batch = batches[batches.length - 1]
      if (!batch || batch.page !== t.page || batch.opaque !== opaque) {
        batch = { page: t.page, offset: vertexCount, count: 0, opaque }
        batches.push(batch)
      }
      const offset = vertexCount * 4
      if (offset + 24 > this.vertices.length) {
        const grown = new Float32Array(Math.max(offset + 24, this.vertices.length * 2, 2048))
        grown.set(this.vertices)
        this.vertices = grown
      }
      const x1 = ((x * dpr) / width) * 2 - 1,
        y1 = 1 - ((y * dpr) / height) * 2,
        x2 = (((x + w) * dpr) / width) * 2 - 1,
        y2 = 1 - (((y + h) * dpr) / height) * 2
      // Solid tiles sample their pixel center even across long fractional runs;
      // interpolating all the way to their edge can sample the transparent gutter.
      const solid = t.width === 1 && t.height === 1
      const u1 = (t.x + (solid ? 0.5 : 0)) / this.size,
        v1 = (t.y + (solid ? 0.5 : 0)) / this.size,
        u2 = (t.x + (solid ? 0.5 : t.width)) / this.size,
        v2 = (t.y + (solid ? 0.5 : t.height)) / this.size
      // Expand directly into persistent storage. Software GPU drivers can make
      // tiny instanced strips more expensive than the extra vertex bandwidth.
      const vertices = this.vertices
      vertices[offset] = x1
      vertices[offset + 1] = y1
      vertices[offset + 2] = u1
      vertices[offset + 3] = v1
      vertices[offset + 4] = x2
      vertices[offset + 5] = y1
      vertices[offset + 6] = u2
      vertices[offset + 7] = v1
      vertices[offset + 8] = x1
      vertices[offset + 9] = y2
      vertices[offset + 10] = u1
      vertices[offset + 11] = v2
      vertices[offset + 12] = x1
      vertices[offset + 13] = y2
      vertices[offset + 14] = u1
      vertices[offset + 15] = v2
      vertices[offset + 16] = x2
      vertices[offset + 17] = y1
      vertices[offset + 18] = u2
      vertices[offset + 19] = v1
      vertices[offset + 20] = x2
      vertices[offset + 21] = y2
      vertices[offset + 22] = u2
      vertices[offset + 23] = v2
      vertexCount += 6
      batch.count += 6
    }
    if (this.backgroundColor !== options.background) {
      this.colorContext ??=
        new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true }) ?? undefined
      const context = this.colorContext
      if (!context) throw new Error('Unable to resolve terminal background color')
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = options.background
      context.fillRect(0, 0, 1, 1)
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data
      // Match the previous background quad blended over the opaque black target.
      this.background = [(r * a) / 65025, (g * a) / 65025, (b * a) / 65025, 1]
      this.backgroundColor = options.background
    }
    for (let y = 0; y < frame.rows; y++) {
      let previousEnd = 0
      for (let x = 0; x < frame.cols; x++) {
        const cell = frame.cells[y]?.[x]
        if (!cell || cell.width === 0) continue
        const span = Math.max(1, cell.width)
        const opaque = opaqueColor(cell.background)
        if (blankCell(cell)) {
          // A default blank needs no geometry unless it overwrites an earlier
          // overlapping wide cell. Transparent backgrounds must still composite.
          if (opaque && cell.background === options.background && previousEnd <= x) {
            previousEnd = x + span
            continue
          }
          let end = x + span
          if (opaque) {
            while (end < frame.cols) {
              const next = frame.cells[y]?.[end]
              if (
                !next ||
                next.width === 0 ||
                next.background !== cell.background ||
                !blankCell(next)
              )
                break
              end += Math.max(1, next.width)
            }
          }
          const t = tile(JSON.stringify(['background', cell.background]), 1, 1, (c) => {
            c.fillStyle = cell.background
            c.fillRect(0, 0, 1 / dpr, 1 / dpr)
          })
          quad(t, x * cw, y * ch, (end - x) * cw, ch, opaque)
          previousEnd = Math.max(previousEnd, end)
          x = end - 1
          continue
        }
        const w = Math.max(1, Math.ceil(cw * span * dpr - 1e-6))
        const t = tile(
          JSON.stringify(['cell', cell.text, span, cell.foreground, cell.background, cell.flags]),
          w,
          pixelHeight,
          (c) => {
            // Fill every tile pixel even for fractional glyph geometry.
            c.save()
            c.scale(1 / dpr, 1 / dpr)
            c.fillStyle = cell.background
            c.fillRect(0, 0, w, pixelHeight)
            c.restore()
            drawCell(c, cell, 0, 0, options, cw * span)
          },
        )
        quad(t, x * cw, y * ch, cw * span, ch, opaque)
        previousEnd = Math.max(previousEnd, x + span)
      }
    }
    if (
      frame.cursor.visible &&
      frame.cursor.x >= 0 &&
      frame.cursor.y >= 0 &&
      frame.cursor.x < frame.cols &&
      frame.cursor.y < frame.rows
    ) {
      const cell = frame.cells[frame.cursor.y]?.[frame.cursor.x]
      const span = frame.cursor.style === 'block' ? Math.max(1, cell?.width ?? 1) : 1
      const cursorWidth = Math.max(1, Math.ceil(cw * span * dpr - 1e-6))
      const t = tile(
        JSON.stringify(['cursor', frame.cursor.style, cell, options.cursor]),
        cursorWidth,
        pixelHeight,
        (c) => {
          if (frame.cursor.style === 'block') {
            c.save()
            c.scale(1 / dpr, 1 / dpr)
            c.fillStyle = options.cursor
            c.fillRect(0, 0, cursorWidth, pixelHeight)
            c.restore()
          }
          c.translate(-frame.cursor.x * cw, -frame.cursor.y * ch)
          drawCursor(c, frame, options, frame.cursor.style === 'block')
        },
      )
      quad(
        t,
        frame.cursor.x * cw,
        frame.cursor.y * ch,
        cw * span,
        ch,
        frame.cursor.style === 'block' && opaqueColor(options.cursor),
      )
    }
    return {
      batches,
      vertices: this.vertices.subarray(0, vertexCount * 4),
      background: this.background,
    }
  }
}
