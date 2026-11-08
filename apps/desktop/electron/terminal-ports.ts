import { ipcMain, MessageChannelMain, type IpcMainEvent, type WebContents } from 'electron'
import { WebSocket } from 'ws'
import { trustedRendererUrl } from './renderer-trust.js'

/** Electron transports bytes by MessagePort; the independent runtime retains the PTY. */
export function registerTerminalPorts(rendererPath: string) {
  const sessions = new Map<WebContents, { close: Map<string, () => void>; cleanup: () => void }>()
  const trusted = (event: IpcMainEvent) =>
    !!event.senderFrame &&
    event.senderFrame === event.sender.mainFrame &&
    trustedRendererUrl(event.senderFrame.url, rendererPath, process.env.VITE_DEV_SERVER_URL)
  const validId = (input: unknown): input is { id: string } =>
    !!input &&
    typeof input === 'object' &&
    'id' in input &&
    typeof input.id === 'string' &&
    /^[0-9a-f-]{36}$/i.test(input.id)
  const connect = (event: IpcMainEvent, input: unknown) => {
    if (!trusted(event) || !validId(input) || !('url' in input) || typeof input.url !== 'string')
      return
    // A duplicate port could be mistaken for the original request by the renderer.
    if (sessions.get(event.sender)?.close.has(input.id)) return
    const { id } = input
    const { port1, port2 } = new MessageChannelMain()
    try {
      event.senderFrame!.postMessage('terminal:port', { id }, [port2])
    } catch {
      port1.close()
      port2.close()
      return
    }
    const error = (message: string) => {
      port1.postMessage({ type: 'error', message })
      port1.close()
    }
    let url: URL
    try {
      url = new URL(input.url)
      if (
        !['ws:', 'wss:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.hash ||
        url.pathname !== '/ws/terminal' ||
        !url.searchParams.get('ticket') ||
        url.searchParams.get('stream') !== 'binary-v1' ||
        input.url.length > 8192
      )
        throw new Error('Invalid terminal endpoint')
    } catch {
      error('Invalid terminal endpoint')
      return
    }
    const sender = event.sender
    let owned = sessions.get(sender)
    if (!owned) {
      const close = new Map<string, () => void>()
      const clear = () => {
        for (const stop of close.values()) stop()
      }
      const navigation = (_event: unknown, _url: string, _inPlace: boolean, mainFrame: boolean) => {
        if (mainFrame) clear()
      }
      const cleanup = () => {
        sessions.delete(sender)
        clear()
        sender.removeListener('destroyed', cleanup)
        sender.removeListener('did-start-navigation', navigation)
      }
      owned = { close, cleanup }
      sessions.set(sender, owned)
      sender.once('destroyed', cleanup)
      sender.on('did-start-navigation', navigation)
    }
    if (owned.close.size >= 20) {
      error('Close a terminal before opening another (limit 20).')
      return
    }
    let socket: WebSocket
    try {
      socket = new WebSocket(url, { maxPayload: 4 * 1024 * 1024, handshakeTimeout: 10000 })
    } catch {
      error('Terminal connection failed.')
      return
    }
    let stopped = false
    const close = () => {
      if (stopped) return
      stopped = true
      owned.close.delete(id)
      port1.removeAllListeners()
      port1.close()
      socket.removeAllListeners()
      socket.on('error', () => {})
      socket.close()
      if (!owned.close.size && sessions.get(sender) === owned) owned.cleanup()
    }
    owned.close.set(id, close)
    port1.on('close', close)
    port1.on('message', ({ data }: { data: unknown }) => {
      if (data && typeof data === 'object' && 'type' in data && data.type === 'close') {
        close()
        return
      }
      if (typeof data !== 'string' || Buffer.byteLength(data) > 128 * 1024) {
        port1.postMessage({ type: 'error', message: 'Invalid terminal input' })
        close()
        return
      }
      if (
        socket.readyState !== WebSocket.OPEN ||
        socket.bufferedAmount + Buffer.byteLength(data) > 1024 * 1024
      ) {
        port1.postMessage({ type: 'error', message: 'Terminal connection is not ready.' })
        close()
        return
      }
      socket.send(data)
    })
    port1.start()
    socket.on('open', () => {
      if (!stopped) port1.postMessage({ type: 'open' })
    })
    socket.on('message', (raw, binary) => {
      if (stopped) return
      const bytes = Array.isArray(raw)
        ? Buffer.concat(raw)
        : Buffer.isBuffer(raw)
          ? raw
          : Buffer.from(raw)
      // Standalone ArrayBuffer avoids exposing unrelated bytes from Node's buffer pool.
      const data = binary ? new Uint8Array(bytes).buffer : bytes.toString('utf8')
      port1.postMessage({ type: 'data', data })
    })
    socket.on('close', (_code, reason) => {
      if (!stopped)
        port1.postMessage({ type: 'close', message: reason.toString() || 'Terminal disconnected.' })
      close()
    })
    socket.on('error', () => {
      if (!stopped) port1.postMessage({ type: 'error', message: 'Terminal connection failed.' })
      close()
    })
  }
  const cancel = (event: IpcMainEvent, input: unknown) => {
    if (!trusted(event) || !validId(input)) return
    sessions.get(event.sender)?.close.get(input.id)?.()
  }
  ipcMain.on('terminal:connect', connect)
  ipcMain.on('terminal:cancel', cancel)
  return {
    dispose() {
      ipcMain.removeListener('terminal:connect', connect)
      ipcMain.removeListener('terminal:cancel', cancel)
      for (const owned of sessions.values()) owned.cleanup()
    },
  }
}
