import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { WebContents } from 'electron'
import { WebSocketServer, WebSocket } from 'ws'
import { Schema } from 'effect'
import { decode, mutableStruct, desktopBrowserHostSchema } from '@dovo/protocol'

const commandSchema = mutableStruct({
  id: Schema.Number.pipe(Schema.check(Schema.isInt())),
  method: Schema.String,
  params: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  sessionId: Schema.optional(Schema.String),
})
type Target = {
  taskId: string
  profileId: string
  contents: Pick<WebContents, 'debugger' | 'getTitle' | 'getURL' | 'isDestroyed'>
  token: string
  clients: Set<WebSocket>
}

/** A page-only CDP transport: never exposes the Electron application or other targets. */
export async function createBrowserCdp(directory: string) {
  const targets = new Map<string, Target>()
  const path = join(directory, 'desktop-browser-host.json')
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 })
  let port = 0
  const websocketUrl = (id: string, target: Target) =>
    `ws://127.0.0.1:${port}/${target.token}/devtools/page/${id}`
  const save = () => {
    mkdirSync(directory, { recursive: true })
    writeFileSync(
      `${path}.tmp`,
      JSON.stringify(
        decode(desktopBrowserHostSchema, {
          pid: process.pid,
          targets: [...targets].map(([id, target]) => ({
            taskId: target.taskId,
            profileId: target.profileId,
            endpoint: websocketUrl(id, target),
          })),
        }),
      ),
      { mode: 0o600 },
    )
    renameSync(`${path}.tmp`, path)
  }
  const match = (raw = '') => {
    const parts = raw.split('/')
    const token = parts[1]
    return [...targets].find(
      ([, target]) => target.token === token && !target.contents.isDestroyed(),
    )
  }
  const server = createServer((request, response) => {
    const found = match(request.url)
    if (
      !found ||
      request.method !== 'GET' ||
      !/^\/[^/]+\/json(?:\/list)?$/.test(request.url ?? '')
    ) {
      response.writeHead(404).end()
      return
    }
    const [id, target] = found
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    response.end(
      JSON.stringify([
        {
          id,
          type: 'page',
          title: target.contents.getTitle(),
          url: target.contents.getURL(),
          webSocketDebuggerUrl: websocketUrl(id, target),
        },
      ]),
    )
  })
  server.on('upgrade', (request, socket, head) => {
    const found = match(request.url)
    // Browser pages cannot acquire automation access through their Origin header.
    if (
      !found ||
      request.headers.origin ||
      request.url !== `/${found[1].token}/devtools/page/${found[0]}`
    ) {
      socket.destroy()
      return
    }
    const [, target] = found
    sockets.handleUpgrade(request, socket, head, (client) => {
      const debuggerApi = target.contents.debugger
      try {
        if (!debuggerApi.isAttached()) debuggerApi.attach('1.3')
      } catch {
        client.close(1011, 'Debugger unavailable')
        return
      }
      target.clients.add(client)
      const event = (
        _event: Electron.Event,
        method: string,
        params: unknown,
        sessionId?: string,
      ) => {
        if (client.readyState === WebSocket.OPEN)
          client.send(JSON.stringify({ method, params, ...(sessionId ? { sessionId } : {}) }))
      }
      const detached = () => client.close(1011, 'Debugger detached')
      debuggerApi.on('message', event)
      debuggerApi.on('detach', detached)
      client.on('message', (raw) => {
        let id: number | undefined
        void (async () => {
          const command = decode(
            commandSchema,
            JSON.parse(
              (Array.isArray(raw)
                ? Buffer.concat(raw)
                : Buffer.isBuffer(raw)
                  ? raw
                  : Buffer.from(raw)
              ).toString('utf8'),
            ),
          )
          id = command.id
          // These domains can enumerate or attach unrelated Electron targets.
          if (/^(Browser|Target)\./.test(command.method))
            throw new Error('This endpoint supports page-scoped CDP only')
          const result: unknown = await debuggerApi.sendCommand(
            command.method,
            command.params,
            command.sessionId,
          )
          if (client.readyState === WebSocket.OPEN)
            client.send(
              JSON.stringify({
                id,
                result,
                ...(command.sessionId ? { sessionId: command.sessionId } : {}),
              }),
            )
        })().catch((error: unknown) => {
          if (client.readyState === WebSocket.OPEN)
            client.send(
              JSON.stringify({
                id,
                error: {
                  code: -32000,
                  message: error instanceof Error ? error.message : String(error),
                },
              }),
            )
        })
      })
      client.on('error', () => client.close())
      client.on('close', () => {
        target.clients.delete(client)
        debuggerApi.removeListener('message', event)
        debuggerApi.removeListener('detach', detached)
        if (
          !target.clients.size &&
          ![...targets.values()].some(
            (other) => other.contents === target.contents && other.clients.size,
          ) &&
          !target.contents.isDestroyed() &&
          debuggerApi.isAttached()
        )
          debuggerApi.detach()
      })
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing CDP listener')
  port = address.port
  const remove = (id: string) => {
    const target = targets.get(id)
    for (const client of target?.clients ?? []) client.terminate()
    targets.delete(id)
    save()
  }
  return {
    register(
      id: string,
      taskId: string,
      profileId: string,
      contents: Pick<WebContents, 'debugger' | 'getTitle' | 'getURL' | 'isDestroyed'>,
    ) {
      if (!targets.has(id)) {
        targets.set(id, {
          taskId,
          profileId,
          contents,
          token: randomBytes(32).toString('hex'),
          clients: new Set(),
        })
        save()
      }
      const target = targets.get(id)
      if (!target) throw new Error('CDP target missing')
      return websocketUrl(id, target)
    },
    remove,
    async close() {
      for (const id of [...targets.keys()]) remove(id)
      sockets.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      unlinkSync(path)
    },
  }
}
