declare global {
  interface Window {
    ReactNativeWebView: { postMessage(message: string): void }
    setTerminalFont(family: string, size: number): void
    connectTerminal(url: string, attempt: number): void
    disconnectTerminal(attempt: number | undefined): void
  }
}
import { fontStack, nerdFontFamily, systemMonoFont } from '@dovo/studio-core/fonts'
import { startSocketHeartbeat, terminalInputFrames } from '@dovo/client-runtime'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
const terminal = new Terminal({
  fontSize: 12,
  fontFamily: systemMonoFont,
  theme: { background: '#101113', foreground: '#ededee' },
  scrollback: 2000,
})
const fit = new FitAddon()
terminal.loadAddon(fit)
const root = document.getElementById('terminal')
const controls = document.getElementById('keys')
if (!root || !controls) throw new Error('Terminal document is incomplete')
terminal.open(root)
let socket: WebSocket | undefined
let heartbeat: ReturnType<typeof startSocketHeartbeat> | undefined
const resize = () => {
  fit.fit()
  if (socket?.readyState === WebSocket.OPEN)
    socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }))
}
let fontRevision = 0
window.setTerminalFont = (family, size) => {
  if (
    (family !== '' && family !== nerdFontFamily) ||
    !Number.isInteger(size) ||
    size < 8 ||
    size > 32
  )
    return
  const revision = ++fontRevision
  const stack = fontStack(family, systemMonoFont)
  void Promise.all([
    document.fonts.load(`400 ${size}px ${stack}`),
    document.fonts.load(`700 ${size}px ${stack}`),
  ])
    .then(() => {
      if (revision !== fontRevision) return
      terminal.options.fontFamily = stack
      terminal.options.fontSize = size
      resize()
      terminal.refresh(0, terminal.rows - 1)
    })
    .catch((error: unknown) => {
      if (revision === fontRevision)
        window.ReactNativeWebView.postMessage(
          JSON.stringify({ error: `Could not load terminal font: ${String(error)}` }),
        )
    })
}
new ResizeObserver(resize).observe(document.body)
let ctrl = false
let alt = false
let composing = false
let compositionRevision = 0
let pasting = false
const modifierButtons = new Map<string, HTMLButtonElement>()
const updateModifiers = () => {
  for (const [name, active] of [
    ['Ctrl', ctrl],
    ['Alt', alt],
  ] as const) {
    const button = modifierButtons.get(name)
    if (!button) continue
    button.setAttribute('aria-pressed', String(active))
    button.style.background = active ? '#586bb5' : ''
  }
}
const clearModifiers = () => {
  ctrl = false
  alt = false
  updateModifiers()
}
const sendInput = (data: string, allowModifiers = true) => {
  if (socket?.readyState !== WebSocket.OPEN) return
  if (allowModifiers && (ctrl || alt)) {
    let modified: string | undefined
    const arrow = data.length === 3 && data.startsWith('\x1b[') && 'ABCD'.includes(data.slice(2))
    if (/^[\x20-\x7e]$/.test(data)) {
      if (ctrl) {
        const code = data.toUpperCase().charCodeAt(0)
        if (code >= 64 && code <= 95) modified = String.fromCharCode(code - 64)
        else if (data === ' ') modified = '\0'
        else if (data === '?') modified = '\x7f'
      } else modified = data
    } else if (!ctrl && data === '\t') {
      modified = data
    } else if (arrow) {
      modified = `\x1b[1;${1 + (ctrl ? 4 : 0) + (alt ? 2 : 0)}${data.slice(-1)}`
    }
    if (modified !== undefined) {
      data = alt && !arrow ? `\x1b${modified}` : modified
      clearModifiers()
    }
  }
  for (const frame of terminalInputFrames(data)) socket.send(JSON.stringify(frame))
}
terminal.onData((data) => {
  sendInput(data, !composing && !pasting)
})
terminal.textarea?.addEventListener('compositionstart', () => {
  compositionRevision++
  composing = true
})
terminal.textarea?.addEventListener('compositionend', () => {
  const revision = compositionRevision
  setTimeout(() => {
    if (revision === compositionRevision) composing = false
  }, 0)
})
root.addEventListener(
  'paste',
  () => {
    pasting = true
    queueMicrotask(() => {
      pasting = false
    })
  },
  true,
)
const keys: Array<[string, string | null]> = [
  ['Keyboard', null],
  ['Esc', '\u001b'],
  ['Tab', '\t'],
  ['Ctrl', null],
  ['Alt', null],
  ['Ctrl C', '\u0003'],
  ['↑', '\u001b[A'],
  ['↓', '\u001b[B'],
  ['←', '\u001b[D'],
  ['→', '\u001b[C'],
  ['Dismiss keyboard', null],
]
const buttons = keys.map(([label, data]) => {
  const button = document.createElement('button')
  button.textContent = label
  button.setAttribute('aria-label', label)
  if (label === 'Ctrl' || label === 'Alt') {
    button.setAttribute('aria-pressed', 'false')
    modifierButtons.set(label, button)
  }
  button.disabled = true
  button.addEventListener('mousedown', (event) => event.preventDefault())
  button.addEventListener('click', () => {
    if (label === 'Keyboard') terminal.focus()
    else if (label === 'Dismiss keyboard') terminal.blur()
    else if (socket?.readyState === WebSocket.OPEN) {
      if (label === 'Ctrl') ctrl = !ctrl
      else if (label === 'Alt') alt = !alt
      else if (data !== null) sendInput(data)
      updateModifiers()
    }
  })
  controls.appendChild(button)
  return button
})
terminal.textarea?.setAttribute('aria-label', 'Terminal input')
let currentAttempt: number | undefined
window.disconnectTerminal = (attempt) => {
  if (attempt !== currentAttempt || !socket) return
  heartbeat?.stop()
  heartbeat = undefined
  clearModifiers()
  socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null
  socket.close()
  socket = undefined
  for (const button of buttons) button.disabled = true
}
window.connectTerminal = (url, attempt) => {
  window.disconnectTerminal(currentAttempt)
  currentAttempt = attempt
  socket = new WebSocket(url)
  socket.binaryType = 'arraybuffer'
  const current = socket
  socket.onopen = () => {
    terminal.reset()
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'connected', attempt }))
    for (const button of buttons) button.disabled = false
    resize()
    heartbeat = startSocketHeartbeat(
      (message) => current.send(message),
      () => {
        window.disconnectTerminal(attempt)
        window.ReactNativeWebView.postMessage(
          JSON.stringify({ error: 'Terminal stopped responding.', attempt }),
        )
      },
    )
  }
  socket.onmessage = (event) => {
    if (typeof event.data === 'string') terminal.write(event.data)
    else heartbeat?.receive(event.data)
  }
  socket.onclose = (event) => {
    heartbeat?.stop()
    clearModifiers()
    for (const button of buttons) button.disabled = true
    window.ReactNativeWebView.postMessage(
      JSON.stringify({ error: event.reason || 'Terminal disconnected.', attempt }),
    )
  }
  socket.onerror = () => {
    heartbeat?.stop()
    clearModifiers()
    for (const button of buttons) button.disabled = true
    window.ReactNativeWebView.postMessage(
      JSON.stringify({ error: 'Terminal connection failed.', attempt }),
    )
  }
}

window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready' }))
