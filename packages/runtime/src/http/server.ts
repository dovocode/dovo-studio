import { pairingAddresses } from './pairing-addresses.js'
import { ValidationError, safeValidationIssues, safeValidationMessage } from '@dovo/protocol'
import { decode } from '@dovo/protocol'
import { completeRequest } from './request-activity.js'
import { createServer, type IncomingMessage } from 'node:http'
import type { Socket } from 'node:net'
import { WebSocketServer, WebSocket } from 'ws'

import { terminalInputSchema } from '@dovo/protocol'
import { RuntimeServices, type Services } from '../services.js'
import { Effect } from 'effect'
import { runClientEffect } from '@dovo/client-runtime'
import { route } from './routes.js'
import { json } from './body.js'
import { HttpError, errorMessage } from '../errors.js'
import { attachBrowserSocket } from './browser-socket.js'
export function createRuntimeServer(services: Services) {
  let stopping = false
  let closing: Promise<void> | undefined
  const connections = new Set<Socket>()
  const requests = new Map<IncomingMessage, Promise<void>>()
  const closeIncompleteConnections = () => {
    if (!stopping) return
    for (const socket of connections) {
      // Keep fully received requests alive until their handler and response finish.
      // Preconnections and partial headers/bodies have no work to drain.
      if (![...requests.keys()].some((request) => request.socket === socket && request.complete))
        socket.destroy()
    }
  }
  const server = createServer((request, response) => {
    if (stopping) {
      response.writeHead(503, {
        Connection: 'close',
      })
      response.end('Runtime is shutting down')
      return
    }
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.setHeader(
      'Access-Control-Allow-Headers',
      'Authorization, Content-Type, X-Idempotency-Key, If-None-Match',
    )
    response.setHeader('Access-Control-Expose-Headers', 'ETag')
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS')
    if (request.method === 'OPTIONS') {
      response.writeHead(204)
      response.end()
      return
    }
    const finished = new Promise<void>((resolve) => {
      response.once('finish', resolve)
      response.once('close', resolve)
    })
    const handled = Promise.resolve()
      .then(() => {
        let url: URL
        try {
          url = new URL(request.url ?? '/', 'http://runtime.local')
        } catch {
          throw new HttpError(400, 'Invalid request URL')
        }
        return runClientEffect(
          route(request, url, () => pairingAddresses(server.address())).pipe(
            Effect.provideService(RuntimeServices, services),
          ),
        )
      })
      .then((result) => {
        completeRequest(request, 200)
        return json(request, response, 200, result)
      })
      .catch((error: unknown) => {
        const status =
          error instanceof HttpError ? error.status : error instanceof ValidationError ? 400 : 500
        // Schema diagnostics can embed entire submitted values, including credentials.
        const message =
          error instanceof ValidationError ? safeValidationMessage(error) : errorMessage(error)
        completeRequest(request, status, message)
        return json(request, response, status, {
          error: message,
          ...(error instanceof ValidationError ? { issues: safeValidationIssues(error) } : {}),
        })
      })
    const done = Promise.all([handled, finished])
      .then(() => {})
      .finally(() => {
        requests.delete(request)
        closeIncompleteConnections()
      })
    requests.set(request, done)
    void done.catch((error: unknown) => console.error('Runtime request failed', error))
  })
  // Mobile clients reuse idle sockets; closing them sooner than the client's pool races new
  // requests into "network connection was lost". TCP keepalive detects peers that left the LAN/VPN.
  server.keepAliveTimeout = 65_000
  server.on('connection', (socket) => {
    socket.setKeepAlive(true, 30_000)
    connections.add(socket)
    socket.once('close', () => connections.delete(socket))
    if (stopping) socket.destroy()
  })
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: 128 * 1024,
  })
  const authenticated = new Map<WebSocket, string>()
  const responsive = new WeakSet<WebSocket>()
  const track = (client: WebSocket, token: string) => {
    authenticated.set(client, token)
    responsive.add(client)
    client.on('pong', () => responsive.add(client))
    client.on('close', () => authenticated.delete(client))
    client.on('error', () => authenticated.delete(client))
  }
  server.on('upgrade', (request, socket, head) => {
    if (stopping) {
      socket.destroy()
      return
    }
    try {
      const url = new URL(request.url ?? '/', 'http://runtime.local')
      if (url.pathname === '/ws/simulator') {
        const ticket = services.simulatorTickets.consume(url.searchParams.get('ticket') ?? '')
        services.devices.authenticate(ticket.token)
        const taskId = services.simulators.taskId(ticket.resourceId)
        services.store.task(taskId)
        sockets.handleUpgrade(request, socket, head, (client) => {
          track(client, ticket.token)
          attachBrowserSocket(client, taskId, ticket.token, services, true, ticket.resourceId)
        })
        return
      }
      if (url.pathname === '/ws/browser') {
        const ticket = services.browserTickets.consume(url.searchParams.get('ticket') ?? '')
        services.devices.authenticate(ticket.token)
        services.store.task(ticket.resourceId)
        sockets.handleUpgrade(request, socket, head, (client) => {
          track(client, ticket.token)
          attachBrowserSocket(
            client,
            ticket.resourceId,
            ticket.token,
            services,
            url.searchParams.get('frames') === 'binary-v1',
          )
        })
        return
      }
      if (url.pathname !== '/ws/terminal') throw new HttpError(404, 'Not found')
      const ticket = services.tickets.consume(url.searchParams.get('ticket') ?? '')
      services.devices.authenticate(ticket.token)
      services.terminals.get(ticket.resourceId)
      sockets.handleUpgrade(request, socket, head, (client) => {
        track(client, ticket.token)
        services.activity.add('terminal', ticket.resourceId, 'Terminal connected')
        const detach = services.terminals.attach(ticket.resourceId, (data) => {
          if (client.readyState === WebSocket.OPEN) {
            if (client.bufferedAmount > 2 * 1024 * 1024)
              client.close(1013, 'Terminal client is too slow')
            else client.send(data)
          }
        })
        client.on('message', (raw) => {
          try {
            services.devices.authenticate(ticket.token)
            const input = decode(
              terminalInputSchema,
              JSON.parse(
                (Array.isArray(raw)
                  ? Buffer.concat(raw)
                  : Buffer.isBuffer(raw)
                    ? raw
                    : Buffer.from(raw)
                ).toString(),
              ),
            )
            if (input.type === 'ping') {
              // Binary control frames cannot be confused with raw terminal text.
              client.send(JSON.stringify({ type: 'pong', nonce: input.nonce }), { binary: true })
            } else if (input.type === 'input') {
              services.activity.add('terminal', ticket.resourceId, 'Terminal input', {
                characters: input.data.length,
              })
              services.terminals.input(ticket.resourceId, input.data)
            } else services.terminals.resize(ticket.resourceId, input.cols, input.rows)
          } catch {
            client.close(1008, 'Invalid terminal request or revoked device')
          }
        })
        client.on('error', () => {
          detach()
          authenticated.delete(client)
        })
        client.on('close', () => {
          detach()
          authenticated.delete(client)
        })
      })
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
    }
  })
  const revocations = setInterval(() => {
    for (const [socket, token] of authenticated) {
      try {
        services.devices.authenticate(token)
      } catch {
        socket.close(1008, 'Device revoked')
      }
    }
  }, 1000)
  revocations.unref()
  // A phone that sleeps or leaves the network leaves a half-open socket that keeps a
  // terminal attached or a browser capture running. Reap sockets that miss a pong.
  const liveness = setInterval(() => {
    for (const socket of authenticated.keys()) {
      if (!responsive.delete(socket)) {
        socket.terminate()
        continue
      }
      try {
        socket.ping()
      } catch {
        socket.terminate()
      }
    }
  }, 30_000)
  liveness.unref()
  const closeSockets = () => {
    clearInterval(revocations)
    clearInterval(liveness)
    for (const socket of authenticated.keys()) socket.terminate()
    sockets.close()
  }
  return {
    server,
    closeSockets,
    close: () => {
      if (closing) return closing
      stopping = true
      const closed = new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
      closeSockets()
      closeIncompleteConnections()
      // A disconnected client does not cancel its asynchronous route handler.
      // Keep services and SQLite available until those handlers have settled too.
      closing = Promise.all([closed, ...requests.values()]).then(() => {})
      return closing
    },
  }
}
