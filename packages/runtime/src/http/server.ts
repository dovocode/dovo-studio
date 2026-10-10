import { assertForeignDeviceScope } from '../previews/device-hosts.js'
import { attachRuntimeSync } from './support/runtime-sync.js'
import { pairingAddresses } from './support/pairing-addresses.js'
import { ValidationError, safeValidationIssues, safeValidationMessage } from '@dovo/protocol'
import { decode } from '@dovo/protocol'
import { completeRequest } from './support/request-activity.js'
import { createServer, type IncomingMessage } from 'node:http'
import type { Socket } from 'node:net'
import { WebSocketServer, WebSocket } from 'ws'

import { terminalInputSchema } from '@dovo/protocol'
import { RuntimeServices, type Services } from '../services.js'
import { Effect } from 'effect'
import { runClientEffect } from '@dovo/client-runtime'
import { route } from './routes.js'
import { json } from './support/body.js'
import { HttpError, errorMessage } from '../errors.js'
import { attachBrowserSocket } from './support/browser-socket.js'
export function createRuntimeServer(services: Services, internal = false) {
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
      'Authorization, Content-Type, X-Idempotency-Key, X-Dovo-Mutation-Id, If-None-Match',
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
          route(
            request,
            url,
            () => pairingAddresses(services.network?.pairingAddress() ?? server.address()),
            internal,
          ).pipe(Effect.provideService(RuntimeServices, services)),
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
  server.on('error', (error) => console.error('Runtime listener error', error))
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
  // One activity row per keystroke would grow the database with every character typed.
  // Compress sync JSON only: terminal/video transports retain their existing behavior.
  const syncSockets = new WebSocketServer({
    noServer: true,
    maxPayload: 128 * 1024,
    perMessageDeflate: {
      serverNoContextTakeover: true,
      clientNoContextTakeover: true,
      threshold: 1024,
      concurrencyLimit: 2,
      zlibDeflateOptions: { level: 3 },
    },
  })
  // Record terminal input as a count per terminal, at most every few seconds.
  const typed = new Map<string, { characters: number; timer: ReturnType<typeof setTimeout> }>()
  const recordInput = (terminalId: string, characters: number) => {
    const pending = typed.get(terminalId)
    if (pending) {
      pending.characters += characters
      return
    }
    const timer = setTimeout(() => {
      const entry = typed.get(terminalId)
      typed.delete(terminalId)
      if (!entry) return
      try {
        services.activity.add('terminal', terminalId, 'Terminal input', {
          characters: entry.characters,
        })
      } catch (error) {
        console.error('Could not record terminal input', error)
      }
    }, 5_000)
    timer.unref()
    typed.set(terminalId, { characters, timer })
  }
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
      if (url.pathname === '/ws/sync') {
        const ticket = services.tickets.consume(url.searchParams.get('ticket') ?? '')
        if (
          !['runtime-sync', 'runtime-sync-2', 'runtime-sync-3', 'runtime-sync-4'].includes(
            ticket.resourceId,
          )
        )
          throw new HttpError(401, 'Invalid sync ticket')
        services.devices.authenticate(ticket.token)
        syncSockets.handleUpgrade(request, socket, head, (client) => {
          track(client, ticket.token)
          attachRuntimeSync(
            client,
            ticket.token,
            services,
            ticket.resourceId !== 'runtime-sync',
            ['runtime-sync-3', 'runtime-sync-4'].includes(ticket.resourceId),
            ticket.syncTasks,
            ticket.pagedHistory,
          )
        })
        return
      }
      if (url.pathname === '/ws/mcp-app') {
        const ticket = services.tickets.consume(url.searchParams.get('ticket') ?? '')
        if (!ticket.resourceId.startsWith('mcp-app:') || !ticket.taskId)
          throw new HttpError(401, 'Invalid MCP App ticket')
        services.devices.authenticate(ticket.token)
        const taskId = ticket.taskId,
          id = ticket.resourceId.slice('mcp-app:'.length)
        sockets.handleUpgrade(request, socket, head, (client) => {
          track(client, ticket.token)
          try {
            const view = services.mcpApps.attachView(
              taskId,
              id,
              (value) => {
                if (client.readyState !== WebSocket.OPEN || client.bufferedAmount > 1024 * 1024)
                  throw new HttpError(409, 'MCP App view is unavailable')
                client.send(JSON.stringify(value))
              },
              () => {
                services.devices.authenticate(ticket.token)
              },
              () => client.close(1000, 'MCP App view closed'),
            )
            client.on('message', (data) => {
              try {
                const bytes = Buffer.isBuffer(data)
                  ? data
                  : Array.isArray(data)
                    ? Buffer.concat(data)
                    : Buffer.from(data)
                view.receive(JSON.parse(bytes.toString('utf8')))
              } catch {
                view.close()
                client.close(1008, 'Invalid MCP App message')
              }
            })
            client.on('close', view.close)
            client.on('error', view.close)
          } catch {
            client.close(1008, 'MCP App view unavailable')
          }
        })
        return
      }
      if (url.pathname === '/ws/device-host/simulator') {
        services.deviceHosts.assertEnabled()
        const ticket = services.deviceHostTickets.consume(url.searchParams.get('ticket') ?? '')
        const device = services.devices.authenticate(ticket.token)
        const scope = services.hostSimulators.taskId(ticket.resourceId, device.id)
        const authorize = () => {
          services.devices.authenticate(ticket.token)
          assertForeignDeviceScope(
            services.hostSimulators.taskId(ticket.resourceId, device.id),
            device.id,
          )
        }
        authorize()
        sockets.handleUpgrade(request, socket, head, (client) => {
          track(client, ticket.token)
          attachBrowserSocket(
            client,
            scope,
            ticket.token,
            services,
            true,
            ticket.resourceId,
            scope,
            authorize,
          )
        })
        return
      }
      if (url.pathname === '/ws/simulator') {
        services.deviceHosts.assertEnabled()
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
        services.store.task(ticket.taskId ?? ticket.resourceId)
        sockets.handleUpgrade(request, socket, head, (client) => {
          track(client, ticket.token)
          attachBrowserSocket(
            client,
            ticket.taskId ?? ticket.resourceId,
            ticket.token,
            services,
            url.searchParams.get('frames') === 'binary-v1',
            undefined,
            ticket.resourceId,
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
          } catch {
            client.close(1008, 'Device authentication required')
            return
          }
          try {
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
              recordInput(ticket.resourceId, input.data.length)
              services.terminals.input(ticket.resourceId, input.data)
            } else services.terminals.resize(ticket.resourceId, input.cols, input.rows)
          } catch {
            client.close(1008, 'Invalid terminal request')
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
    for (const { timer } of typed.values()) clearTimeout(timer)
    typed.clear()
    for (const socket of authenticated.keys()) socket.terminate()
    sockets.close()
    syncSockets.close()
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
      // A client that stopped reading (phone backgrounded mid-download) never lets its
      // response finish. Bound the drain so shutdown cannot wait on that socket forever.
      const grace = setTimeout(() => {
        for (const socket of connections) socket.destroy()
      }, 15_000)
      grace.unref()
      // A disconnected client does not cancel its asynchronous route handler.
      // Keep services and SQLite available until those handlers have settled too.
      closing = Promise.all([closed, ...requests.values()])
        .then(() => {})
        .finally(() => clearTimeout(grace))
      return closing
    },
  }
}
