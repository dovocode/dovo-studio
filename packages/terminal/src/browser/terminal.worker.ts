/// <reference lib="webworker" />
import wasmUrl from './assets/ghostty-vt.wasm?url&inline'
import {
  Ghostty,
  Key,
  KeyAction,
  KeyEncoderOption,
  Mods,
  type GhosttyTerminal,
  type GhosttyCell,
  type KeyEncoder,
} from 'ghostty-web'
import { decodeTerminalStreamFrame } from '@dovo/protocol/terminal-stream'
import { startSocketHeartbeat } from '@dovo/client-runtime/socket-heartbeat'
import { terminalInputFrames } from '@dovo/client-runtime/terminal-input'
import { createTerminalRenderer, RendererInitializationError } from './renderers'
import type {
  TerminalRenderer,
  TerminalRenderOptions,
  TerminalRenderCell,
  TerminalRenderFrame,
  TerminalRendererKind,
} from './render-types'
import type {
  BrowserTerminalOptions,
  TerminalPoint,
  TerminalPortEvent,
  TerminalViewportLine,
  TerminalViewport,
  TerminalWorkerEvent,
  TerminalWorkerRequest,
} from './types'

const post = (event: TerminalWorkerEvent, transfer: Transferable[] = []) =>
  postMessage(event, { transfer })
let ghostty: Ghostty
let terminal: GhosttyTerminal
let keys: KeyEncoder
let renderer: TerminalRenderer | undefined
let canvas: OffscreenCanvas | undefined
let presentation: OffscreenCanvasRenderingContext2D | undefined
let lastFrame: TerminalRenderFrame | undefined
let lastViewport: TerminalViewport | undefined
let offscreenOutput = false
let renderingSuspended = false
let options: BrowserTerminalOptions
let metrics: TerminalRenderOptions
let width = 800,
  height = 300,
  ratio = 1,
  top = 0,
  follow = true,
  visible = true
let renderTimer: ReturnType<typeof setTimeout> | undefined
let selection: { start: TerminalPoint; end: TerminalPoint } | undefined
let selecting = false
let mouseButton = -1
let focused = false
let inputEnabled = true
let pendingInput: { text: string; paste: boolean }[] = []
let pendingInputSize = 0
let announcedOpen = false
let transport: { send(data: string): void; close(): void } | undefined
let connectionId = 0
let open = false
let replaying = false
let heartbeat: ReturnType<typeof startSocketHeartbeat> | undefined
let legacyReplay = false
let savedTop = 0
let savedFollow = true
let recovery: TerminalRendererKind | undefined
const decoder = new TextDecoder()
const loadedFonts = new Set<string>()
const colorCanvas = new OffscreenCanvas(1, 1)
const colorContext = colorCanvas.getContext('2d')
if (!colorContext) throw new Error('Terminal color measurement is unavailable')
// Color strings are shared across the viewport instead of allocated per cell/frame.
// Bound truecolor output as well as the normal 256-color terminal palette.
const colors = new Map<number, string>()
function rgb(r: number, g: number, b: number) {
  const key = (r << 16) | (g << 8) | b
  let value = colors.get(key)
  if (value === undefined) {
    if (colors.size >= 1024) colors.clear()
    value = `rgb(${r},${g},${b})`
    colors.set(key, value)
  }
  return value
}
function colorNumber(color: string) {
  colorContext!.clearRect(0, 0, 1, 1)
  colorContext!.fillStyle = color
  colorContext!.fillRect(0, 0, 1, 1)
  const data = colorContext!.getImageData(0, 0, 1, 1).data
  return (data[0]! << 16) | (data[1]! << 8) | data[2]!
}
const paletteNames = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
] as const
function createEngine() {
  lastFrame = undefined
  lastViewport = undefined
  terminal?.free()
  terminal = ghostty.createTerminal(
    Math.max(2, Math.floor(width / metrics.cellWidth)),
    Math.max(1, Math.floor(height / metrics.cellHeight)),
    {
      // Ghostty measures this limit in bytes, despite the upstream option name.
      scrollbackLimit: options.scrollbackBytes ?? 16 * 1024 * 1024,
      fgColor: colorNumber(options.theme.foreground),
      bgColor: colorNumber(options.theme.background),
      cursorColor: colorNumber(options.theme.cursor),
      palette: paletteNames.map((name) =>
        colorNumber(options.theme[name] ?? options.theme.foreground),
      ),
    },
  )
  applyTheme()
  selection = undefined
  post({ type: 'selection', text: '' })
  top = 0
}
async function configure(value: BrowserTerminalOptions, devicePixelRatio: number) {
  options = value
  ratio = devicePixelRatio
  for (const source of options.fonts ?? []) {
    const key = JSON.stringify(source)
    if (loadedFonts.has(key)) continue
    const font = new FontFace(source.family, `url(${JSON.stringify(source.url)})`, {
      weight: source.weight,
    })
    await font.load()
    self.fonts.add(font)
    loadedFonts.add(key)
  }
  const context = new OffscreenCanvas(1, 1).getContext('2d')
  if (!context) throw new Error('Terminal font measurement is unavailable')
  context.font = `${options.fontSize}px ${options.fontFamily}`
  const measured = context.measureText('M')
  metrics = {
    fontFamily: options.fontFamily,
    fontSize: options.fontSize,
    cellWidth: Math.max(1, measured.width),
    cellHeight: Math.ceil(options.fontSize * 1.3),
    baseline: Math.ceil(options.fontSize),
    devicePixelRatio: ratio,
    background: options.theme.background,
    cursor: options.theme.cursor,
  }
  // Socket output can draw while font loading awaits above. Invalidate when
  // the new metrics are committed, including fonts with identical cell sizes.
  lastFrame = undefined
  lastViewport = undefined
  if (terminal) {
    applyTheme()
    resize()
  }
}
function applyTheme() {
  const color = (value: string) => `#${colorNumber(value).toString(16).padStart(6, '0')}`
  terminal.write(
    `\x1b]10;${color(options.theme.foreground)}\x07\x1b]11;${color(options.theme.background)}\x07\x1b]12;${color(options.theme.cursor)}\x07`,
  )
  for (const [index, name] of paletteNames.entries()) {
    const value = options.theme[name]
    if (value) terminal.write(`\x1b]4;${index};${color(value)}\x07`)
  }
}
function resize() {
  const cols = Math.max(2, Math.min(500, Math.floor(width / metrics.cellWidth)))
  const rows = Math.max(1, Math.min(300, Math.floor(height / metrics.cellHeight)))
  if (terminal.cols !== cols || terminal.rows !== rows) {
    terminal.resize(cols, rows)
    selection = undefined
    post({ type: 'selection', text: '' })
    if (open) send({ type: 'resize', cols, rows })
  }
  const pixelWidth = Math.ceil(width * ratio),
    pixelHeight = Math.ceil(height * ratio)
  if (canvas && (canvas.width !== pixelWidth || canvas.height !== pixelHeight)) {
    renderer?.resize(pixelWidth, pixelHeight)
    lastFrame = undefined
    lastViewport = undefined
  }
  scheduleRender()
}
async function useCanvas(next: OffscreenCanvas, preferred?: TerminalRendererKind) {
  renderer?.dispose()
  lastFrame = undefined
  lastViewport = undefined
  presentation = undefined
  canvas = next
  recovery = undefined
  renderingSuspended = false
  try {
    renderer = await createTerminalRenderer(
      next,
      preferred,
      (error) => {
        if (recovery) return
        const failed =
          error instanceof RendererInitializationError ? error.renderer : renderer?.kind
        recovery = failed === 'webgpu' ? 'webgl2' : 'canvas2d'
        post({ type: 'replaceCanvas', renderer: recovery })
      },
      {
        onSuspend: () => {
          renderingSuspended = true
        },
        onRestore: () => {
          renderingSuspended = false
          lastFrame = undefined
          lastViewport = undefined
          scheduleRender()
        },
        onPermanentLoss: (error) => post({ type: 'error', message: error.message }),
      },
    )
  } catch (error) {
    if (recovery) return
    throw error
  }
  // A failed GPU probe can leave Chromium's transferred-canvas compositor unusable.
  // Present the emergency renderer through a fresh software-backed DOM canvas instead.
  if (renderer.kind === 'canvas2d' && !offscreenOutput && preferred !== 'canvas2d') {
    recovery = 'canvas2d'
    post({ type: 'replaceCanvas', renderer: recovery })
    return
  }
  renderer.resize(Math.ceil(width * ratio), Math.ceil(height * ratio))
  post({ type: 'renderer', renderer: renderer.kind })
  scheduleRender()
}
function scheduleRender() {
  if (!visible || renderTimer || !terminal || !renderer) return
  renderTimer = setTimeout(() => {
    renderTimer = undefined
    draw()
  }, 16)
}
function lineCells(row: number) {
  const history = terminal.getScrollbackLength()
  return row < history ? terminal.getScrollbackLine(row) : terminal.getLine(row - history)
}
function cellText(cell: GhosttyCell, row: number, column: number) {
  if (!cell.width) return ''
  if (cell.grapheme_len) {
    const history = terminal.getScrollbackLength()
    return row < history
      ? terminal.getScrollbackGraphemeString(row, column)
      : terminal.getGraphemeString(row - history, column)
  }
  return cell.codepoint ? String.fromCodePoint(cell.codepoint) : ' '
}
function wrapped(row: number) {
  const local = row - terminal.getScrollbackLength()
  // The bundled ABI extends negative row indexes to history (-1 = oldest).
  const next = row + 1
  const history = terminal.getScrollbackLength()
  return next < history
    ? terminal.isRowWrapped(-next - 1)
    : local + 1 < terminal.rows && terminal.isRowWrapped(local + 1)
}
function orderedSelection() {
  if (!selection) return undefined
  const { start, end } = selection
  return start.y < end.y || (start.y === end.y && start.x <= end.x)
    ? { start, end }
    : { start: end, end: start }
}
function draw() {
  if (!renderer || recovery || renderingSuspended || !visible) return
  try {
    terminal.update()
    const history = terminal.isAlternateScreen() ? 0 : terminal.getScrollbackLength()
    top = follow ? history : Math.min(top, history)
    const viewport = terminal.getViewport()
    const defaultColors = terminal.getColors()
    const defaultFg = rgb(
      defaultColors.foreground.r,
      defaultColors.foreground.g,
      defaultColors.foreground.b,
    )
    const defaultBg = rgb(
      defaultColors.background.r,
      defaultColors.background.g,
      defaultColors.background.b,
    )
    const cells: TerminalRenderCell[][] = []
    const lines: TerminalViewportLine[] = []
    const range = orderedSelection()
    for (let y = 0; y < terminal.rows; y++) {
      const absolute = top + y
      const historyLine = absolute < history ? terminal.getScrollbackLine(absolute) : undefined
      const offset = (absolute - history) * terminal.cols
      const previous = lastFrame?.cells[y]
      let row = previous?.length === terminal.cols ? previous : undefined
      for (let x = 0; x < terminal.cols; x++) {
        const cell = absolute < history ? historyLine?.[x] : viewport[offset + x]
        const chars = cell ? cellText(cell, absolute, x) : ' '
        const span = cell?.width ?? 1
        const flags = (cell?.flags ?? 0) & ~16
        let foreground = cell ? rgb(cell.fg_r, cell.fg_g, cell.fg_b) : defaultFg,
          background = cell ? rgb(cell.bg_r, cell.bg_g, cell.bg_b) : defaultBg
        if (foreground === defaultFg) foreground = options.theme.foreground
        if (background === defaultBg) background = options.theme.background
        if (cell && cell.flags & 16) [foreground, background] = [background, foreground]
        if (
          range &&
          absolute >= range.start.y &&
          absolute <= range.end.y &&
          (absolute !== range.start.y || x >= range.start.x) &&
          (absolute !== range.end.y || x < range.end.x)
        ) {
          background = options.theme.selectionBackground
          foreground = options.theme.selectionForeground ?? options.theme.foreground
        }
        const old = previous?.[x]
        if (
          old?.text !== chars ||
          old.width !== span ||
          old.flags !== flags ||
          old.foreground !== foreground ||
          old.background !== background
        ) {
          // Keep immutable rows/cells when unchanged; renderers can cheaply reuse them.
          if (!row) row = []
          else if (row === previous) row = [...row]
          row[x] = { text: chars, width: span, foreground, background, flags }
        }
      }
      cells.push(row ?? [])
      const oldLine = lastViewport?.lines[y]
      const isWrapped = wrapped(absolute)
      if (row === previous && oldLine?.wrapped === isWrapped) lines.push(oldLine)
      else {
        let text = ''
        const widths: number[] = []
        for (const cell of row ?? []) {
          text += cell.text
          for (let index = 0; index < cell.text.length; index++) widths.push(index ? 0 : cell.width)
        }
        lines.push({ text, widths, wrapped: isWrapped })
      }
    }
    const current = terminal.getCursor()
    const cursor = {
      x: current.x,
      y: history + current.y - top,
      visible: focused && current.visible && follow,
      style: current.style,
    }
    const frame: TerminalRenderFrame = { cols: terminal.cols, rows: terminal.rows, cells, cursor }
    const cursorChanged =
      !lastFrame ||
      cursor.x !== lastFrame.cursor.x ||
      cursor.y !== lastFrame.cursor.y ||
      cursor.visible !== lastFrame.cursor.visible ||
      cursor.style !== lastFrame.cursor.style
    const paint = !lastFrame || cursorChanged || cells.some((row, y) => row !== lastFrame?.cells[y])
    if (paint) renderer.render(frame, metrics)
    terminal.markClean()
    const nextViewport: TerminalViewport = {
      cols: terminal.cols,
      rows: terminal.rows,
      top,
      history,
      lines,
      metrics: { cellWidth: metrics.cellWidth, cellHeight: metrics.cellHeight },
      cursor,
      mouseTracking: terminal.hasMouseTracking(),
    }
    if (
      !lastViewport ||
      paint ||
      cursorChanged ||
      top !== lastViewport.top ||
      history !== lastViewport.history ||
      nextViewport.mouseTracking !== lastViewport.mouseTracking ||
      lines.some((line, y) => line !== lastViewport?.lines[y])
    ) {
      post({ type: 'viewport', viewport: nextViewport })
    }
    lastFrame = frame
    lastViewport = nextViewport
    if (paint && offscreenOutput && canvas) {
      // transferToImageBitmap clears its source. Copy into a presentation surface
      // so incremental renderers retain their pixels between software frames.
      if (!presentation) {
        const output = new OffscreenCanvas(canvas.width, canvas.height)
        presentation =
          output.getContext('2d', { alpha: false, willReadFrequently: true }) ?? undefined
        if (!presentation) throw new Error('Terminal software presentation is unavailable')
      }
      if (presentation.canvas.width !== canvas.width) presentation.canvas.width = canvas.width
      if (presentation.canvas.height !== canvas.height) presentation.canvas.height = canvas.height
      presentation.drawImage(canvas, 0, 0)
      const bitmap = presentation.canvas.transferToImageBitmap()
      post({ type: 'bitmap', bitmap }, [bitmap])
    }
  } catch (cause) {
    if (renderer.kind !== 'canvas2d') {
      recovery = renderer.kind === 'webgpu' ? 'webgl2' : 'canvas2d'
      post({ type: 'replaceCanvas', renderer: recovery })
    } else post({ type: 'error', message: cause instanceof Error ? cause.message : String(cause) })
  }
}
function updateSelection() {
  const range = orderedSelection()
  if (!range) {
    post({ type: 'selection', text: '' })
    scheduleRender()
    return
  }
  let text = ''
  for (let row = range.start.y; row <= range.end.y; row++) {
    const cells = lineCells(row)
    let line = ''
    for (
      let x = row === range.start.y ? range.start.x : 0;
      x < (row === range.end.y ? range.end.x : terminal.cols);
      x++
    ) {
      const cell = cells?.[x]
      if (cell) line += cellText(cell, row, x)
    }
    text +=
      wrapped(row) || (row === range.end.y && range.end.x < terminal.cols) ? line : line.trimEnd()
    if (row !== range.end.y && !wrapped(row)) text += '\n'
    if (text.length > 2 * 1024 * 1024) {
      post({ type: 'error', message: 'Select less terminal text (maximum 2 MiB).' })
      return
    }
  }
  post({ type: 'selection', text })
  scheduleRender()
}
function send(value: unknown) {
  if (open) transport?.send(JSON.stringify(value))
}
function respond(text: string) {
  if (!open || replaying) return
  for (const frame of terminalInputFrames(text)) send(frame)
}
function userReport(text: string) {
  if (inputEnabled) respond(text)
}
function input(text: string, paste = false) {
  if (!open || !inputEnabled) return
  if (replaying) {
    if (pendingInputSize + text.length > 65536) {
      post({
        type: 'error',
        message: 'Terminal is replaying history. Wait before pasting more text.',
      })
      return
    }
    pendingInput.push({ text, paste })
    pendingInputSize += text.length
    return
  }
  if (paste) text = text.replace(/\r?\n/g, '\r')
  if (paste && terminal.hasBracketedPaste()) text = `\x1b[200~${text}\x1b[201~`
  for (const frame of terminalInputFrames(text)) send(frame)
  follow = true
  selection = undefined
  updateSelection()
}
function finishReplay() {
  replaying = false
  if (!announcedOpen) {
    announcedOpen = true
    post({ type: 'connection', id: connectionId, state: 'open' })
  }
  const pending = pendingInput
  pendingInput = []
  pendingInputSize = 0
  for (const value of pending) input(value.text, value.paste)
}
function disconnect() {
  heartbeat?.stop()
  heartbeat = undefined
  open = false
  pendingInput = []
  pendingInputSize = 0
  transport?.close()
  transport = undefined
}
function receive(data: ArrayBuffer | string, id: number) {
  if (id !== connectionId) return
  try {
    if (typeof data === 'string') {
      // Older runtimes still work; their first text frame is the retained replay.
      if (legacyReplay) {
        createEngine()
        replaying = true
      }
      terminal.write(data)
      while (terminal.hasResponse()) {
        const response = terminal.readResponse()
        if (response) respond(response)
      }
      legacyReplay = false
      finishReplay()
    } else {
      if (new Uint8Array(data)[0] === 123) {
        heartbeat?.receive(data)
        return
      }
      const frame = decodeTerminalStreamFrame(new Uint8Array(data))
      if (frame.type === 'replayStart') {
        savedTop = top
        savedFollow = follow
        createEngine()
        replaying = true
      } else if (frame.type === 'replayEnd') {
        follow = savedFollow
        top = savedTop
        finishReplay()
      } else if (frame.type === 'pong')
        heartbeat?.receive(
          new TextEncoder().encode(JSON.stringify({ type: 'pong', nonce: frame.nonce })).buffer,
        )
      else {
        terminal.write(frame.data)
        while (terminal.hasResponse()) {
          const response = terminal.readResponse()
          if (response) respond(response)
        }
        send({ type: 'ack', bytes: frame.data.byteLength })
      }
    }
    scheduleRender()
  } catch (cause) {
    post({ type: 'error', message: cause instanceof Error ? cause.message : String(cause) })
    disconnect()
    post({ type: 'connection', id, state: 'error', message: 'Invalid terminal output.' })
  }
}
function connect(id: number, url: string, port?: MessagePort) {
  disconnect()
  connectionId = id
  legacyReplay = true
  replaying = true
  announcedOpen = false
  const opened = () => {
    if (id !== connectionId) return
    open = true
    send({ type: 'resize', cols: terminal.cols, rows: terminal.rows })
    heartbeat = startSocketHeartbeat(
      (message) => transport?.send(message),
      () => {
        disconnect()
        post({ type: 'connection', id, state: 'error', message: 'Terminal stopped responding.' })
      },
    )
  }
  const closed = (message: string) => {
    if (id !== connectionId) return
    disconnect()
    post({ type: 'connection', id, state: 'close', message })
  }
  if (port) {
    transport = {
      send: (message) => port.postMessage(message),
      close: () => {
        port.postMessage({ type: 'close' })
        port.close()
      },
    }
    port.onmessage = (event: MessageEvent<TerminalPortEvent>) => {
      if (event.data.type === 'open') opened()
      else if (event.data.type === 'data') receive(event.data.data, id)
      else closed(event.data.message)
    }
    port.start()
  } else {
    const socket = new WebSocket(url)
    socket.binaryType = 'arraybuffer'
    transport = {
      send: (message) => socket.send(message),
      close: () => {
        socket.onopen = socket.onclose = socket.onerror = socket.onmessage = null
        socket.close()
      },
    }
    socket.onopen = opened
    socket.onmessage = (event: MessageEvent<ArrayBuffer | string>) => receive(event.data, id)
    socket.onclose = (event) => closed(event.reason || 'Terminal disconnected.')
    socket.onerror = () => closed('Terminal connection failed.')
  }
}
const keyMap: Record<string, Key> = {
  Enter: Key.ENTER,
  Backspace: Key.BACKSPACE,
  Tab: Key.TAB,
  Escape: Key.ESCAPE,
  ArrowUp: Key.UP,
  ArrowDown: Key.DOWN,
  ArrowLeft: Key.LEFT,
  ArrowRight: Key.RIGHT,
  Home: Key.HOME,
  End: Key.END,
  PageUp: Key.PAGE_UP,
  PageDown: Key.PAGE_DOWN,
  Insert: Key.INSERT,
  Delete: Key.DELETE,
  Space: Key.SPACE,
  Minus: Key.MINUS,
  Equal: Key.EQUAL,
  BracketLeft: Key.BRACKET_LEFT,
  BracketRight: Key.BRACKET_RIGHT,
  Backslash: Key.BACKSLASH,
  Semicolon: Key.SEMICOLON,
  Quote: Key.QUOTE,
  Comma: Key.COMMA,
  Period: Key.PERIOD,
  Slash: Key.SLASH,
  Backquote: Key.GRAVE,
}
for (let index = 0; index < 26; index++)
  keyMap[`Key${String.fromCharCode(65 + index)}`] = Key.A + index
for (let index = 0; index < 10; index++)
  keyMap[`Digit${index}`] = index === 0 ? Key.ZERO : Key.ONE + index - 1
for (let index = 1; index <= 12; index++) keyMap[`F${index}`] = Key.F1 + index - 1
function pointer(message: Extract<TerminalWorkerRequest, { type: 'pointer' }>) {
  const point = {
    x: Math.min(terminal.cols, Math.max(0, message.point.x)),
    y: top + Math.min(terminal.rows - 1, Math.max(0, message.point.y)),
  }
  if (terminal.hasMouseTracking() && !message.shift) {
    if (message.phase === 'move' && !terminal.getMode(1002) && !terminal.getMode(1003)) return
    if (message.phase === 'down') mouseButton = message.button
    if (message.phase === 'move' && mouseButton < 0 && !terminal.getMode(1003)) return
    const button = mouseButton < 0 ? 3 : mouseButton
    const sgr = terminal.getMode(1006)
    const code =
      (!sgr && message.phase === 'up' ? 3 : button) +
      (message.phase === 'move' ? 32 : 0) +
      (message.shift ? 4 : 0) +
      (message.alt ? 8 : 0) +
      (message.ctrl ? 16 : 0)
    if (message.phase === 'up') mouseButton = -1
    const x = point.x + 1,
      y = point.y - top + 1
    userReport(
      sgr
        ? `\x1b[<${code};${x};${y}${message.phase === 'up' ? 'm' : 'M'}`
        : `\x1b[M${String.fromCharCode(32 + code, Math.min(255, 32 + x), Math.min(255, 32 + y))}`,
    )
    return
  }
  if (message.phase === 'down') {
    selecting = true
    selection = { start: point, end: point }
  } else if (selecting && selection) {
    selection.end = point
    if (message.phase === 'up') selecting = false
  }
  updateSelection()
}
async function handle(message: TerminalWorkerRequest) {
  switch (message.type) {
    case 'init':
      await configure(message.options, message.devicePixelRatio)
      ghostty = await Ghostty.load(wasmUrl)
      keys = ghostty.createKeyEncoder()
      createEngine()
      offscreenOutput = !message.canvas
      await useCanvas(
        message.canvas ?? new OffscreenCanvas(width, height),
        message.options.renderer,
      )
      post({ type: 'ready' })
      break
    case 'canvas':
      offscreenOutput = !message.canvas
      await useCanvas(message.canvas ?? new OffscreenCanvas(width, height), message.renderer)
      break
    case 'configure':
      await configure(message.options, message.devicePixelRatio)
      break
    case 'resize':
      width = message.width
      height = message.height
      resize()
      break
    case 'inputEnabled':
      inputEnabled = message.enabled
      if (!inputEnabled) {
        pendingInput = []
        pendingInputSize = 0
      }
      break
    case 'visible':
      visible = message.visible
      if (visible) scheduleRender()
      break
    case 'connect':
      connect(message.id, message.url, message.port)
      break
    case 'disconnect':
      if (message.id === connectionId) disconnect()
      break
    case 'input':
      input(message.text, message.paste)
      break
    case 'key': {
      if (message.meta) return
      const key = keyMap[message.code] ?? Key.UNIDENTIFIED
      keys.setOption(KeyEncoderOption.CURSOR_KEY_APPLICATION, terminal.getMode(1))
      keys.setOption(KeyEncoderOption.KEYPAD_KEY_APPLICATION, terminal.getMode(66))
      keys.setOption(KeyEncoderOption.ALT_ESC_PREFIX, true)
      const mods =
        (message.ctrl ? Mods.CTRL : 0) |
        (message.alt ? Mods.ALT : 0) |
        (message.shift ? Mods.SHIFT : 0)
      const encoded = keys.encode({
        action: message.repeat ? KeyAction.REPEAT : KeyAction.PRESS,
        key,
        mods,
        utf8: message.key.length === 1 ? message.key : undefined,
      })
      if (encoded.length) input(decoder.decode(encoded))
      break
    }
    case 'focus':
      focused = message.focused
      if (terminal.hasFocusEvents()) respond(focused ? '\x1b[I' : '\x1b[O')
      scheduleRender()
      break
    case 'pointer':
      pointer(message)
      break
    case 'selectWord': {
      const y = top + Math.max(0, Math.min(terminal.rows - 1, message.point.y)),
        cells = lineCells(y)
      let start = Math.max(0, Math.min(terminal.cols - 1, message.point.x)),
        end = start + 1
      const space = (x: number) => {
        const cell = cells?.[x]
        return !cell || /\s/u.test(cellText(cell, y, x))
      }
      if (!space(start)) {
        while (start > 0 && !space(start - 1)) start--
        while (end < terminal.cols && !space(end)) end++
      }
      selection = { start: { x: start, y }, end: { x: end, y } }
      selecting = false
      updateSelection()
      break
    }
    case 'scroll':
      if (terminal.hasMouseTracking() && !message.shift && message.point) {
        const code = (message.lines > 0 ? 65 : 64) + (message.alt ? 8 : 0) + (message.ctrl ? 16 : 0)
        const x = Math.max(1, Math.min(terminal.cols, message.point.x + 1)),
          y = Math.max(1, Math.min(terminal.rows, message.point.y + 1))
        for (let i = 0; i < Math.min(20, Math.abs(message.lines)); i++)
          userReport(
            terminal.getMode(1006)
              ? `\x1b[<${code};${x};${y}M`
              : `\x1b[M${String.fromCharCode(32 + code, Math.min(255, 32 + x), Math.min(255, 32 + y))}`,
          )
      } else if (terminal.isAlternateScreen()) {
        const value = message.lines > 0 ? '\x1b[B' : '\x1b[A'
        for (let i = 0; i < Math.min(20, Math.abs(message.lines)); i++) input(value)
      } else {
        top =
          message.lines === Infinity
            ? terminal.getScrollbackLength()
            : Math.max(0, Math.min(terminal.getScrollbackLength(), top + message.lines))
        follow = top === terminal.getScrollbackLength()
        scheduleRender()
      }
      break
    case 'selectAll':
      selection = {
        start: { x: 0, y: 0 },
        end: { x: terminal.cols, y: terminal.getScrollbackLength() + terminal.rows - 1 },
      }
      updateSelection()
      break
    case 'clearSelection':
      selection = undefined
      updateSelection()
      break
    case 'readSelection':
      updateSelection()
      break
    case 'dispose':
      disconnect()
      clearTimeout(renderTimer)
      renderer?.dispose()
      keys?.dispose()
      terminal?.free()
      close()
      break
  }
}
let work = Promise.resolve()
self.onmessage = (event: MessageEvent<TerminalWorkerRequest>) => {
  work = work
    .then(() => handle(event.data))
    .catch((cause) =>
      post({ type: 'error', message: cause instanceof Error ? cause.message : String(cause) }),
    )
}
