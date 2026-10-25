import sharp from 'sharp'
import type { BrowserFrame } from '../../previews/browser.js'

/** Per-viewer link budget: a slow phone must not reduce another viewer's quality. */
export class BrowserFrameEncoder {
  private previous?: { sentAt: number; receivedAt: number }
  private bytesPerMs?: number
  private measuredAt = 0
  private probedAt = 0

  observe(sent: { sentAt: number; bytes: number }, now: number, decodeMs: number) {
    if (decodeMs > 24) {
      this.previous = undefined
      return
    }
    const previous = this.previous
    this.previous = { sentAt: sent.sentAt, receivedAt: now }
    if (!previous) return
    const sentGap = sent.sentAt - previous.sentAt
    const receivedGap = now - previous.receivedAt
    // Closely sent frames that arrive farther apart reveal serialization.
    // Neither a high RTT alone nor a source rendering at 30fps means a slow link.
    if (sentGap < 0 || sentGap > 32 || receivedGap < 32 || receivedGap <= sentGap + 12) return
    const rate = sent.bytes / receivedGap
    this.bytesPerMs =
      this.bytesPerMs === undefined
        ? rate
        : this.bytesPerMs * (rate < this.bytesPerMs ? 0.4 : 0.8) +
          rate * (rate < this.bytesPerMs ? 0.6 : 0.2)
    this.measuredAt = this.probedAt = now
  }

  budget(now = performance.now()) {
    if (this.bytesPerMs === undefined) return Infinity
    // Probe gradually after a route improves; do not remain blurry for the rest
    // of a session simply because its first connection used cellular data.
    if (now - this.measuredAt > 3000 && now - this.probedAt >= 1000) {
      this.bytesPerMs *= 1.25
      this.probedAt = now
    }
    return Math.max(3000, Math.min(192 * 1024, this.bytesPerMs * 32))
  }

  async encode(frame: BrowserFrame, budget: number): Promise<BrowserFrame> {
    // Preserve original pixels on fast connections and all inexpensive frames.
    // Idle detail may use a larger budget, but cannot monopolize a narrow link.
    const allowance = budget * (frame.detail ? 3 : 1)
    if (frame.data.byteLength <= allowance * 1.15) return frame
    const scale = Math.max(0.5, Math.min(1, Math.sqrt(allowance / frame.data.byteLength) * 1.7))
    const data = await sharp(frame.data, { limitInputPixels: 4096 * 4096 })
      .resize({
        width: Math.max(1, Math.round(frame.width * scale)),
        height: Math.max(1, Math.round(frame.height * scale)),
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: frame.detail ? 80 : 60 })
      .toBuffer()
    return data.byteLength < frame.data.byteLength ? { ...frame, data } : frame
  }
}
