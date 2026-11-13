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
