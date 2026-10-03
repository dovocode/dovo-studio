import { createServer, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { expect, it } from 'vitest'
import { opencodeAdapter } from './opencode.js'
import { decode, mcpServerSchema } from '@dovo/protocol'

it('runs an OpenCode 2 prompt through its asynchronous event stream', async () => {
  let stream: ServerResponse | undefined
  let ready!: () => void
  const connected = new Promise<void>((resolve) => {
    ready = resolve
  })
  const requests: Array<{ path: string; body: unknown }> = []
  let mcpName = ''
  let mcpReads = 0
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname
    if (path === '/api/event') {
      stream = response
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.flushHeaders()
      response.write(`data: ${JSON.stringify({ type: 'server.connected' })}\n\n`)
      ready()
      return
    }
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', async () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined
      requests.push({ path, body })
      response.setHeader('Content-Type', 'application/json')
      if (path.startsWith('/api/experimental/mcp/')) {
        mcpName = decodeURIComponent(path.split('/').at(-1) ?? '')
        return response.writeHead(204).end()
      }
      if (path === '/api/mcp') {
        mcpReads++
        return response.end(
          JSON.stringify({
            data: [{ name: mcpName, status: { status: mcpReads === 1 ? 'pending' : 'connected' } }],
          }),
        )
      }
      if (path === '/api/info') return response.end(JSON.stringify({ version: '2.0.19' }))
      if (path === '/api/session/active') return response.end(JSON.stringify({ data: {} }))
      if (path.endsWith('/session') && request.method === 'POST') {
        return response.end(JSON.stringify({ data: { id: 'session' } }))
      }
      if (path === '/api/session/session' && request.method === 'DELETE')
        return response.writeHead(204).end()
      if (request.method === 'PATCH' || request.method === 'PUT' || path.endsWith('/model')) {
        response.statusCode = 204
        return response.end()
      }
      if (path.endsWith('/prompt')) {
        await connected
        response.end(JSON.stringify({ id: 'inbox', sessionID: 'session' }))
        const emit = (type: string, data: unknown) =>
          stream?.write(
            `data: ${JSON.stringify({ id: type, created: Date.now(), type, data })}\n\n`,
          )
        emit('session.execution.succeeded', { sessionID: 'session' })
        emit('session.execution.started', { sessionID: 'session' })
        emit('session.text.delta', {
          sessionID: 'other',
          assistantMessageID: 'a',
          ordinal: 0,
          delta: 'wrong',
        })
        emit('session.text.delta', {
          sessionID: 'session',
          assistantMessageID: 'a',
          ordinal: 0,
          delta: 'Hello',
        })
        emit('session.tool.input.started', {
          sessionID: 'session',
          assistantMessageID: 'a',
          id: 'tool-1',
          name: 'read',
        })
        emit('session.tool.called', {
          sessionID: 'session',
          assistantMessageID: 'a',
          id: 'tool-1',
          input: { filePath: '/tmp/file' },
          executed: true,
        })
        emit('session.tool.success', {
          sessionID: 'session',
          assistantMessageID: 'a',
          id: 'tool-1',
          content: [{ type: 'text', text: 'ok' }],
          executed: true,
        })
        emit('session.execution.succeeded', { sessionID: 'session' })
        return
      }
      response.end('{}')
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test address')
  const text: string[] = []
  const eventNames: string[] = []
  try {
    await opencodeAdapter.run({
      ephemeral: true,
      agent: {
        id: 'agent',
        name: 'Test',
        provider: 'opencode',
        endpoint: `http://127.0.0.1:${address.port}`,
        model: 'openai/test',
        permission: 'read-only',
        instructions: '',
        resources: {
          skills: [],
          mcpServers: [
            decode(mcpServerSchema, {
              name: 'dovo_task',
              enabled: true,
              transport: 'stdio',
              command: 'node',
              args: ['server.js'],
            }),
          ],
        },
      },
      cwd: '/tmp',
      prompt: 'Hi',
      signal: AbortSignal.timeout(5000),
      onSession: () => {},
      onText: (part) => text.push(part),
      onEvent: (name) => eventNames.push(name),
      onActivity: () => {},
      approve: async () => false,
      ask: async () => null,
    })
    expect(mcpReads).toBe(2)
    expect(requests.filter(({ path }) => path.endsWith('/prompt'))).toHaveLength(1)
    expect(text).toEqual(['Hello'])
    expect(eventNames.filter((name) => name === 'message.part.updated')).toHaveLength(3)
    expect(requests.map((request) => request.path)).toContain('/api/session/session/prompt')
    expect(requests.map((request) => request.path)).toContain('/api/session/session')
  } finally {
    stream?.end()
    server.close()
  }
})

it('waits for OpenCode 2 manual compaction to finish', async () => {
  let stream: ServerResponse | undefined
  const paths: string[] = []
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname
    paths.push(path)
    if (path === '/api/event') {
      stream = response
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.flushHeaders()
      response.write(`data: ${JSON.stringify({ type: 'server.connected' })}\n\n`)
      return
    }
    response.setHeader('Content-Type', 'application/json')
    if (path === '/api/info') return response.end(JSON.stringify({ version: '2.0.19' }))
    if (path === '/api/session/active') return response.end(JSON.stringify({ data: {} }))
    if (request.method === 'PATCH' || path.endsWith('/model')) {
      response.statusCode = 204
      return response.end()
    }
    if (path.endsWith('/compact')) {
      response.end(JSON.stringify({ id: 'compact-inbox', sessionID: 'session' }))
      stream?.write(
        `data: ${JSON.stringify({ id: 'compaction', created: Date.now(), type: 'session.compaction.ended', data: { sessionID: 'session', reason: 'manual', text: '', recent: '' } })}\n\n`,
      )
      return
    }
    response.end('{}')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test address')
  const events: string[] = []
  try {
    await opencodeAdapter.run({
      agent: {
        id: 'agent',
        name: 'Test',
        provider: 'opencode',
        endpoint: `http://127.0.0.1:${address.port}`,
        model: 'openai/test',
        permission: 'read-only',
        instructions: '',
      },
      cwd: '/tmp',
      prompt: '/compact',
      compact: true,
      sessionId: 'session',
      signal: AbortSignal.timeout(5000),
      onSession: () => {},
      onText: () => {},
      onActivity: () => {},
      onEvent: (name) => events.push(name),
      approve: async () => false,
      ask: async () => null,
    })
    expect(paths).toContain('/api/session/session/compact')
    expect(paths).not.toContain('/api/session/session/prompt')
    expect(events).toContain('session.compaction.ended')
  } finally {
    stream?.end()
    server.close()
  }
})

it('recognizes V1 servers that return the browser app for unknown API routes', async () => {
  const server = createServer((request, response) => {
    if (request.url === '/api/info') {
      response.writeHead(200, { 'Content-Type': 'text/html' })
      response.end('<!doctype html><html>OpenCode</html>')
    } else if (request.url?.startsWith('/global/health')) {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ healthy: true, version: '1.18.33' }))
    } else if (request.url?.startsWith('/provider')) {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(
        JSON.stringify({
          all: [
            {
              id: 'test',
              name: 'Test provider',
              models: { model: { id: 'model', name: 'Test model' } },
            },
          ],
          connected: ['test'],
          default: {},
        }),
      )
    } else response.writeHead(404).end()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing test address')
  const agent = {
    id: 'test',
    name: 'OpenCode',
    instructions: '',
    permission: 'ask' as const,
    provider: 'opencode' as const,
    endpoint: `http://127.0.0.1:${address.port}`,
    model: '',
  }
  try {
    expect((await opencodeAdapter.probe(agent)).available).toBe(true)
    const catalog = await opencodeAdapter.models!(agent)
    expect(catalog.harness).toEqual({ name: 'OpenCode v1', generation: 'v1' })
    expect(catalog.models).toEqual([
      { id: 'test/model', name: 'Test provider / Test model', reasoning: [] },
    ])
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

it('loads enabled v2 models and variants exclusively from the configured OpenCode host', async () => {
  const paths: string[] = []
  const server = createServer((request, response) => {
    paths.push(request.url ?? '')
    response.setHeader('Content-Type', 'application/json')
    if (request.url === '/api/info') return response.end(JSON.stringify({ version: '2.0.19' }))
    if (request.url === '/api/model')
      return response.end(
        JSON.stringify({
          location: {},
          data: [
            {
              enabled: true,
              providerID: 'host',
              modelID: 'custom',
              name: 'Host Custom Model',
              variants: [{ id: 'high' }],
            },
            {
              enabled: false,
              providerID: 'host',
              modelID: 'disabled',
              name: 'Disabled',
              variants: [],
            },
          ],
        }),
      )
    response.writeHead(404).end()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing test address')
  try {
    const catalog = await opencodeAdapter.models!({
      provider: 'opencode',
      endpoint: `http://127.0.0.1:${address.port}`,
      model: '',
    })
    expect(catalog).toEqual({
      harness: { name: 'OpenCode v2', generation: 'v2' },
      models: [
        { id: 'host/custom', name: 'Host Custom Model', reasoning: [{ id: 'high', name: 'high' }] },
      ],
      reasoning: [],
    })
    expect(paths).toEqual(['/api/info', '/api/model'])
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
