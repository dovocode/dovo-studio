import TcpSocket from 'react-native-tcp-socket'
import { createPeerPipe } from '@dovo/protocol'

export async function openLocalBrowserTunnel(
  page: string,
  ticket: () => Promise<string>,
  signal: AbortSignal,
  onError: (error: Error) => void,
) {
  signal.throwIfAborted()
  const sessions = new Set<() => void>()
  let closed = false
  const listener = TcpSocket.createServer(
    { allowHalfOpen: true, pauseOnConnect: true, noDelay: true },
    (socket) => {
      if (closed || sessions.size >= 24) {
        socket.destroy()
        return
      }
      let websocket: WebSocket | undefined
      let pipe: ReturnType<typeof createPeerPipe> | undefined
      const close = () => {
        if (!sessions.delete(close)) return
        if (pipe) pipe.stop()
        else {
          socket.destroy()
          websocket?.close()
        }
      }
      sessions.add(close)
      const closePending = () => {
        if (!pipe) close()
      }
      socket.once('close', closePending)
      socket.on('error', closePending)
      socket.pause()
      void ticket()
        .then((url) => {
          if (!sessions.has(close)) return
          const channel = new WebSocket(url)
          websocket = channel
          channel.binaryType = 'arraybuffer'
          pipe = createPeerPipe({
            stream: {
              onData: (callback) => {
                socket.on('data', (bytes) => {
                  if (typeof bytes === 'string') close()
                  else callback(bytes)
                })
              },
              onEnd: (callback) => {
                socket.on('end', callback)
              },
              onClose: (callback) => {
                socket.on('close', callback)
              },
              onError: (callback) => {
                socket.on('error', callback)
              },
              write: (data, callback) => {
                socket.write(data, undefined, callback)
              },
              pause: () => {
                socket.pause()
              },
              resume: () => {
                socket.resume()
              },
              end: () => {
                socket.end()
              },
              destroy: () => {
                socket.destroy()
              },
            },
            send: (value) =>
              channel.send(typeof value === 'string' ? value : Uint8Array.from(value).buffer),
            close: () => channel.close(),
          })
          channel.onopen = () => pipe?.ready()
          channel.onmessage = ({ data }: { data: unknown }) => {
            if (typeof data === 'string') pipe?.receive(data)
            else if (data instanceof ArrayBuffer) pipe?.receive(new Uint8Array(data))
            else close()
          }
          channel.onerror = () => {
            if (!closed) onError(new Error('Lost the preview connection to the computer.'))
            close()
          }
          channel.onclose = close
        })
        .catch((cause: unknown) => {
          if (!closed) onError(cause instanceof Error ? cause : new Error(String(cause)))
          close()
        })
    },
  )
  const close = () => {
    if (closed) return
    closed = true
    signal.removeEventListener('abort', close)
    for (const stop of sessions) stop()
    listener.close()
  }
  signal.addEventListener('abort', close, { once: true })
  try {
    await new Promise<void>((resolve, reject) => {
      listener.once('error', reject)
      listener.listen({ host: '127.0.0.1', port: 0 }, () => {
        listener.removeListener('error', reject)
        if (closed) {
          listener.close()
          reject(new Error('The preview closed.'))
        } else resolve()
      })
    })
    listener.on('error', (error) => {
      if (!closed) onError(error)
      close()
    })
    const address = listener.address()
    if (!address || !('port' in address)) throw new Error('Could not open the local preview.')
    const path = new URL(page)
    path.hostname = '127.0.0.1'
    path.port = String(address.port)
    return { url: path.href, close }
  } catch (error) {
    close()
    throw error
  }
}
