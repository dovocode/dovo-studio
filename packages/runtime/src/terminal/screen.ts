import headless from '@xterm/headless'
import serialization from '@xterm/addon-serialize'
import type { TerminalScreen } from '@dovo/protocol'

const writeChunkSize = 16 * 1024
const maxPendingText = 2 * 1024 * 1024
const maxPendingWrites = 2048
const pauseAtText = 256 * 1024
const resumeAtText = 64 * 1024
const maxPendingReads = 32
const maxScreenText = 128 * 1024
const maxReplayText = 1024 * 1024
const scrollback = 256

function member(value: unknown, key: string): unknown {
  return value !== null && typeof value === 'object' ? Reflect.get(value, key) : undefined
}

function atParserBoundary(terminal: headless.Terminal) {
  // The 6.0.0 serializer snapshots cells and modes, but cannot replay an incomplete
  // command or surrogate. Fall back to the raw stream if the decoder is mid-token.
  const input = member(member(terminal, '_core'), '_inputHandler')
  const parser = member(input, '_parser')
  const state = member(parser, 'currentState')
  return (
    typeof state === 'number' &&
    state === member(parser, 'initialState') &&
    member(member(input, '_stringDecoder'), '_interim') === 0
  )
}

/** Parse PTY output without sending replies. Interactive clients still own device queries. */
export class TerminalScreenState {
  private terminal: headless.Terminal | undefined
  private serializer: serialization.SerializeAddon | undefined
  private pendingText = 0
  private pendingWrites = 0
  private reads = new Set<() => void>()
  private pressured = false
  private pressure: ((paused: boolean) => void) | undefined

  constructor(cols: number, rows: number, pressure?: (paused: boolean) => void) {
    this.pressure = pressure
    this.restore(cols, rows, '')
  }

  restore(cols: number, rows: number, ansi: string) {
    this.dispose()
    const terminal = new headless.Terminal({ cols, rows, scrollback, allowProposedApi: true })
    const serializer = new serialization.SerializeAddon()
    terminal.loadAddon(serializer)
    this.terminal = terminal
    this.serializer = serializer
    this.write(ansi)
  }

  get alternate() {
    return this.terminal?.buffer.active.type === 'alternate'
  }

  write(data: string) {
    if (!this.terminal || !data.length) return
    if (
      this.pendingText + data.length > maxPendingText ||
      this.pendingWrites + Math.ceil(data.length / writeChunkSize) > maxPendingWrites
    ) {
      // Skipping any part of a VT stream would make later state look valid when it is not.
      this.dispose()
      return
    }
    for (let offset = 0; offset < data.length; offset += writeChunkSize)
      this.enqueue(data.slice(offset, offset + writeChunkSize))
    if (!this.pressured && (this.pendingText >= pauseAtText || this.pendingWrites >= 512)) {
      this.pressured = true
      this.pressure?.(true)
    }
  }

  private enqueue(data: string, callback?: () => void) {
    const terminal = this.terminal
    if (!terminal) return
    this.pendingText += data.length
    this.pendingWrites++
    terminal.write(data, () => {
      if (this.terminal !== terminal) return
      this.pendingText -= data.length
      this.pendingWrites--
      if (this.pressured && this.pendingText <= resumeAtText && this.pendingWrites <= 128) {
        this.pressured = false
        this.pressure?.(false)
      }
      callback?.()
    })
  }

  resize(cols: number, rows: number) {
    if (!this.pendingWrites) this.terminal?.resize(cols, rows)
    else if (this.pendingWrites < maxPendingWrites)
      this.enqueue('', () => this.terminal?.resize(cols, rows))
    else this.dispose()
  }

  private async afterWrites<T>(read: (terminal: headless.Terminal) => T): Promise<T | undefined> {
    const terminal = this.terminal
    if (!terminal || this.reads.size >= maxPendingReads) return
    if (!this.pendingWrites) return read(terminal)
    return new Promise((resolve, reject) => {
      const cancel = () => resolve(undefined)
      this.reads.add(cancel)
      this.enqueue('', () => {
        this.reads.delete(cancel)
        try {
          resolve(read(terminal))
        } catch (cause) {
          reject(cause)
        }
      })
    })
  }

  screen(
    id: string,
    lines?: number,
    mapText = (text: string) => text,
  ): Promise<TerminalScreen | undefined> {
    return this.afterWrites(({ cols, rows, buffer: { active } }) => {
      const end = active.baseY + rows
      const lineCount = Math.min(lines ?? rows, end)
      const visible: string[] = []
      let characters = 0
      for (let row = end - lineCount; row < end; row++) {
        const line = active.getLine(row)?.translateToString(true) ?? ''
        characters += line.length + (visible.length ? 1 : 0)
        visible.push(line)
        if (characters > maxScreenText) break
      }
      const text = mapText(visible.join('\n'))
      return {
        id,
        cols,
        rows,
        buffer: active.type,
        cursor: { row: active.cursorY, column: Math.min(cols - 1, active.cursorX) },
        text: text.slice(0, maxScreenText),
        truncated: lineCount < rows || characters > maxScreenText || text.length > maxScreenText,
      }
    })
  }

  replay() {
    return this.afterWrites((terminal) => {
      if (!atParserBoundary(terminal)) return
      const serializer = this.serializer
      if (!serializer) return
      // The addon preserves mouse tracking levels. xterm keeps wire format and cursor
      // visibility in separate services, so restore those modes after the checkpoint.
      const core = member(terminal, '_core')
      const hidden = member(member(core, 'coreService'), 'isCursorHidden') === true
      const mouse = member(member(core, 'coreMouseService'), 'activeEncoding')
      const modes =
        (hidden ? '\x1b[?25l' : '') +
        (mouse === 'SGR' ? '\x1b[?1006h' : mouse === 'SGR_PIXELS' ? '\x1b[?1016h' : '')
      const output = serializer.serialize()
      if (output.length + modes.length <= maxReplayText) return output + modes
      const viewport = serializer.serialize({ scrollback: 0 })
      if (viewport.length + modes.length <= maxReplayText) return viewport + modes
    })
  }

  dispose() {
    this.terminal?.dispose()
    this.terminal = undefined
    this.serializer = undefined
    this.pendingWrites = 0
    this.pendingText = 0
    for (const cancel of this.reads) cancel()
    this.reads.clear()
    if (this.pressured) {
      this.pressured = false
      this.pressure?.(false)
    }
  }
}
