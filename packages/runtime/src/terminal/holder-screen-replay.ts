import type { HolderOutput, HolderReplayScreen } from './holder-protocol.js'
import type { TerminalScreenState } from './screen.js'

type Checkpoint = Extract<HolderReplayScreen, { kind: 'checkpoint' }>
type Replay = { replay: string; screen?: HolderReplayScreen; rawPrefix?: string }

/** Keep one safe checkpoint while the parser handles a split VT sequence. Never splice
 * raw text across a resize, since output offsets carry no record of geometry changes. */
export class HolderScreenReplay {
  private readonly output: HolderOutput
  private readonly screen: TerminalScreenState
  private cols: number
  private rows: number
  private generation = 0
  private checkpoint?: Checkpoint
  private pending = false
  private lastCapture = 0

  constructor(output: HolderOutput, screen: TerminalScreenState, cols: number, rows: number) {
    this.output = output
    this.screen = screen
    this.cols = cols
    this.rows = rows
    this.checkpoint = { kind: 'checkpoint', offset: 0, cols, rows, ansi: '' }
  }

  write(data: string) {
    this.output.append(data)
    this.screen.write(data)
    if (!this.pending && this.output.end - this.lastCapture >= 256 * 1024) this.refresh()
  }

  resize(cols: number, rows: number) {
    if (cols === this.cols && rows === this.rows) return
    this.generation++
    this.cols = cols
    this.rows = rows
    this.checkpoint = undefined
    this.screen.resize(cols, rows)
    this.refresh()
  }

  private refresh() {
    if (this.pending) return
    this.pending = true
    this.lastCapture = this.output.end
    const generation = this.generation
    void this.prepare().finally(() => {
      this.pending = false
      if (generation !== this.generation) this.refresh()
    })
  }

  async prepare() {
    const offset = this.output.end,
      cols = this.cols,
      rows = this.rows,
      generation = this.generation
    // replay queues its read behind earlier writes and resizes, before subsequent PTY output.
    const ansi = await this.screen.replay().catch(() => undefined)
    if (
      ansi !== undefined &&
      generation === this.generation &&
      offset >= (this.checkpoint?.offset ?? 0)
    )
      this.checkpoint = { kind: 'checkpoint', offset, cols, rows, ansi }
  }

  /** Build the reply and sample terminal.end in the same event-loop turn at the call site. */
  full(): Replay {
    const raw = this.output.since()
    const start = this.output.start
    const point = this.checkpoint
    if (!point || point.offset < start) return { screen: { kind: 'unavailable' }, replay: raw }
    const split = point.offset - start
    return {
      screen: point,
      ...(split ? { rawPrefix: raw.slice(0, split) } : {}),
      replay: raw.slice(split),
    }
  }

  dispose() {
    this.screen.dispose()
  }
}
