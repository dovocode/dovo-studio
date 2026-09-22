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
terminal.open(document.getElementById('terminal'))
let socket
const resize = () => {
  fit.fit()
  if (socket?.readyState === WebSocket.OPEN)
    socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }))
}
new ResizeObserver(resize).observe(document.body)
terminal.onData((data) => {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'input', data }))
})
const keys = [
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
  document.getElementById('keys').appendChild(button)
  return button
})
terminal.textarea?.setAttribute('aria-label', 'Terminal input')
window.connectTerminal = (url) => {
  socket?.close()
  socket = new WebSocket(url)
  socket.onopen = () => {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'connected' }))
    for (const button of buttons) button.disabled = false
    resize()
  }
  socket.onmessage = (event) => terminal.write(event.data)
  socket.onclose = (event) => {
    for (const button of buttons) button.disabled = true
    window.ReactNativeWebView.postMessage(
      JSON.stringify({ error: event.reason || 'Terminal disconnected. Reconnect to continue.' }),
    )
  }
  socket.onerror = () =>
    window.ReactNativeWebView.postMessage(JSON.stringify({ error: 'Terminal connection failed' }))
}

window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready' }))
