import { encodeTerminalStreamFrame } from '@dovo/protocol'
import { WebSocket } from 'ws'

// The parser must acknowledge data before more than this window can be sent.
const WINDOW = 256 * 1024
const CHUNK = 16 * 1024
// Replay can contain up to 1 Mi UTF-16 code units, or 3 MiB UTF-8.
const QUEUE_LIMIT = 4 * 1024 * 1024
const PAUSE_AT = 256 * 1024
const RESUME_AT = 64 * 1024
const STALE_MS = 30_000

type Item =
  | { type: 'data'; data: Uint8Array; offset: number; replay: boolean }
  | { type: 'replayStart' | 'replayEnd' }

export class BinaryTerminalStream {
  private queue: Item[] = []
  private queued = 0
  private liveQueued = 0
  private pressured = false
  private stale: ReturnType<typeof setTimeout> | undefined
  private outstanding = 0
  private pendingHigh = ''
  private replayPending = false
  private stopped = false
  private scheduled: ReturnType<typeof setImmediate> | undefined
  private encoder = new TextEncoder()
  constructor(
    private socket: WebSocket,
    private pressure: (paused: boolean) => void = () => {},
  ) {}

  replay(data: string) {
    this.queue.push({ type: 'replayStart' })
    // The retained UTF-16 suffix can begin halfway through a surrogate pair.
    if (data.length && data.charCodeAt(0) >= 0xdc00 && data.charCodeAt(0) <= 0xdfff)
      data = data.slice(1)
    this.enqueue(data, true)
    this.replayPending = !!this.pendingHigh
    if (!this.replayPending) this.queue.push({ type: 'replayEnd' })
    this.schedule()
  }
  data(data: string) {
    if (this.replayPending && data.length) {
      const low = data.charCodeAt(0)
      const pair = low >= 0xdc00 && low <= 0xdfff ? data.slice(0, 1) : ''
      // Finish the replay's final scalar before its boundary, even if its low
      // surrogate arrives in the first live PTY callback.
      const high = this.pendingHigh
      this.pendingHigh = ''
      this.enqueue(pair ? high + pair : '\ufffd', true)
      this.queue.push({ type: 'replayEnd' })
      this.replayPending = false
      if (pair) data = data.slice(1)
    }
    this.enqueue(data, false)
  }
  private enqueue(data: string, replay: boolean) {
    data = this.pendingHigh + data
    this.pendingHigh = ''
    const last = data.charCodeAt(data.length - 1)
    if (last >= 0xd800 && last <= 0xdbff) {
      this.pendingHigh = data.slice(-1)
      data = data.slice(0, -1)
    }
    if (!data || this.stopped) return
    const bytes = this.encoder.encode(data)
    if (this.queued + bytes.length > QUEUE_LIMIT) {
      this.stop()
      this.socket.close(1013, 'Terminal client is too slow')
      return
    }
    this.queued += bytes.length
    this.queue.push({ type: 'data', data: bytes, offset: 0, replay })
    if (!replay) this.liveQueued += bytes.length
    this.updatePressure()
    this.schedule()
  }
  ack(bytes: number) {
    if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > this.outstanding)
      throw new Error('Invalid terminal acknowledgement')
    this.outstanding -= bytes
    this.schedule()
  }
  pong(nonce: string) {
    if (!this.stopped && this.socket.readyState === WebSocket.OPEN)
      this.socket.send(encodeTerminalStreamFrame({ type: 'pong', nonce }), { binary: true })
  }
  stop() {
    this.stopped = true
    if (this.scheduled) clearImmediate(this.scheduled)
    this.queue = []
    this.queued = 0
    this.liveQueued = 0
    this.releasePressure()
  }
  private releasePressure() {
    if (this.stale) clearTimeout(this.stale)
    this.stale = undefined
    if (this.pressured) {
      this.pressured = false
      this.pressure(false)
    }
  }
  private updatePressure() {
    if (!this.pressured && this.liveQueued >= PAUSE_AT) {
      this.pressured = true
      this.pressure(true)
      // A connected but stalled parser must not indefinitely freeze a shared shell.
      this.stale = setTimeout(() => {
        this.stop()
        this.socket.close(1013, 'Terminal client stopped consuming output')
      }, STALE_MS)
      this.stale.unref()
    } else if (this.pressured && this.liveQueued <= RESUME_AT) this.releasePressure()
  }
  private schedule() {
    if (!this.stopped && !this.scheduled) this.scheduled = setImmediate(() => this.flush())
  }
  private flush() {
    this.scheduled = undefined
    if (this.stopped || this.socket.readyState !== WebSocket.OPEN) return
    // Limit work per turn as well as bytes in flight.
    let frames = 0
    while (this.queue.length && frames++ < 16) {
      const item = this.queue[0]!
      if (item.type !== 'data') {
        this.queue.shift()
        this.socket.send(encodeTerminalStreamFrame(item), { binary: true })
        continue
      }
      const available = WINDOW - this.outstanding
      if (available < 4) break
      let end = Math.min(item.offset + CHUNK, item.offset + available, item.data.length)
      // Each frame is independently valid UTF-8, even at credit boundaries.
      while (end < item.data.length && (item.data[end]! & 0xc0) === 0x80) end--
      const data = item.data.subarray(item.offset, end)
      item.offset = end
      this.queued -= data.length
      if (!item.replay) this.liveQueued -= data.length
      this.outstanding += data.length
      if (end === item.data.length) this.queue.shift()
      this.socket.send(encodeTerminalStreamFrame({ type: 'data', data }), { binary: true })
    }
    this.updatePressure()
    if (this.queue.length && WINDOW - this.outstanding >= 4) this.schedule()
  }
}
