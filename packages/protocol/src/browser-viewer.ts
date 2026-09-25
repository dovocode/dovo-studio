import { decode } from './schema.js'
// Browser-only entry point, bundled into a self-contained canvas viewer by build-browser-viewer.mjs.
import { remoteBrowserMessageSchema, type RemoteBrowserInput } from './remote-browser'
import { decodeBrowserFrame } from './browser-frames'
import { previewPresets } from './previews'

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage: (message: string) => void }
  }
}
function element<T extends HTMLElement>(id: string, constructor: { new (): T }) {
  const found = document.getElementById(id)
  if (!(found instanceof constructor)) throw new Error(`Missing browser control: ${id}`)
  return found
}
const canvas = element('page', HTMLCanvasElement)
const context = canvas.getContext('2d', { alpha: false, desynchronized: true })
if (!context) throw new Error('Canvas rendering is unavailable')
const drawing = context
const viewport = element('viewport', HTMLDivElement)
const address = element('address', HTMLInputElement)
const status = element('status', HTMLDivElement)
const empty = element('empty', HTMLDivElement)
const back = element('back', HTMLButtonElement)
const forward = element('forward', HTMLButtonElement)
const reload = element('reload', HTMLButtonElement)
const keyboard = element('keyboard', HTMLButtonElement)
const editor = element('editor', HTMLTextAreaElement)
const preset = element('preset', HTMLSelectElement)
const rotate = element('rotate', HTMLButtonElement)
const reconnect = element('reconnect', HTMLButtonElement)
const dialog = element('dialog', HTMLDialogElement)
const dialogText = element('dialogText', HTMLParagraphElement)
const dialogValue = element('dialogValue', HTMLInputElement)
const cancelDialog = element('cancelDialog', HTMLButtonElement)
let socket: WebSocket | undefined
let width = 1280,
  height = 800,
  landscape = false
let simulator = false
let nativeTouch = false
let activePointer: number | undefined
let pointerPosition: { clientX: number; clientY: number } | undefined
let requestedSize = ''
let fitTimer: ReturnType<typeof setTimeout> | undefined
let currentUrl = '',
  online = false
let addressEdited = false
address.oninput = () => {
  addressEdited = true
}
let intentionallyClosed = false
// Wi-Fi/VPN drops recover on their own; the user only acts after retries run out.
let retryTimer: ReturnType<typeof setTimeout> | undefined
let retryAttempt = 0
const maxRetries = 6
function cancelReconnect() {
  clearTimeout(retryTimer)
  retryTimer = undefined
}
function scheduleReconnect() {
  if (intentionallyClosed || retryTimer || retryAttempt >= maxRetries) return false
  const delay = Math.min(1000 * 2 ** retryAttempt, 15000)
  retryAttempt++
  notice(simulator ? 'Device connection lost. Reconnecting…' : 'Connection lost. Reconnecting…')
  retryTimer = setTimeout(() => {
    retryTimer = undefined
    bridge('reconnect')
  }, delay)
  return true
}
let keyboardOpen = false,
  composing = false
const sentinel = '\u200b'
const bridge = (type: 'ready' | 'reconnect' | 'close') => {
  const message = { channel: 'dovo-browser', type }
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(message))
  else window.parent.postMessage(message, '*')
}
function send(message: RemoteBrowserInput) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
}
function notice(message: string, error = false) {
  status.textContent = message
  status.setAttribute('role', error ? 'alert' : 'status')
  status.classList.toggle('error', error)
  status.hidden = !message
}
function enabled(value: boolean) {
  online = value
  element('home', HTMLButtonElement).disabled = !value
  element('deviceButton', HTMLSelectElement).disabled = !value
  reload.disabled = !value
  keyboard.disabled = !value
  preset.disabled = !value
  rotate.disabled = !value || preset.value === 'fill'
  element('go', HTMLButtonElement).disabled = !value
  element('close', HTMLButtonElement).disabled = !value
  reconnect.hidden = value
  if (!value) {
    activePointer = undefined
    pointerPosition = undefined
    touch = undefined
    cancelAnimationFrame(moveFrame)
    moveFrame = 0
    move = undefined
    back.disabled = forward.disabled = true
    setKeyboard(false)
  }
}
function fit() {
  if (!online || simulator) return
  const chosen = previewPresets.find((item) => item.id === preset.value) ?? previewPresets[0]
  const w = chosen.width ? (landscape ? chosen.height : chosen.width) : viewport.clientWidth
  const h = chosen.height ? (landscape ? chosen.width : chosen.height) : viewport.clientHeight
  const size = `${w}:${h}`
  rotate.disabled = !online || preset.value === 'fill'
  if (size === requestedSize) return
  requestedSize = size
  send({
    type: 'resize',
    width: Math.round(Math.min(1920, Math.max(240, w))),
    height: Math.round(Math.min(1920, Math.max(240, h))),
  })
  rotate.disabled = !online || preset.value === 'fill'
}
new ResizeObserver(() => {
  clearTimeout(fitTimer)
  fitTimer = setTimeout(fit, 150)
}).observe(viewport)
preset.addEventListener('change', fit)
rotate.onclick = () => {
  landscape = !landscape
  fit()
}
function layoutCanvas() {
  const scale = Math.min(viewport.clientWidth / width, viewport.clientHeight / height)
  canvas.style.width = `${Math.floor(width * scale)}px`
  canvas.style.height = `${Math.floor(height * scale)}px`
}
new ResizeObserver(layoutCanvas).observe(viewport)
function configure(device: unknown) {
  simulator = !!device && typeof device === 'object' && 'platform' in device
  document.body.classList.toggle('device', simulator)
  element('navigation', HTMLFormElement).hidden = simulator
  for (const id of ['forward', 'reload', 'preset', 'rotate'])
    element(id, HTMLElement).hidden = simulator
  element('home', HTMLButtonElement).hidden = !simulator
  element('deviceButton', HTMLSelectElement).hidden = !(
    device &&
    typeof device === 'object' &&
    'kind' in device &&
    device.kind === 'physical'
  )
  back.hidden =
    simulator &&
    !!device &&
    typeof device === 'object' &&
    'platform' in device &&
    device.platform === 'ios'
  canvas.setAttribute(
    'aria-label',
    simulator
      ? 'Live device screen. Tap and drag to interact.'
      : 'Remote browser page. Tap to interact, swipe to scroll. Use Keyboard to type.',
  )

  element('close', HTMLButtonElement).setAttribute(
    'aria-label',
    simulator ? 'Close device preview' : 'Close browser session',
  )
  empty.textContent = simulator
    ? 'Connecting to device…'
    : 'Enter the address of a website or a development server on this computer.'
  if (simulator) notice('Connecting to device…')
}
async function decodeImage(blob: Blob) {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob)
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    }
  }
  const url = URL.createObjectURL(blob)
  const image = new Image()
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Invalid browser image'))
      image.src = url
    })
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    }
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
}
function connect(url: string) {
  const target = new URL(url)
  if (!['ws:', 'wss:'].includes(target.protocol)) throw new Error('Invalid browser connection')
  intentionallyClosed = false
  nativeTouch = false
  requestedSize = ''
  target.searchParams.set('frames', 'binary-v1')
  const previous = socket
  socket = undefined
  previous?.close()
  const next = new WebSocket(target.href)
  next.binaryType = 'arraybuffer'
  socket = next
  enabled(false)
  notice(simulator ? 'Connecting to device…' : 'Connecting to host browser…')
  next.onopen = () => {
    if (socket !== next) return
    retryAttempt = 0
    cancelReconnect()
    enabled(true)
    notice('')
    fit()
  }
  next.onclose = (event) => {
    if (socket !== next) return
    enabled(false)
    // 1000: the host ended the session. 1008: invalid ticket or revoked device.
    if (event.code !== 1000 && event.code !== 1008 && scheduleReconnect()) return
    notice(
      simulator
        ? 'Device disconnected. Reconnect to continue.'
        : 'Browser disconnected. Reconnect to continue.',
      true,
    )
  }
  next.onerror = () => {
    if (socket === next && !retryTimer)
      notice('Cannot reach the host browser. Check your connection and reconnect.', true)
  }
  type Frame = { width: number; height: number; blob: Blob; sequence?: number }
  let pendingFrame: Frame | undefined
  let rendering = false
  const acknowledge = (frame: Frame) => {
    if (frame.sequence && next.readyState === WebSocket.OPEN)
      next.send(JSON.stringify({ type: 'frameAck', sequence: frame.sequence }))
  }
  const render = async (frame: Frame) => {
    if (pendingFrame) acknowledge(pendingFrame)
    pendingFrame = frame
    if (rendering) return
    rendering = true
    try {
      while (pendingFrame && socket === next) {
        const current = pendingFrame
        pendingFrame = undefined
        try {
          const image = await decodeImage(current.blob)
          try {
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
            if (socket !== next || next.readyState !== WebSocket.OPEN) continue
            const resized = width !== current.width || height !== current.height
            width = current.width
            height = current.height
            // Resizing clears the backing store and resets the graphics context.
            // Keep it allocated for consecutive frames at the same resolution.
            if (canvas.width !== image.width) canvas.width = image.width
            if (canvas.height !== image.height) canvas.height = image.height
            canvas.dataset.viewportWidth = String(width)
            canvas.dataset.viewportHeight = String(height)
            drawing.drawImage(image.source, 0, 0)
            if (resized || canvas.hidden) layoutCanvas()
            canvas.hidden = !currentUrl || currentUrl === 'about:blank'
          } finally {
            image.close()
          }
        } finally {
          acknowledge(current)
        }
      }
    } catch {
      notice('Could not render the browser frame. Reconnect to try again.', true)
      next.close()
    } finally {
      rendering = false
    }
  }
  next.onmessage = (event) => {
    if (socket !== next) return
    try {
      if (event.data instanceof ArrayBuffer) {
        const frame = decodeBrowserFrame(event.data)
        void render({ ...frame, blob: new Blob([frame.data], { type: 'image/jpeg' }) })
        return
      }
      const message = decode(remoteBrowserMessageSchema, JSON.parse(String(event.data)))
      if (message.type === 'frame') {
        // Backward compatibility with a host that has not been updated yet.
        const bytes = Uint8Array.from(atob(message.data), (value) => value.charCodeAt(0))
        void render({ ...message, blob: new Blob([bytes], { type: 'image/jpeg' }) })
      } else if (message.type === 'state') {
        nativeTouch = message.touch === true
        currentUrl = message.url
        if (!addressEdited && document.activeElement !== address)
          address.value = currentUrl === 'about:blank' ? '' : currentUrl
        back.disabled = !message.back
        forward.disabled = !message.forward
        empty.hidden = currentUrl !== 'about:blank'
        if (!empty.hidden) canvas.hidden = true
        keyboard.title = message.editable ? 'Type into focused field' : 'Keyboard'
        document.title = message.title || 'Host browser'
      } else if (message.type === 'error' || message.type === 'closed') {
        if (message.type === 'closed') enabled(false)
        notice(message.message, true)
      } else if (message.type === 'dialog') {
        dialogText.textContent = message.message
        dialogValue.value = message.defaultValue
        dialogValue.hidden = message.kind !== 'prompt'
        cancelDialog.hidden = message.kind === 'alert'
        if (!dialog.open) dialog.showModal()
      }
    } catch {
      notice('The host sent an invalid browser response.', true)
    }
  }
}
window.addEventListener('message', (event) => {
  // Only the containing Dovo view can supply a one-use socket URL. Pages being
  // previewed are pixels, never executable content inside this document.
  if (!window.ReactNativeWebView && event.source !== window.parent) return
  const message: unknown = event.data
  if (
    !message ||
    typeof message !== 'object' ||
    !('channel' in message) ||
    message.channel !== 'dovo-browser'
  )
    return
  if ('type' in message && message.type === 'presentation') {
    document.body.classList.toggle('expanded', 'expanded' in message && message.expanded === true)
    return
  }
  if ('type' in message && message.type === 'configure') {
    configure('device' in message ? message.device : undefined)
    return
  }
  if (
    'type' in message &&
    message.type === 'connect' &&
    'url' in message &&
    typeof message.url === 'string'
  ) {
    try {
      configure('device' in message ? message.device : undefined)
      connect(message.url)
    } catch {
      notice('Invalid host browser connection.', true)
    }
  } else if (
    'type' in message &&
    message.type === 'error' &&
    'message' in message &&
    typeof message.message === 'string'
  ) {
    enabled(false)
    // A failed ticket request during automatic recovery is retried with backoff.
    if (!retryAttempt || !scheduleReconnect()) notice(message.message, true)
  }
})
reconnect.onclick = () => {
  retryAttempt = 0
  cancelReconnect()
  notice(simulator ? 'Connecting to device…' : 'Connecting to host browser…')
  bridge('reconnect')
}
element('close', HTMLButtonElement).onclick = () => {
  intentionallyClosed = true
  cancelReconnect()
  bridge('close')
}
element('navigation', HTMLFormElement).onsubmit = (event) => {
  event.preventDefault()
  if (!online || !address.value.trim()) return
  notice('')
  send({ type: 'navigate', url: address.value })
  addressEdited = false
  address.blur()
}
element('deviceButton', HTMLSelectElement).onchange = (event) => {
  const select = event.currentTarget
  if (!(select instanceof HTMLSelectElement) || !select.value) return
  send({ type: 'key', key: select.value })
  select.value = ''
}
element('home', HTMLButtonElement).onclick = () => send({ type: 'key', key: 'Home' })
back.onclick = () => {
  notice('')
  send({ type: 'back' })
}
forward.onclick = () => {
  notice('')
  send({ type: 'forward' })
}
reload.onclick = () => {
  notice('')
  send({ type: 'reload' })
}
dialog.addEventListener('close', () =>
  send({
    type: 'dialog',
    accept: dialog.returnValue === 'accept',
    text: dialogValue.hidden ? undefined : dialogValue.value,
  }),
)

function position(event: { clientX: number; clientY: number }) {
  const rect = canvas.getBoundingClientRect()
  return {
    x: Math.min(width - 1, Math.max(0, ((event.clientX - rect.left) * width) / rect.width)),
    y: Math.min(height - 1, Math.max(0, ((event.clientY - rect.top) * height) / rect.height)),
  }
}
const button = (event: PointerEvent) =>
  event.button === 2
    ? ('right' as const)
    : event.button === 1
      ? ('middle' as const)
      : ('left' as const)
let touch: { id: number; x: number; y: number; moved: boolean } | undefined
let move: RemoteBrowserInput | undefined
let moveFrame = 0
function flushMovement() {
  cancelAnimationFrame(moveFrame)
  moveFrame = 0
  if (move) send(move)
  move = undefined
}
function coalesce(message: RemoteBrowserInput) {
  if (message.type === 'scroll' && move?.type === 'scroll') {
    message = {
      ...message,
      deltaX: Math.max(-4000, Math.min(4000, message.deltaX + move.deltaX)),
      deltaY: Math.max(-4000, Math.min(4000, message.deltaY + move.deltaY)),
    }
  }
  move = message
  if (!moveFrame)
    moveFrame = requestAnimationFrame(() => {
      moveFrame = 0
      if (move) send(move)
      move = undefined
    })
}
canvas.onpointerdown = (event) => {
  if (!online || activePointer !== undefined) return
  activePointer = event.pointerId
  pointerPosition = { clientX: event.clientX, clientY: event.clientY }
  flushMovement()
  canvas.setPointerCapture(event.pointerId)
  canvas.focus({ preventScroll: true })
  if (event.pointerType === 'touch' && !simulator && !nativeTouch)
    touch = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
  else
    send({
      type: 'pointer',
      phase: 'down',
      button: button(event),
      pointerType: event.pointerType === 'touch' ? 'touch' : 'mouse',
      ...position(event),
    })
}
function movePointer(event: PointerEvent) {
  if (!online || (activePointer !== undefined && activePointer !== event.pointerId)) return
  if ((simulator || event.pointerType === 'touch') && activePointer === undefined) return
  pointerPosition = { clientX: event.clientX, clientY: event.clientY }
  if (
    !simulator &&
    !nativeTouch &&
    event.pointerType === 'touch' &&
    touch?.id === event.pointerId
  ) {
    const dx = touch.x - event.clientX,
      dy = touch.y - event.clientY
    if (touch.moved || Math.abs(dx) + Math.abs(dy) > 5) {
      touch.moved = true
      const rect = canvas.getBoundingClientRect()
      coalesce({
        type: 'scroll',
        ...position(event),
        deltaX: Math.max(-4000, Math.min(4000, (dx * width) / rect.width)),
        deltaY: Math.max(-4000, Math.min(4000, (dy * height) / rect.height)),
      })
      touch.x = event.clientX
      touch.y = event.clientY
    }
  } else if (simulator || nativeTouch || event.pointerType !== 'touch')
    coalesce({
      type: 'pointer',
      phase: 'move',
      button: button(event),
      pointerType: event.pointerType === 'touch' ? 'touch' : 'mouse',
      ...position(event),
    })
}
canvas.onpointermove = movePointer
canvas.onpointerup = (event) => {
  if (!online || activePointer !== event.pointerId) return
  // WebKit may deliver the final position only on release, especially for fast flicks.
  // Chromium touchEnd contains no coordinates, so forward that movement first.
  if (pointerPosition?.clientX !== event.clientX || pointerPosition?.clientY !== event.clientY)
    movePointer(event)
  activePointer = undefined
  pointerPosition = undefined
  flushMovement()
  if (event.pointerType === 'touch' && !simulator && !nativeTouch) {
    if (touch?.id === event.pointerId && !touch.moved) {
      send({ type: 'pointer', phase: 'down', button: 'left', ...position(event) })
      send({ type: 'pointer', phase: 'up', button: 'left', ...position(event) })
    }
    touch = undefined
  } else
    send({
      type: 'pointer',
      phase: 'up',
      button: button(event),
      pointerType: event.pointerType === 'touch' ? 'touch' : 'mouse',
      ...position(event),
    })
}
function cancelPointer(event: PointerEvent) {
  if (activePointer !== event.pointerId) return
  activePointer = undefined
  cancelAnimationFrame(moveFrame)
  moveFrame = 0
  move = undefined
  touch = undefined
  send({
    type: 'pointer',
    phase: 'up',
    button: button(event),
    pointerType: event.pointerType === 'touch' ? 'touch' : 'mouse',
    ...position(pointerPosition ?? event),
  })
  pointerPosition = undefined
}
canvas.onpointercancel = cancelPointer
// Losing capture must release the host and clear the local pointer lock. Otherwise
// every later swipe is ignored until the viewer reconnects.
canvas.onlostpointercapture = cancelPointer
canvas.oncontextmenu = (event) => event.preventDefault()
canvas.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault()
    const multiplier = event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? height : 1
    coalesce({
      type: 'scroll',
      ...position(event),
      deltaX: Math.max(-4000, Math.min(4000, event.deltaX * multiplier)),
      deltaY: Math.max(-4000, Math.min(4000, event.deltaY * multiplier)),
    })
  },
  { passive: false },
)
const keys = new Set([
  'Enter',
  'Tab',
  'Escape',
  'Backspace',
  'Delete',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
])
function keydown(event: KeyboardEvent) {
  if (event.isComposing || !online) return
  // Let the client generate its paste event. Forwarding the shortcut would paste
  // the host's clipboard instead of the text the user explicitly chose here.
  if (
    ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v') ||
    (event.shiftKey && event.key === 'Insert')
  )
    return
  if (
    keys.has(event.key) ||
    ((event.metaKey || event.ctrlKey || event.altKey) && event.key.length === 1)
  ) {
    event.preventDefault()
    const modifiers = [
      event.ctrlKey && 'Control',
      event.metaKey && 'Meta',
      event.altKey && 'Alt',
      event.shiftKey && 'Shift',
    ].filter(Boolean)
    send({ type: 'key', key: [...modifiers, event.key].join('+') })
  } else if (event.target === canvas && event.key.length === 1) {
    event.preventDefault()
    send({ type: 'text', text: event.key })
  }
}
canvas.onkeydown = keydown
editor.onkeydown = keydown
canvas.onpaste = (event) => {
  const text = event.clipboardData?.getData('text/plain')
  if (text) {
    event.preventDefault()
    send({ type: 'text', text: text.slice(0, 16000) })
  }
}
function setKeyboard(open: boolean) {
  keyboardOpen = open
  keyboard.setAttribute('aria-pressed', String(open))
  if (open) {
    editor.value = sentinel
    editor.focus({ preventScroll: true })
    editor.setSelectionRange(1, 1)
  } else editor.blur()
}
keyboard.onclick = () => setKeyboard(!keyboardOpen)
editor.addEventListener('beforeinput', (event) => {
  if (composing || event.isComposing) return
  if (event.inputType === 'deleteContentBackward' || event.inputType === 'deleteContentForward') {
    event.preventDefault()
    send({ type: 'key', key: event.inputType === 'deleteContentBackward' ? 'Backspace' : 'Delete' })
  } else if (event.inputType === 'insertLineBreak' || event.inputType === 'insertParagraph') {
    event.preventDefault()
    send({ type: 'key', key: 'Enter' })
  }
})
function inputText() {
  if (composing) return
  const text = editor.value.replace(sentinel, '')
  if (text) send({ type: 'text', text: text.slice(0, 16000) })
  editor.value = sentinel
  editor.setSelectionRange(1, 1)
}
editor.oninput = inputText
editor.addEventListener('compositionstart', () => {
  composing = true
})
editor.addEventListener('compositionend', () => {
  composing = false
  inputText()
})
editor.onblur = () => {
  keyboardOpen = false
  keyboard.setAttribute('aria-pressed', 'false')
}
window.addEventListener('pagehide', () => {
  // Disconnect synchronously so suspended documents cannot accept stale input.
  const previous = socket
  socket = undefined
  enabled(false)
  previous?.close()
})
// Backgrounding disconnects the stream; the app obtains a fresh one-use ticket on return.
document.addEventListener('visibilitychange', () => {
  if (window.ReactNativeWebView) return
  if (document.hidden) socket?.close()
  else if (!online && !intentionallyClosed) bridge('reconnect')
})
enabled(false)
bridge('ready')
