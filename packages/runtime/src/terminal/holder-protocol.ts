// Shared by the runtime and the holder process. The holder runs this file directly from source
// in a development checkout, so it may import Node built-ins only and use erasable TypeScript.
import { createHash } from 'node:crypto'
import { lstatSync, mkdirSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { TerminalActivity, TerminalInfo } from '@dovo/protocol'
import type { TerminalHookActivity } from './hook-activity.js'

/** Bump on any incompatible message change. A runtime never drives a holder of another version. */
export const HOLDER_PROTOCOL = 2
/** UTF-16 code units of output the holder keeps for each terminal while no runtime reads it. */
export const HOLDER_REPLAY_LIMIT = 1024 * 1024
/** Upper bound for one message line. Output is sent in smaller pieces. */
export const HOLDER_LINE_LIMIT = 8 * 1024 * 1024
/** Input and output travel in pieces of at most this many code units. */
export const HOLDER_DATA_CHUNK = 64 * 1024
/** JSON escapes a control character as six characters, such as \u001b. */
export const JSON_ESCAPE_FACTOR = 6

/** Split text into pieces without separating a surrogate pair. */
export function splitText(text: string, size = HOLDER_DATA_CHUNK) {
  if (text.length <= size) return [text]
  const pieces: string[] = []
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + size, text.length)
    const last = text.charCodeAt(end - 1)
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--
    pieces.push(text.slice(start, end))
    start = end
  }
  return pieces
}
export const HOLDER_KEY_FILE = 'holder.key'
export const HOLDER_STATE_FILE = 'holder.json'

export type HolderSpawn = {
  file: string
  args: string[]
  cwd: string
  env: Record<string, string>
  cols: number
  rows: number
}
export type HolderTerminalState = {
  id: string
  pid: number
  /** Total output length so far. A reconnecting client asks for output after its last offset. */
  end: number
  process: string
  exited: boolean
  exitCode?: number
  /** Present on holders that count root OSC activity at the PTY. */
  rootActivity?: HolderRootActivity
  /** Complete child state at end, including records outside the replay window. */
  childActivities?: TerminalInfo['childActivities']
}
export type HolderMergedActivity = {
  /** Completed root periods since this PTY started, across OSC and lifecycle hooks. */
  turn: number
  activity: TerminalActivity | null
  hookError?: string
}
export type HolderRootActivity = {
  turn: number
  activity: TerminalActivity | null
  at: number
  /** The preceding fields retain their OSC-only meaning for older runtimes. */
  merged?: HolderMergedActivity
}
/** The checkpoint describes VT state at a UTF-16 offset in the original PTY stream. */
export type HolderReplayScreen =
  | { kind: 'checkpoint'; offset: number; cols: number; rows: number; ansi: string }
  | { kind: 'unavailable' }

export type HolderRequest =
  | { t: 'hello'; v: number; key: string }
  | { t: 'create'; r: number; id: string; spawn: HolderSpawn; initialInput?: string; screen?: true }
  | { t: 'attach'; r: number; id: string; from?: number; screen?: true }
  | { t: 'close'; r: number; id: string }
  | { t: 'input'; id: string; data: string }
  | { t: 'send'; r: number; id: string; data: string }
  | { t: 'resize'; id: string; cols: number; rows: number }
  | { t: 'pause'; id: string }
  | { t: 'resume'; id: string }
export type HolderMessage =
  | { t: 'hello'; v: number; pid: number; terminals: HolderTerminalState[] }
  | { t: 'denied'; message: string }
  | {
      t: 'reply'
      r: number
      ok: true
      terminal?: HolderTerminalState
      replay?: string
      screen?: HolderReplayScreen
      rawPrefix?: string
      hookActivity?: TerminalHookActivity
    }
  | { t: 'reply'; r: number; ok: false; message: string; missing?: boolean }
  | { t: 'data'; id: string; data: string }
  | { t: 'activity'; id: string; root: HolderRootActivity }
  | { t: 'process'; id: string; name: string }
  | { t: 'exit'; id: string; exitCode: number; rootActivity?: HolderRootActivity }

const UUID = /^[a-f0-9-]{36}$/
export function holderTerminalId(id: unknown): id is string {
  return typeof id === 'string' && UUID.test(id)
}

/** A private directory must be a real directory owned by this user and closed to others. */
export function ensurePrivateDirectory(directory: string) {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const stat = lstatSync(directory)
  if (!stat.isDirectory()) throw new Error(`Terminal holder path is not a directory: ${directory}`)
  const uid = process.getuid?.()
  if (uid !== undefined && stat.uid !== uid)
    throw new Error(`Terminal holder directory belongs to another user: ${directory}`)
  if ((stat.mode & 0o077) !== 0) chmodSync(directory, 0o700)
}

/** Unix socket paths are limited to about 100 bytes. A long data path uses a private temp folder. */
export function holderSocketPath(directory: string) {
  const local = join(resolve(directory), 'holder.sock')
  if (Buffer.byteLength(local) <= 100) return local
  const hash = createHash('sha256').update(resolve(directory)).digest('hex').slice(0, 20)
  return join(tmpdir(), `dovo-${process.getuid?.() ?? 'user'}`, `${hash}.sock`)
}

/**
 * Newline-delimited JSON. Lengths count UTF-16 code units, as `JSON.stringify` does. A line over
 * the limit, complete or not, ends the stream before it reaches JSON parsing. After an overflow
 * the reader ignores all further input, including later lines in the same chunk.
 */
export function lineReader(
  onLine: (line: string) => void,
  onOverflow: () => void,
  limit = HOLDER_LINE_LIMIT,
) {
  let parts: string[] = []
  let length = 0
  let stopped = false
  const overflow = () => {
    stopped = true
    parts = []
    length = 0
    onOverflow()
  }
  return (chunk: string) => {
    let offset = 0
    // Scan only new input, so a long partial line costs linear time.
    while (!stopped) {
      const index = chunk.indexOf('\n', offset)
      const end = index === -1 ? chunk.length : index
      if (length + end - offset > limit) return overflow()
      if (index === -1) {
        if (end > offset) {
          parts.push(chunk.slice(offset))
          length += end - offset
        }
        return
      }
      parts.push(chunk.slice(offset, index))
      const line = parts.length === 1 ? parts[0]! : parts.join('')
      parts = []
      length = 0
      offset = index + 1
      if (line) onLine(line)
    }
  }
}

/**
 * Keeps the newest output within a UTF-16 cap and reports the absolute end offset. Small PTY
 * writes join the last chunk up to 4 KiB, so many tiny writes neither create many strings
 * nor copy the whole window.
 */
export class HolderOutput {
  private chunks: string[] = []
  private head = 0
  /** Writes under 4 KiB wait here and join into one flat string, not a chain of small strings. */
  private tail: string[] = []
  private tailLength = 0
  private length = 0
  end = 0
  get start() {
    return this.end - this.length
  }
  append(data: string) {
    if (!data.length) return
    this.end += data.length
    this.length += data.length
    this.tail.push(data)
    this.tailLength += data.length
    if (this.tailLength >= 4096) {
      this.chunks.push(this.tail.length === 1 ? data : this.tail.join(''))
      this.tail = []
      this.tailLength = 0
    }
    // The tail is far below the cap, so trimming whole chunks always suffices.
    while (this.length > HOLDER_REPLAY_LIMIT) {
      const first = this.chunks[this.head]!
      const remove = Math.min(this.length - HOLDER_REPLAY_LIMIT, first.length)
      this.length -= remove
      if (remove === first.length) this.chunks[this.head++] = ''
      else this.chunks[this.head] = first.slice(remove)
    }
    // Drop removed slots in bulk instead of shifting the array on every trim.
    if (this.head >= 64 && this.head * 2 >= this.chunks.length) {
      this.chunks = this.chunks.slice(this.head)
      this.head = 0
    }
  }
  /** Output after `from`, or everything retained when `from` is absent or already discarded. */
  since(from?: number) {
    const text = this.chunks.slice(this.head).join('') + this.tail.join('')
    if (from === undefined || from > this.end) return text
    const start = this.end - text.length
    return text.slice(Math.max(0, from - start))
  }
}
