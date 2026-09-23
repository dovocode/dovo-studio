declare global {
  interface Window {
    ReactNativeWebView: { postMessage(message: string): void }
    connectTerminal(url: string, attempt: number): void
    disconnectTerminal(attempt: number | undefined): void
  }
}
import { startSocketHeartbeat } from '@dovo/client-runtime'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
const terminal = new Terminal({
  fontSize: 12,
  fontFamily: 'monospace',
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
new ResizeObserver(resize).observe(document.body)
terminal.onData((data) => {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'input', data }))
})
const keys: Array<[string, string | null]> = [
  ['Keyboard', null],
  ['Esc', '\u001b'],
  ['Tab', '\t'],
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
  button.disabled = true
  button.addEventListener('mousedown', (event) => event.preventDefault())
  button.addEventListener('click', () => {
    if (label === 'Keyboard') terminal.focus()
    else if (label === 'Dismiss keyboard') terminal.blur()
    else if (socket?.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify({ type: 'input', data }))
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
    for (const button of buttons) button.disabled = true
    window.ReactNativeWebView.postMessage(
      JSON.stringify({ error: event.reason || 'Terminal disconnected.', attempt }),
    )
  }
  socket.onerror = () => {
    heartbeat?.stop()
    window.ReactNativeWebView.postMessage(
      JSON.stringify({ error: 'Terminal connection failed.', attempt }),
    )
  }
}

window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready' }))
