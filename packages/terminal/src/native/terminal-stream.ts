import { startSocketHeartbeat, terminalInputFrames } from '@dovo/client-runtime'
import { decodeTerminalStreamFrame } from '@dovo/protocol/terminal-stream'

/**
 * Socket transport for native terminal renderers (libghostty on iOS/Android).
 *
 * The renderer only parses bytes and reports input/resizes; this controller owns the
 * `/ws/terminal` socket for one connection attempt. It requests binary stream v1
 * (`stream=binary-v1`): framed UTF-8 output with replay boundaries and credit-based flow
 * control. A runtime that ignores the request answers with the legacy text stream (the first
 * text message is the replay), which is handled transparently.
 *
 * Output is written to the renderer strictly in order, one chunk at a time, and acknowledged
 * after the renderer accepts it. The server keeps at most 256 KiB unacknowledged, which bounds
 * the queued JS work. Native `write()` resolves once libghostty has accepted the bytes (iOS
 * queues them for its IO thread; Android parses synchronously), so acknowledgements mean
 * "accepted by the emulator", not "painted".
 *
 * Replays: the renderer is reset first, and input produced by the emulator itself (answers to
 * queries replayed from history, such as device attributes or cursor reports) is not sent to
 * the shell. Native parsing completion is not observable, so after the replay the controller
 * writes a device-status query (DSR 5, `ESC [ 5 n`) as a parse-order barrier and forwards
 * input again once its answer (`ESC [ 0 n`) arrives, counting answers to DSR 5 queries that
 * were part of the replay. A timer ends suppression if the renderer never answers.
 *
 * Input readiness: answers from the emulator and keys typed by the user both arrive through
 * the same native input callback with no origin marker, so they cannot be told apart safely.
 * Rather than guess (or queue keystrokes that might be stale replies), the stream is not
 * `inputReady` until the first replay barrier clears and drops all input before that. Hosts
 * must present that state (`onReady`/`inputReady`) instead of claiming a usable terminal on
 * socket open. Remaining limitation: keys typed while a reconnect replays, e.g. with the
 * keyboard still raised from the previous connection, are discarded.
 */
/** The socket surface the controller uses; binary messages must arrive as ArrayBuffer. */
export type TerminalStreamSocket = {
  readonly readyState: number
  onopen: (() => void) | null
  onmessage: ((event: { data: string | ArrayBuffer }) => void) | null
  onclose: ((event: { reason?: string }) => void) | null
  onerror: (() => void) | null
  send(data: string): void
  close(): void
}

/** Adapts a platform WebSocket (React Native or browser) to TerminalStreamSocket. */
export function webSocketTerminalSocket(url: string): TerminalStreamSocket {
  const socket = new WebSocket(url)
  socket.binaryType = 'arraybuffer'
  const adapter: TerminalStreamSocket = {
    get readyState() {
      return socket.readyState
    },
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    send: (data) => socket.send(data),
    close: () => socket.close(),
  }
  socket.onopen = () => adapter.onopen?.()
  socket.onmessage = (event) => {
    // Blob frames cannot occur with binaryType 'arraybuffer'; ignore anything unexpected.
    if (typeof event.data === 'string' || event.data instanceof ArrayBuffer)
      adapter.onmessage?.({ data: event.data })
  }
  socket.onclose = (event) => adapter.onclose?.({ reason: event.reason })
  socket.onerror = () => adapter.onerror?.()
  return adapter
}

export type TerminalGridSize = { cols: number; rows: number }

/** One output chunk for the renderer: raw UTF-8 bytes (binary v1) or text (legacy). */
export type TerminalOutput = Uint8Array | string

export type TerminalStreamProtocol = 'binary-v1' | 'text'

export type TerminalStreamOptions = {
  /** `/ws/terminal` URL with its ticket; the controller adds the stream parameter. */
  url: string
  /** Request binary stream v1 (default) or stay on the legacy text stream. */
  protocol?: TerminalStreamProtocol
  /** Latest grid size reported by the renderer, sent as soon as the socket opens. */
  size: () => TerminalGridSize | undefined
  /** The socket opened; the runtime's history replay follows. Input is not accepted yet. */
  onOpen: () => void
  /** Called once when the first replay has been consumed and input is forwarded. */
  onReady?: () => void
  /** Feeds output to the renderer. Calls are serialized; resolve once the renderer accepted it. */
  write: (output: TerminalOutput) => Promise<void>
  /** Called at most once when the connection ends without `close()` being called. */
  onClose: (error: Error) => void
  createSocket?: (url: string) => TerminalStreamSocket
  /** Longest wait for the replay barrier answer before input is forwarded again. */
  replaySettleMs?: number
}

export type TerminalStream = {
  readonly open: boolean
  /** True once the replay barrier cleared; input before that is dropped. */
  readonly inputReady: boolean
  /** Which stream the runtime is speaking, once known. */
  readonly protocol: TerminalStreamProtocol | undefined
  input(data: string): void
  resize(size: TerminalGridSize): void
  close(): void
}

/** Full reset (RIS) plus scrollback erase, so a reconnect replay never duplicates history. */
export const terminalResetSequence = '\x1bc\x1b[3J'
/** DSR 5 operating-status query and its answer: the replay parse barrier. */
export const terminalStatusQuery = '\x1b[5n'
export const terminalStatusReport = '\x1b[0n'

const OPEN = 1
/** Runtime binary v1 credit window: unacknowledged output never exceeds this. */
export const terminalStreamWindow = 256 * 1024
/** Legacy text has no credit window; cap what may wait for the renderer before reconnecting. */
export const legacyPendingLimit = 4 * 1024 * 1024
const QUERY = Array.from(terminalStatusQuery, (character) => character.charCodeAt(0))

/** Runtime schema bounds: cols 2–500, rows 1–300. */
export function terminalGridSize(cols: number, rows: number): TerminalGridSize | undefined {
  if (!Number.isFinite(cols) || !Number.isFinite(rows)) return undefined
  return {
    cols: Math.min(500, Math.max(2, Math.floor(cols))),
    rows: Math.min(300, Math.max(1, Math.floor(rows))),
  }
}

/** Adds `stream=binary-v1` without relying on React Native's partial URL implementation. */
export function binaryStreamUrl(url: string) {
  const hash = url.indexOf('#')
  const base = hash === -1 ? url : url.slice(0, hash)
  const fragment = hash === -1 ? '' : url.slice(hash)
  return `${base}${base.includes('?') ? '&' : '?'}stream=binary-v1${fragment}`
}

const base64Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Base64 for native `write()`; bounded by the 16 KiB server frames. */
export function bytesToBase64(bytes: Uint8Array) {
  let result = ''
  let index = 0
  for (; index + 2 < bytes.length; index += 3) {
    const value = (bytes[index]! << 16) | (bytes[index + 1]! << 8) | bytes[index + 2]!
    result +=
      base64Alphabet[value >> 18]! +
      base64Alphabet[(value >> 12) & 63]! +
      base64Alphabet[(value >> 6) & 63]! +
      base64Alphabet[value & 63]!
  }
  if (index < bytes.length) {
    const second = index + 1 < bytes.length
    const value = (bytes[index]! << 16) | (second ? bytes[index + 1]! << 8 : 0)
    result +=
      base64Alphabet[value >> 18]! +
      base64Alphabet[(value >> 12) & 63]! +
      (second ? base64Alphabet[(value >> 6) & 63]! : '=') +
      '='
  }
  return result
}

/** Counts DSR 5 queries across chunk boundaries. */
function queryCounter() {
  let matched = 0
  return (output: TerminalOutput) => {
    let count = 0
    for (let index = 0; index < output.length; index++) {
      const code = typeof output === 'string' ? output.charCodeAt(index) : output[index]!
      if (code === QUERY[matched]) matched++
      else matched = code === QUERY[0] ? 1 : 0
      if (matched === QUERY.length) {
        count++
        matched = 0
      }
    }
    return count
  }
}

function countReports(data: string) {
  let count = 0
  for (let index = data.indexOf(terminalStatusReport); index !== -1; count++)
    index = data.indexOf(terminalStatusReport, index + terminalStatusReport.length)
  return count
}

export function openTerminalStream(options: TerminalStreamOptions): TerminalStream {
  const requested = options.protocol ?? 'binary-v1'
  const socket = (options.createSocket ?? webSocketTerminalSocket)(
    requested === 'binary-v1' ? binaryStreamUrl(options.url) : options.url,
  )
  const settleMs = options.replaySettleMs ?? 1500
  let protocol: TerminalStreamProtocol | undefined = requested === 'text' ? 'text' : undefined
  let heartbeat: ReturnType<typeof startSocketHeartbeat> | undefined
  let opened = false
  let ended = false
  let sent: TerminalGridSize | undefined
  let queue = Promise.resolve()
  // Output received but not yet accepted by the renderer (bytes for binary v1, UTF-16 units
  // for legacy text). Bounded so a stalled renderer cannot flood the JS/native bridge.
  const pending = { bytes: 0, text: 0 }
  // Replay barrier state: input is dropped until `expected` status reports arrived.
  let suppressing = false
  let replayQueries = 0
  let countQueries = queryCounter()
  let expected: number | undefined
  let reports = 0
  let settle: ReturnType<typeof setTimeout> | undefined
  let legacyReplayed = false
  let ready = false

  const send = (message: string) => {
    if (ended || socket.readyState !== OPEN) return false
    try {
      socket.send(message)
      return true
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)))
      return false
    }
  }
  const detach = () => {
    ended = true
    heartbeat?.stop()
    heartbeat = undefined
    clearTimeout(settle)
    socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null
  }
  const fail = (error: Error) => {
    if (ended) return
    detach()
    try {
      socket.close()
    } catch {
      /* The socket is already unusable; the failure below is what matters. */
    }
    options.onClose(error)
  }
  /** Serializes renderer work; anything queued after the connection ended is skipped. */
  const enqueue = (task: () => Promise<void> | void) => {
    queue = queue
      .then(() => (ended ? undefined : task()))
      .catch((error: unknown) =>
        fail(error instanceof Error ? error : new Error('The terminal could not render output.')),
      )
  }
  const write = (output: TerminalOutput, after?: () => void) => {
    const kind = typeof output === 'string' ? 'text' : 'bytes'
    pending[kind] += output.length
    if (pending[kind] > (kind === 'text' ? legacyPendingLimit : terminalStreamWindow))
      return fail(
        new Error(
          typeof output === 'string'
            ? 'Terminal output is arriving faster than it can be shown.'
            : 'The runtime exceeded the terminal flow-control window.',
        ),
      )
    enqueue(async () => {
      try {
        await options.write(output)
      } finally {
        pending[kind] -= output.length
      }
      if (!ended) after?.()
    })
  }
  const endSuppression = () => {
    suppressing = false
    if (!ready && !ended) {
      ready = true
      options.onReady?.()
    }
    expected = undefined
    clearTimeout(settle)
  }
  const startReplay = () => {
    suppressing = true
    replayQueries = 0
    reports = 0
    expected = undefined
    countQueries = queryCounter()
    clearTimeout(settle)
    write(terminalResetSequence)
  }
  const replayOutput = (output: TerminalOutput) => {
    if (suppressing) replayQueries += countQueries(output)
  }
  const endReplay = () =>
    write(terminalStatusQuery, () => {
      if (!suppressing) return
      expected = replayQueries + 1
      if (reports >= expected) endSuppression()
      else settle = setTimeout(endSuppression, settleMs)
    })
  const sendSize = (size: TerminalGridSize | undefined) => {
    if (!size || (sent && sent.cols === size.cols && sent.rows === size.rows)) return
    if (send(JSON.stringify({ type: 'resize', cols: size.cols, rows: size.rows }))) sent = size
  }
  const receiveText = (text: string) => {
    // Legacy stream: requested, or a runtime that predates binary v1.
    protocol = 'text'
    if (!legacyReplayed) {
      legacyReplayed = true
      startReplay()
      replayOutput(text)
      write(text)
      endReplay()
    } else write(text)
  }
  const receiveBinary = (buffer: ArrayBuffer) => {
    if (protocol === 'text') return heartbeat?.receive(buffer)
    let frame: ReturnType<typeof decodeTerminalStreamFrame>
    try {
      frame = decodeTerminalStreamFrame(new Uint8Array(buffer))
    } catch (error) {
      // Before the first frame this can still be a legacy runtime's raw JSON pong.
      if (protocol === undefined) return heartbeat?.receive(buffer)
      return fail(error instanceof Error ? error : new Error('Invalid terminal stream frame'))
    }
    protocol = 'binary-v1'
    if (frame.type === 'pong') {
      const pong = new TextEncoder().encode(JSON.stringify({ type: 'pong', nonce: frame.nonce }))
      heartbeat?.receive(pong.buffer.slice(pong.byteOffset, pong.byteOffset + pong.byteLength))
    } else if (frame.type === 'replayStart') startReplay()
    else if (frame.type === 'replayEnd') endReplay()
    else if (frame.data.length) {
      // The decoder returns a view into the socket buffer; keep an independent copy.
      const data = frame.data.slice()
      replayOutput(data)
      write(data, () => {
        send(JSON.stringify({ type: 'ack', bytes: data.length }))
      })
    }
  }

  socket.onopen = () => {
    if (ended) return
    opened = true
    options.onOpen()
    sendSize(options.size())
    heartbeat = startSocketHeartbeat(
      (message) => {
        if (!send(message)) throw new Error('Terminal socket is not open')
      },
      () => fail(new Error('Terminal stopped responding.')),
    )
  }
  socket.onmessage = (event) => {
    if (ended) return
    if (typeof event.data === 'string') receiveText(event.data)
    else if (event.data instanceof ArrayBuffer) receiveBinary(event.data)
  }
  socket.onclose = (event) => fail(new Error(event.reason || 'Terminal disconnected.'))
  socket.onerror = () => fail(new Error('Terminal connection failed.'))
  return {
    get open() {
      return opened && !ended && socket.readyState === OPEN
    },
    get protocol() {
      return protocol
    },
    get inputReady() {
      return ready && !suppressing && !ended && socket.readyState === OPEN
    },
    input(data) {
      if (!opened || ended) return
      if (suppressing) {
        reports += countReports(data)
        if (expected !== undefined && reports >= expected) endSuppression()
        return
      }
      if (!ready) return
      for (const frame of terminalInputFrames(data)) if (!send(JSON.stringify(frame))) return
    },
    resize(size) {
      if (opened) sendSize(size)
    },
    close() {
      if (ended) return
      detach()
      try {
        socket.close()
      } catch {
        /* Closing an already failed socket is not an error for the caller. */
      }
    },
  }
}
