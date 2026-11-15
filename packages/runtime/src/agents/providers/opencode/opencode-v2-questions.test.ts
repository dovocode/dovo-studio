import { createServer, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { expect, it } from 'vite-plus/test'
import { questionAnswerError } from '@dovo/protocol'
import { Questions } from '../../execution/questions.js'
import { opencodeV2Adapter } from './opencode-v2.js'

it.each([
  { type: 'string', custom: undefined, allowed: false },
  { type: 'string', custom: false, allowed: false },
  { type: 'string', custom: true, allowed: true },
  { type: 'multiselect', custom: undefined, allowed: false },
  { type: 'multiselect', custom: false, allowed: false },
  { type: 'multiselect', custom: true, allowed: true },
] as const)(
  'respects OpenCode $type custom=$custom through question validation and HTTP replies',
  async ({ type, custom, allowed }) => {
    let stream: ServerResponse | undefined
    const replies: unknown[] = []
    const emit = (eventType: string, data: unknown) =>
      stream?.write(
        `data: ${JSON.stringify({ id: eventType, created: Date.now(), type: eventType, data })}\n\n`,
      )
    const server = createServer((request, response) => {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname
      if (path === '/api/event') {
        stream = response
        response.writeHead(200, { 'Content-Type': 'text/event-stream' })
        response.flushHeaders()
        emit('server.connected', {})
        return
      }
      response.setHeader('Content-Type', 'application/json')
      if (path === '/api/info') return response.end(JSON.stringify({ version: '2.0.19' }))
      if (path === '/api/session') {
        response.end(JSON.stringify({ data: { id: 'session' } }))
        return
      }
      if (path === '/api/session/session/prompt') {
        request.resume()
        response.end(JSON.stringify({ id: 'inbox', sessionID: 'session' }))
        emit('session.execution.started', { sessionID: 'session' })
        emit('form.created', {
          form: {
            id: 'form',
            sessionID: 'session',
            title: 'Choose a direction',
            fields: [
              {
                key: 'choice',
                type,
                options: [{ value: 'existing', label: 'Existing approach' }],
                ...(custom === undefined ? {} : { custom }),
              },
              { key: 'context', type: 'string' },
            ],
          },
        })
        return
      }
      if (path === '/api/session/session/form/form/reply') {
        const chunks: Buffer[] = []
        request.on('data', (chunk: Buffer) => chunks.push(chunk))
        request.on('end', () => {
          replies.push(JSON.parse(Buffer.concat(chunks).toString()))
          response.writeHead(204).end()
          emit('session.execution.succeeded', { sessionID: 'session' })
        })
        return
      }
      response.writeHead(404).end('{}')
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test address')
    const questions = new Questions({ add: () => undefined })
    let asked = 0
    try {
      await opencodeV2Adapter.run({
        agent: {
          id: 'agent',
          name: 'Test',
          provider: 'opencode',
          model: '',
          endpoint: `http://127.0.0.1:${address.port}`,
          instructions: '',
          permission: 'read-only',
        },
        cwd: '/tmp',
        prompt: 'Ask a question',
        signal: AbortSignal.timeout(5000),
        onSession: () => {},
        onText: () => {},
        onActivity: () => {},
        approve: async () => 'deny',
        ask: async (prompt, signal) => {
          asked++
          expect(prompt.questions[0].custom).toBe(allowed)
          expect(prompt.questions[1].custom).toBe(true)
          const pending = questions.request('task', prompt, signal ?? new AbortController().signal)
          const id = questions.list()[0].id
          const context = ['My own context']
          expect(
            questionAnswerError(prompt.questions, { choice: ['My own answer'], context }),
          ).toBe(allowed ? undefined : 'Choose an available option for choice')
          expect(questions.list()).toHaveLength(1)
          expect(replies).toEqual([])
          questions.respond(id, {
            choice: allowed
              ? type === 'multiselect'
                ? ['existing', 'My own answer']
                : ['My own answer']
              : ['existing'],
            context,
          })
          return pending
        },
      })
      expect(asked).toBe(1)
      expect(replies).toEqual([
        {
          answer: {
            choice:
              type === 'multiselect'
                ? allowed
                  ? ['existing', 'My own answer']
                  : ['existing']
                : allowed
                  ? 'My own answer'
                  : 'existing',
            context: 'My own context',
          },
        },
      ])
      expect(questions.list()).toEqual([])
    } finally {
      stream?.end()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  },
)

it.each(['answer', 'dismiss', 'stop', 'reconnect'] as const)(
  'keeps a child question after parent completion and handles %s without blocking events',
  async (action) => {
    let stream: ServerResponse | undefined
    let working = true
    let parentEnded!: () => void
    const parent = new Promise<void>((resolve) => {
      parentEnded = resolve
    })
    const form = {
      id: 'child-form',
      sessionID: 'child',
      title: 'Worker question',
      fields: [{ key: 'choice', type: 'string' }],
    }
    let recovered!: () => void
    const recovery = new Promise<void>((resolve) => {
      recovered = resolve
    })
    const calls: Array<{ path: string; body: unknown; message: string | null }> = []
    const controller = new AbortController()
    const questions = new Questions({ add: () => undefined })
    const emit = (type: string, data: unknown) =>
      stream?.write(
        `data: ${JSON.stringify({ id: crypto.randomUUID(), created: Date.now(), type, data })}\n\n`,
      )
    const server = createServer((request, response) => {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname
      if (path === '/api/event') {
        stream = response
        response.writeHead(200, { 'Content-Type': 'text/event-stream' })
        response.flushHeaders()
        emit('server.connected', {})
        return
      }
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        calls.push({
          path,
          body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined,
          message: new URL(request.url ?? '/', 'http://localhost').searchParams.get('message'),
        })
        response.setHeader('Content-Type', 'application/json')
        if (path === '/api/info') return response.end(JSON.stringify({ version: '2.0.19' }))
        if (path === '/api/session')
          return response.end(JSON.stringify({ data: { id: 'session' } }))
        if (path === '/api/session/active')
          return response.end(JSON.stringify({ data: working ? { child: {} } : {} }))
        if (path.endsWith('/prompt')) {
          response.end(JSON.stringify({ id: 'inbox', sessionID: 'session' }))
          emit('session.execution.started', { sessionID: 'session' })
          emit('session.created', { id: 'child', parentID: 'session', title: 'Worker' })
          emit('session.execution.started', { sessionID: 'child' })
          if (action !== 'reconnect') {
            emit('form.created', { form })
            emit('form.created', { form })
          }
          emit('session.execution.succeeded', { sessionID: 'session' })
          if (action === 'reconnect') stream?.end()
          return
        }
        if (path === '/api/permission/request') return response.end(JSON.stringify({ data: [] }))
        if (path === '/api/session/child/form') {
          response.end(JSON.stringify({ data: [form] }))
          recovered()
          return
        }
        if (path.includes('/form/child-form')) {
          response.writeHead(204).end()
          working = false
          emit('session.execution.succeeded', { sessionID: 'child' })
          return
        }
        if (path.endsWith('/wait')) return response.writeHead(204).end()
        if (path.endsWith('/interrupt')) working = false
        response.end('{}')
      })
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test address')
    let asked = 0
    let questionReady!: () => void
    const ready = new Promise<void>((resolve) => {
      questionReady = resolve
    })
    const running = opencodeV2Adapter.run({
      agent: {
        id: 'agent',
        name: 'Test',
        provider: 'opencode',
        model: '',
        endpoint: `http://127.0.0.1:${address.port}`,
        instructions: '',
        permission: 'read-only',
      },
      cwd: '/tmp',
      prompt: 'Delegate',
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
      onSession: () => {},
      onText: () => {},
      onActivity: () => {},
      approve: async () => 'deny',
      ask: async () => {
        throw new Error('Child used the parent question lifecycle')
      },
      onNativeTurnEnd: parentEnded,
      nativeAgentInteractions: {
        approve: async () => 'deny',
        ask: (prompt, signal) => {
          asked++
          const pending = questions.request('task', prompt, signal ?? controller.signal)
          questionReady()
          return pending
        },
      },
    })
    void running.catch(() => undefined)
    try {
      await parent
      if (action === 'reconnect') await recovery
      await Promise.race([
        ready,
        running.then(() => {
          throw new Error('Run ended before the child question')
        }),
      ])
      expect(asked).toBe(1)
      expect(questions.list()).toHaveLength(1)
      const question = questions.list()[0]!
      let runError: unknown
      if (action === 'stop') {
        controller.abort()
        await running.catch((error: unknown) => {
          runError = error
        })
      } else {
        questions.respond(
          question.id,
          action === 'answer' || action === 'reconnect' ? { choice: ['Proceed'] } : null,
        )
        await running
      }
      const stoppedError = expect.objectContaining({
        message: expect.stringMatching(/cancelled|aborted/i),
      })
      expect(runError).toEqual(action === 'stop' ? stoppedError : undefined)
      expect(calls.filter((call) => call.path.includes('/form/child-form'))).toEqual(
        action === 'stop'
          ? []
          : [
              action === 'answer' || action === 'reconnect'
                ? {
                    path: '/api/session/child/form/child-form/reply',
                    body: { answer: { choice: 'Proceed' } },
                    message: null,
                  }
                : {
                    path: '/api/session/child/form/child-form',
                    body: undefined,
                    message: 'The user dismissed this question. Continue without an answer.',
                  },
            ],
      )
      expect(questions.list()).toEqual([])
    } finally {
      controller.abort()
      stream?.end()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  },
)
