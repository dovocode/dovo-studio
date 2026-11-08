import { expect, it } from 'vite-plus/test'
import { createServer, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { opencodeAdapter } from './opencode.js'
import { OwnedProcessShutdownError } from '../../execution/stop-owned-child.js'

it.each(['delayed', 'rejected', 'status-unavailable'] as const)(
  'retains root ownership until OpenCode v1 cancellation is confirmed (%s)',
  async (outcome) => {
    const controller = new AbortController()
    const promptStarted = Promise.withResolvers<void>()
    const abortStarted = Promise.withResolvers<ServerResponse>()
    const statusRequested = Promise.withResolvers<void>()
    let idle = false
    let abortRequests = 0
    let sessionClosed = false
    let finished = false
    const server = createServer((request, response) => {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname
      response.setHeader('Content-Type', 'application/json')
      if (path === '/api/info') {
        response.writeHead(404).end('{}')
      } else if (path === '/session') {
        response.end(JSON.stringify({ id: 'root' }))
      } else if (path === '/event') {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' })
        response.flushHeaders()
      } else if (path === '/session/root/message') {
        promptStarted.resolve()
      } else if (path === '/session/root/abort') {
        abortRequests++
        abortStarted.resolve(response)
      } else if (path === '/session/status') {
        statusRequested.resolve()
        if (outcome === 'status-unavailable') response.writeHead(503).end('{}')
        else response.end(JSON.stringify(idle ? {} : { root: { type: 'busy' } }))
      } else {
        response.writeHead(404).end('{}')
      }
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test address')
    const task = opencodeAdapter
      .run({
        agent: {
          id: 'agent',
          name: 'Test',
          provider: 'opencode',
          model: '',
          instructions: '',
          endpoint: `http://127.0.0.1:${address.port}`,
          permission: 'read-only',
        },
        cwd: '/tmp',
        prompt: 'Test',
        signal: controller.signal,
        onSession: () => {},
        onText: () => {},
        onActivity: () => {},
        onSubagentEvent: (method) => {
          if (method === 'dovo/session/closed') sessionClosed = true
        },
        approve: async () => 'deny',
        ask: async () => null,
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      )
      .finally(() => {
        finished = true
      })
    try {
      await promptStarted.promise
      controller.abort(new Error('Task stopped'))
      const abortResponse = await abortStarted.promise
      // Merely issuing abort must not release the root or close its native session.
      expect(finished).toBe(false)
      expect(sessionClosed).toBe(false)
      let finishedBeforeIdle = false
      let closedBeforeIdle = false
      if (outcome === 'rejected') abortResponse.writeHead(503).end('{}')
      else {
        abortResponse.end('true')
        await statusRequested.promise
        finishedBeforeIdle = finished
        closedBeforeIdle = sessionClosed
        idle = true
      }
      const error = await task
      expect(abortRequests).toBe(1)
      expect(finishedBeforeIdle).toBe(false)
      expect(closedBeforeIdle).toBe(false)
      expect(error).toBeInstanceOf(Error)
      expect(error instanceof OwnedProcessShutdownError).toBe(outcome !== 'delayed')
      expect(sessionClosed).toBe(outcome === 'delayed')
    } finally {
      controller.abort()
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
      await task
    }
  },
)
