import { expect, it } from 'vitest'
import { createServer, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { opencodeAdapter } from './opencode'
import type { AgentRun } from '../types'
it.each([
  {
    version: 'legacy',
    outcome: 'reply',
  },
  {
    version: 'legacy',
    outcome: 'reject',
  },
  {
    version: 'v2',
    outcome: 'reply',
  },
  {
    version: 'v2',
    outcome: 'reject',
  },
  {
    version: 'v2',
    outcome: 'ended',
  },
])('handles $version questions when $outcome', async ({ version, outcome }) => {
  let events: ServerResponse | undefined
  let turn: ServerResponse | undefined
  let replyBody = ''
  let replyPath = ''
  let asked = 0
  let ready: () => void = () => {}
  const listening = new Promise<void>((resolve) => {
    ready = resolve
  })
  const complete = () =>
    turn?.end(
      JSON.stringify({
        info: {
          id: 'message',
        },
        parts: [],
      }),
    )
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname
    if (path === '/event') {
      events = response
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
      })
      response.flushHeaders()
      ready()
      return
    }
    response.setHeader('Content-Type', 'application/json')
    if (path === '/session') {
      response.end(
        JSON.stringify({
          id: 'session',
        }),
      )
      return
    }
    if (path === '/session/session/message') {
      turn = response
      void listening.then(() => {
        for (const sessionID of ['unrelated', 'session'])
          events?.write(
            `data: ${JSON.stringify({
              type: version === 'v2' ? 'question.v2.asked' : 'question.asked',
              properties: {
                id: 'question',
                sessionID,
                questions: [
                  {
                    header: 'Checks',
                    question: 'Which checks?',
                    multiple: true,
                    custom: false,
                    options: [
                      {
                        label: 'Types',
                        description: '',
                      },
                      {
                        label: 'Tests',
                        description: '',
                      },
                    ],
                  },
                ],
              },
            })}\n\n`,
          )
      })
      return
    }
    if (path.includes('/question/')) {
      replyPath = path
      request.setEncoding('utf8')
      request.on('data', (chunk: string) => {
        replyBody += chunk
      })
      request.on('end', () => {
        response.end('true')
        complete()
      })
      return
    }
    response.end('{}')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test address')
  const ask: AgentRun['ask'] = async (prompt, signal) => {
    asked++
    expect(prompt.questions[0]).toMatchObject({
      multiple: true,
      custom: false,
    })
    if (outcome === 'ended') {
      complete()
      if (!signal) throw new Error('Questions must follow the event stream lifetime')
      if (!signal.aborted)
        await new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), {
            once: true,
          }),
        )
      return null
    }
    return outcome === 'reply'
      ? {
          '0': ['Types', 'Tests'],
        }
      : null
  }
  try {
    await opencodeAdapter.run({
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
      signal: AbortSignal.timeout(5000),
      onSession: () => {},
      onText: () => {},
      onActivity: () => {},
      approve: async () => false,
      ask,
    })
    expect(asked).toBe(1)
    expect(replyPath).toBe(
      outcome === 'ended'
        ? ''
        : `${version === 'v2' ? '/api/session/session' : ''}/question/question/${outcome}`,
    )
    expect(replyBody ? JSON.parse(replyBody) : null).toEqual(
      outcome === 'reply'
        ? {
            answers: [['Types', 'Tests']],
          }
        : null,
    )
  } finally {
    events?.end()
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})
