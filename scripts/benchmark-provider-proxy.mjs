// One loopback proxy for all benchmark workers. Never log headers or bodies.
import { createServer, request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { setTimeout as delay } from 'node:timers/promises'

export function spacedGate({
  intervalMs = 3500,
  now = () => performance.now(),
  wait = delay,
} = {}) {
  if (!Number.isFinite(intervalMs) || intervalMs < 0) throw new Error('Invalid request interval')
  let next = 0
  let tail = Promise.resolve()
  return (signal) => {
    const turn = tail.then(async () => {
      signal?.throwIfAborted()
      const remaining = next - now()
      if (remaining > 0) await wait(remaining, undefined, { signal })
      signal?.throwIfAborted()
      next = now() + intervalMs
    })
    tail = turn.catch(() => {})
    return turn
  }
}

export async function startProviderProxy({ upstream, onDispatch = () => {}, intervalMs = 3500 }) {
  const target = new URL(upstream)
  if (
    !['http:', 'https:'].includes(target.protocol) ||
    target.username ||
    target.password ||
    target.search ||
    target.hash
  )
    throw new Error('Provider base URL must be HTTP(S) without credentials, query or fragment')
  const gate = spacedGate({ intervalMs })
  const shutdown = new AbortController()
  const active = new Set()
  const records = []
  const server = createServer(async (incoming, response) => {
    const abort = new AbortController()
    const cancel = () => {
      if (!response.writableFinished) abort.abort()
    }
    response.on('close', cancel)
    try {
      const url = new URL(incoming.url, target.origin)
      if (url.origin !== target.origin) throw new Error('Unexpected proxy target')
      await gate(AbortSignal.any([abort.signal, shutdown.signal]))
      const record = { startedAt: Date.now(), method: incoming.method, path: url.pathname }
      records.push(record)
      onDispatch(record)
      const headers = { ...incoming.headers, host: url.host }
      delete headers.connection
      delete headers['proxy-authorization']
      const outgoing = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
        url,
        {
          method: incoming.method,
          headers,
          signal: AbortSignal.any([abort.signal, shutdown.signal]),
        },
        (reply) => {
          record.status = reply.statusCode
          response.writeHead(reply.statusCode, reply.headers)
          reply.pipe(response)
        },
      )
      active.add(outgoing)
      outgoing.on('close', () => active.delete(outgoing))
      outgoing.on('error', () => {
        record.failed = true
        if (!response.headersSent) response.writeHead(502)
        response.end()
      })
      incoming.pipe(outgoing)
    } catch {
      if (!response.headersSent) response.writeHead(503)
      response.end()
    }
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  return {
    baseURL: `http://127.0.0.1:${address.port}${target.pathname.replace(/\/$/, '')}`,
    records,
    async close() {
      shutdown.abort()
      for (const request of active) request.destroy()
      server.closeAllConnections()
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    },
  }
}
