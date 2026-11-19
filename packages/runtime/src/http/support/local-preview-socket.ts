import { createPeerPipe } from '@dovo/protocol'
import { createConnection, type LookupFunction } from 'node:net'
import type { WebSocket } from 'ws'

const lookupLoopback: LookupFunction = (_hostname, options, callback) => {
  if (options.all) {
    callback(null, [
      { address: '::1', family: 6 },
      { address: '127.0.0.1', family: 4 },
    ])
  } else if (options.family === 6) {
    callback(null, '::1', 6)
  } else {
    callback(null, '127.0.0.1', 4)
  }
}

export function attachLocalPreviewSocket(client: WebSocket, origin: string) {
  const url = new URL(origin)
  const host = url.hostname === '0.0.0.0' ? '127.0.0.1' : url.hostname.replace(/^\[|\]$/g, '')
  const upstream = createConnection({
    host,
    port: Number(url.port || 80),
    allowHalfOpen: true,
    autoSelectFamily: true,
    lookup: lookupLoopback,
  })
  const timeout = setTimeout(() => pipe.stop(), 30 * 60_000)
  const connectTimeout = setTimeout(() => pipe.stop(), 10_000)
  timeout.unref()
  connectTimeout.unref()
  const pipe = createPeerPipe({
    stream: {
      onData: (callback) => {
        upstream.on('data', callback)
      },
      onEnd: (callback) => {
        upstream.on('end', callback)
      },
      onClose: (callback) => {
        upstream.on('close', callback)
      },
      onError: (callback) => {
        upstream.on('error', callback)
      },
      write: (data, callback) => {
        upstream.write(data, callback)
      },
      pause: () => {
        upstream.pause()
      },
      resume: () => {
        upstream.resume()
      },
      end: () => {
        upstream.end()
      },
      destroy: () => {
        upstream.destroy()
      },
    },
    send: (data) => client.send(data),
    close: () => client.close(),
  })
  upstream.once('connect', () => {
    clearTimeout(connectTimeout)
    pipe.ready()
  })
  client.on('message', (message, binary) => {
    const bytes = Buffer.isBuffer(message)
      ? message
      : Array.isArray(message)
        ? Buffer.concat(message)
        : Buffer.from(message)
    pipe.receive(binary ? bytes : bytes.toString())
  })
  client.once('close', () => {
    clearTimeout(timeout)
    clearTimeout(connectTimeout)
    pipe.stop()
  })
  client.on('error', () => pipe.stop())
}
