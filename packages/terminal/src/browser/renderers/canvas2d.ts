import type {
  TerminalRenderCell,
  TerminalRenderFrame,
  TerminalRenderOptions,
  TerminalRenderer,
} from '../render-types'
import { drawCell, drawCursor } from './scene'

export type Canvas2DLifecycle = {
  onSuspend?: () => void
  onRestore?: () => void
  onPermanentLoss?: (error: Error) => void
}

const RESTORE_TIMEOUT_MS = 5000
/** Ink extents are measured once per font and grapheme; the bound caps worst-case Unicode churn. */
const GLYPH_METRICS_LIMIT = 4096
const BOLD = 1,
  ITALIC = 2,
  UNDERLINE = 4,
  STRIKETHROUGH = 8,
  INVISIBLE = 32,
  FAINT = 128

const OPAQUE_COLOR = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\))$/i

type GlyphBounds = { left: number; right: number }

/**
 * Retained-mode Canvas2D painter. It follows `drawFrame` in scene.ts, but:
 * - repaints only device-pixel row bands whose cells or cursor changed;
 * - skips default-background fills and merges equal background runs (the
 *   rounded device-pixel rectangles tile exactly, so merging is lossless);
 * - skips blank glyphs and keeps font/fill state between cells;
 * - clips glyphs once per row (the same vertical edges as drawCell) and skips
 *   the per-cell clip only when the glyph's ink, allowing for origin snapping,
 *   touches no device pixel column that the cell clip covers partially. Such a
 *   clip cannot change a pixel. Decorated, overflowing, and unknown glyphs
 *   still use scene's `drawCell`.
 */
export class Canvas2DPainter {
  private valid = false
  private rows = 0
  private cols = 0
  private texts: (string | undefined)[] = []
  private widths = new Int32Array(0)
  private foregrounds: string[] = []
  private backgrounds: string[] = []
  private flags = new Int32Array(0)
  private cursor: TerminalRenderFrame['cursor'] | undefined
  private optionsKey = ''
  private fonts = ['', '', '', '']
  private opaqueBackground = false
  private readonly glyphs = new Map<string, GlyphBounds>()
  // Cached context state; undefined forces the next assignment.
  private font: string | undefined
  private fill: string | undefined
  private alpha: number | undefined

  constructor(private readonly ctx: OffscreenCanvasRenderingContext2D) {}

  /** The canvas bitmap no longer holds the previous frame. */
  invalidate(): void {
    this.valid = false
  }

  /** Number of measured glyph extents; exposed for bounded-cache tests. */
  get glyphCount(): number {
    return this.glyphs.size
  }

  render(
    frame: TerminalRenderFrame,
    options: TerminalRenderOptions,
    width: number,
    height: number,
  ): void {
    const ctx = this.ctx
    const key = JSON.stringify([
      options.fontFamily,
      options.fontSize,
      options.cellWidth,
      options.cellHeight,
      options.baseline,
      options.devicePixelRatio,
      options.background,
      options.cursor,
    ])
    if (key !== this.optionsKey) {
      this.optionsKey = key
      this.valid = false
      this.glyphs.clear()
      const font = `${options.fontSize}px ${options.fontFamily}`
      this.fonts = [font, `bold ${font}`, `italic ${font}`, `italic bold ${font}`]
      this.opaqueBackground = OPAQUE_COLOR.test(options.background.trim())
    }
    const { rows, cols } = frame
    if (rows !== this.rows || cols !== this.cols) {
      this.rows = rows
      this.cols = cols
      this.texts = new Array(rows * cols)
      this.widths = new Int32Array(rows * cols).fill(-1)
      this.foregrounds = new Array(rows * cols)
      this.backgrounds = new Array(rows * cols)
      this.flags = new Int32Array(rows * cols)
      this.valid = false
    }

    const dirty = new Uint8Array(rows)
    const fractionalRows = !Number.isInteger(options.cellHeight * options.devicePixelRatio)
    let full = !this.valid
    if (!full) {
      for (let y = 0; y < rows; y++) if (this.updateRow(frame, y)) dirty[y] = 1
      const previous = this.cursor
      const next = frame.cursor
      if (
        !previous ||
        previous.x !== next.x ||
        previous.y !== next.y ||
        previous.visible !== next.visible ||
        previous.style !== next.style
      ) {
        if (previous?.visible && previous.y >= 0 && previous.y < rows) dirty[previous.y] = 1
        if (next.visible && next.y >= 0 && next.y < rows) dirty[next.y] = 1
      }
      let count = 0
      for (let y = 0; y < rows; y++) count += dirty[y]
      if (count === 0) return
      // Every cell paints only inside its own rectangle. When row boundaries
      // fall between device pixels, antialiased edges reach the neighbouring
      // row band, so that band must be repainted to remove stale coverage.
      if (fractionalRows) {
        const grown = dirty.slice()
        for (let y = 0; y < rows; y++)
          if (dirty[y]) {
            if (y > 0) grown[y - 1] = 1
            if (y + 1 < rows) grown[y + 1] = 1
          }
        dirty.set(grown)
        count = 0
        for (let y = 0; y < rows; y++) count += dirty[y]
      }
      if (count * 2 > rows) full = true
    } else for (let y = 0; y < rows; y++) this.updateRow(frame, y)
    this.cursor = { ...frame.cursor }

    this.font = this.fill = this.alpha = undefined
    ctx.globalAlpha = 1
    ctx.textBaseline = 'alphabetic'
    if (full) {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, width, height)
      ctx.fillStyle = options.background
      ctx.fillRect(0, 0, width, height)
      this.paint(frame, options, 0, rows - 1, false)
      this.valid = true
      return
    }
    const dpr = options.devicePixelRatio
    for (let y = 0; y < rows; y++) {
      if (!dirty[y]) continue
      let end = y
      while (end + 1 < rows && dirty[end + 1]) end++
      const top = Math.round(y * options.cellHeight * dpr)
      // The last row's antialiased edge can reach the pixel row below its
      // rounded band, which no other row owns; extend its band to the canvas end.
      const bottom = end === rows - 1 ? height : Math.round((end + 1) * options.cellHeight * dpr)
      ctx.save()
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.beginPath()
      ctx.rect(0, top, width, bottom - top)
      ctx.clip()
      ctx.clearRect(0, top, width, bottom - top)
      ctx.fillStyle = options.background
      ctx.fillRect(0, top, width, bottom - top)
      this.font = this.fill = this.alpha = undefined
      this.paint(frame, options, y, end, fractionalRows)
      ctx.restore()
      this.font = this.fill = this.alpha = undefined
      y = end
    }
  }

  /** Records a row and reports whether any of its cells differ from the previous frame. */
  private updateRow(frame: TerminalRenderFrame, y: number): boolean {
    const row = frame.cells[y]
    let changed = false
    for (let x = 0, index = y * this.cols; x < this.cols; x++, index++) {
      const cell = row?.[x]
      if (!cell) {
        if (this.widths[index] !== -1) {
          this.widths[index] = -1
          this.texts[index] = undefined
          changed = true
        }
        continue
      }
      if (
        this.texts[index] !== cell.text ||
        this.widths[index] !== cell.width ||
        this.foregrounds[index] !== cell.foreground ||
        this.backgrounds[index] !== cell.background ||
        this.flags[index] !== cell.flags
      ) {
        this.texts[index] = cell.text
        this.widths[index] = cell.width
        this.foregrounds[index] = cell.foreground
        this.backgrounds[index] = cell.background
        this.flags[index] = cell.flags
        changed = true
      }
    }
    return changed
  }

  /**
   * Paints rows `first`..`last` over an already-filled background, preserving
   * drawFrame's order: backgrounds, then glyphs row-major, then the cursor.
   * With `neighbours`, glyphs and the cursor of adjacent rows are included
   * because their antialiased edges reach into the (clipped) band.
   */
  private paint(
    frame: TerminalRenderFrame,
    options: TerminalRenderOptions,
    first: number,
    last: number,
    neighbours: boolean,
  ): void {
    const ctx = this.ctx
    const dpr = options.devicePixelRatio,
      cw = options.cellWidth,
      ch = options.cellHeight
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    for (let y = first; y <= last; y++) {
      const row = frame.cells[y]
      if (!row) continue
      const top = Math.round(y * ch * dpr)
      const bottom = Math.round((y + 1) * ch * dpr)
      let runColor: string | undefined
      let runLeft = 0
      let runRight = 0
      let runEnd = -1
      for (let x = 0; x < frame.cols; x++) {
        const cell = row[x]
        if (!cell || cell.width === 0) continue
        const end = x + Math.max(1, cell.width)
        if (cell.background === runColor && x === runEnd) {
          runRight = Math.round(end * cw * dpr)
          runEnd = end
          continue
        }
        if (runColor !== undefined) this.fillDevice(runColor, runLeft, top, runRight, bottom)
        runColor = undefined
        // Default backgrounds were filled with the band; an identical opaque
        // fill on top cannot change a pixel.
        if (this.opaqueBackground && cell.background === options.background) continue
        runColor = cell.background
        runLeft = Math.round(x * cw * dpr)
        runRight = Math.round(end * cw * dpr)
        runEnd = end
      }
      if (runColor !== undefined) this.fillDevice(runColor, runLeft, top, runRight, bottom)
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const from = neighbours ? Math.max(0, first - 1) : first,
      to = neighbours ? Math.min(frame.rows - 1, last + 1) : last
    // One clip per row reproduces drawCell's vertical clip edges exactly; the
    // per-cell horizontal edges matter only for glyphs that fail the fit test.
    const clipWidth = (frame.cols + 2) * cw
    for (let y = from; y <= to; y++) {
      const row = frame.cells[y]
      if (!row) continue
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, y * ch, clipWidth, ch)
      ctx.clip()
      for (let x = 0; x < frame.cols; x++) {
        const cell = row[x]
        if (!cell || cell.width === 0) continue
        this.glyph(cell, x * cw, y * ch, options, cw * Math.max(1, cell.width))
      }
      ctx.restore()
      this.font = this.fill = this.alpha = undefined
    }
    const cursor = frame.cursor
    if (cursor.visible && cursor.y >= from && cursor.y <= to) {
      drawCursor(ctx, frame, options)
      this.font = this.fill = this.alpha = undefined
    }
  }

  private fillDevice(color: string, left: number, top: number, right: number, bottom: number) {
    if (this.fill !== color) this.ctx.fillStyle = this.fill = color
    this.ctx.fillRect(left, top, right - left, bottom - top)
  }

  private glyph(
    cell: TerminalRenderCell,
    x: number,
    y: number,
    options: TerminalRenderOptions,
    width: number,
  ): void {
    const flags = cell.flags
    if (flags & INVISIBLE) return
    const decorated = flags & (UNDERLINE | STRIKETHROUGH)
    const text = cell.text
    if (!decorated && (!text || text === ' ')) return
    const ctx = this.ctx
    const font = this.fonts[(flags & BOLD ? 1 : 0) | (flags & ITALIC ? 2 : 0)]
    if (!decorated) {
      if (this.font !== font) ctx.font = this.font = font
      if (this.unclipped(this.bounds(font, text), x, width, options.devicePixelRatio)) {
        if (this.fill !== cell.foreground) ctx.fillStyle = this.fill = cell.foreground
        const alpha = flags & FAINT ? 0.5 : 1
        if (this.alpha !== alpha) ctx.globalAlpha = this.alpha = alpha
        ctx.fillText(text, x, y + options.baseline)
        return
      }
    }
    if (this.alpha !== 1) ctx.globalAlpha = this.alpha = 1
    drawCell(ctx, cell, x, y, options, width)
    // drawCell restores the context, but our cached font/fill may be stale.
    this.font = this.fill = undefined
  }

  /**
   * Whether the cell's horizontal clip is a no-op: in device pixels, the ink
   * (widened by half a pixel for glyph-origin snapping) must stay within the
   * columns the clip covers fully. Vertical extent is clipped per row.
   */
  private unclipped(bounds: GlyphBounds, x: number, width: number, dpr: number): boolean {
    const epsilon = 1e-4
    const first = Math.ceil(x * dpr - epsilon)
    const last = Math.floor((x + width) * dpr + epsilon)
    return (x - bounds.left) * dpr - 0.5 >= first && (x + bounds.right) * dpr + 0.5 <= last
  }

  private bounds(font: string, text: string): GlyphBounds {
    const key = `${font}\u0000${text}`
    let bounds = this.glyphs.get(key)
    if (bounds) return bounds
    const metrics = this.ctx.measureText(text)
    bounds = {
      // actualBoundingBoxLeft is positive when ink extends left of the origin.
      left: metrics.actualBoundingBoxLeft,
      right: metrics.actualBoundingBoxRight,
    }
    // Non-finite metrics fail every comparison and fall back to the clip.
    if (this.glyphs.size >= GLYPH_METRICS_LIMIT) this.glyphs.clear()
    this.glyphs.set(key, bounds)
    return bounds
  }
}

export function createCanvas2D(
  canvas: OffscreenCanvas,
  lifecycle?: Canvas2DLifecycle,
): TerminalRenderer {
  // Favor Chromium's software-backed canvas for the emergency renderer so a
  // failing GPU process does not also take down the final fallback.
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Canvas2D is unavailable')
  // The canvas retains the previous frame. Callers must not read it
  // destructively (e.g. transferToImageBitmap) without resizing it afterwards.
  const painter = new Canvas2DPainter(context)
  let isLost = false
  let permanentLoss: Error | undefined
  let errorReported = false
  let timeout: ReturnType<typeof setTimeout> | undefined
  const lost = () => {
    if (isLost) return
    isLost = true
    permanentLoss = undefined
    errorReported = false
    painter.invalidate()
    lifecycle?.onSuspend?.()
    // Unlike WebGL, cancelling a Canvas2D contextlost event prevents the
    // browser from attempting to restore its backing store.
    timeout = setTimeout(() => {
      timeout = undefined
      permanentLoss = new Error('Terminal Canvas2D context was not restored')
      if (lifecycle?.onPermanentLoss) {
        errorReported = true
        lifecycle.onPermanentLoss(permanentLoss)
      }
    }, RESTORE_TIMEOUT_MS)
  }
  const restored = () => {
    if (!isLost) return
    if (timeout !== undefined) clearTimeout(timeout)
    timeout = undefined
    isLost = false
    permanentLoss = undefined
    errorReported = false
    painter.invalidate()
    lifecycle?.onRestore?.()
  }
  canvas.addEventListener('contextlost', lost)
  canvas.addEventListener('contextrestored', restored)
  return {
    kind: 'canvas2d',
    resize(width, height) {
      canvas.width = width
      canvas.height = height
      painter.invalidate()
    },
    render(frame, options) {
      if (isLost) {
        if (permanentLoss && !errorReported) {
          errorReported = true
          throw permanentLoss
        }
        return
      }
      painter.render(frame, options, canvas.width, canvas.height)
    },
    dispose() {
      if (timeout !== undefined) clearTimeout(timeout)
      canvas.removeEventListener('contextlost', lost)
      canvas.removeEventListener('contextrestored', restored)
    },
  }
}
