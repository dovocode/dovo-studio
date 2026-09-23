import { decode } from '@dovo/protocol'
import { expect, it } from 'vitest'
import { createServer, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { mcpServerSchema } from '@dovo/protocol'
import { opencodeAdapter } from './opencode'
it.each([false, true])('streams assistant text with text-only tool policy %s', async (textOnly) => {
  let events: ServerResponse | undefined
  let promptBody = ''
  const requests: Array<{
    path: string
    body: string
  }> = []
  let ready: () => void = () => {}
  const listening = new Promise<void>((resolve) => {
    ready = resolve
  })
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
    let body = ''
    request.on('data', (chunk) => {
      body += String(chunk)
    })
    request.on('end', () =>
      requests.push({
        path,
        body,
      }),
    )
    response.setHeader('Content-Type', 'application/json')
    if (path === '/mcp') {
      request.on('end', () =>
        response.end(
          JSON.stringify({
            [JSON.parse(body).name]: {
              status: 'connected',
            },
          }),
        ),
      )
      return
    }
    if (path === '/session') {
      response.end(
        JSON.stringify({
          id: 'session',
        }),
      )
      return
    }
    if (path === '/session/session/message') {
      request.setEncoding('utf8')
      request.on('data', (chunk: string) => {
        promptBody += chunk
      })
      void listening.then(() => {
        const emit = (type: string, properties: unknown) =>
          events?.write(
            `data: ${JSON.stringify({
              type,
              properties,
            })}\n\n`,
          )
        emit('message.part.delta', {
          sessionID: 'unrelated',
          field: 'text',
          delta: 'Another task',
        })
        for (const [id, type, text] of [
          ['reason', 'reasoning', 'Private reasoning'],
          ['answer', 'text', 'Visible answer'],
        ]) {
          emit('message.part.updated', {
            sessionID: 'session',
            part: {
              id,
              type,
              sessionID: 'session',
              messageID: 'message',
              text: '',
            },
            time: Date.now(),
          })
          emit('message.part.delta', {
            sessionID: 'session',
            partID: id,
            messageID: 'message',
            field: 'text',
            delta: text,
          })
        }
        setTimeout(
          () =>
            response.end(
              JSON.stringify({
                info: {
                  id: 'message',
                },
                parts: [
                  {
                    type: 'text',
                    text: 'Fallback answer',
                  },
                ],
              }),
            ),
          50,
        )
      })
      return
    }
    response.end('{}')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test address')
  const chunks: string[] = []
  const journal: unknown[] = []
  try {
    await opencodeAdapter.run({
      ...(textOnly
        ? {
            tools: 'none' as const,
          }
        : {}),
      agent: {
        id: 'agent',
        name: 'Test',
        provider: 'opencode',
        endpoint: `http://127.0.0.1:${address.port}`,
        model: 'openai/test-model',
        reasoning: 'high',
        instructions: '',
        permission: 'read-only',
        resources: {
          skills: [],
          mcpServers: [
            decode(mcpServerSchema, {
              name: 'docs',
              enabled: true,
              transport: 'stdio',
              command: 'node',
              args: ['docs.js'],
            }),
          ],
        },
      },
      cwd: '/tmp',
      prompt: 'Test',
      attachments: [
        {
          id: 'fixture',
          name: 'image.png',
          size: 3,
          mime: 'image/png',
          path: '/tmp/image.png',
          data: 'YWJj',
        },
      ],
      signal: AbortSignal.timeout(5000),
      onSession: () => {},
      onText: (text) => chunks.push(text),
      onActivity: () => {},
      onEvent: (_name, payload) => journal.push(payload),
      approve: async () => false,
      ask: async () => null,
    })
    const session = JSON.parse(requests.find((request) => request.path === '/session')!.body)
    expect(session.permission).toContainEqual({
      permission: 'dovo_*',
      pattern: '*',
      action: 'deny',
    })
    const registrationBody = requests.find((request) => request.path === '/mcp')?.body
    expect(registrationBody === undefined).toBe(textOnly)
    const registration = JSON.parse(registrationBody ?? '{}')
    const managedName = expect.stringMatching(/^dovo_[a-f0-9]{12}_docs$/)
    expect(registration).toMatchObject(
      textOnly
        ? {}
        : {
            name: managedName,
            config: {
              type: 'local',
              command: ['node', 'docs.js'],
              enabled: true,
            },
          },
    )
    expect(
      requests.some((request) => request.path === `/mcp/${registration.name}/disconnect`),
    ).toBe(!textOnly)
    expect(session.permission).toEqual([
      {
        permission: '*',
        pattern: '*',
        action: 'deny',
      },
      ...(textOnly
        ? []
        : ['read', 'glob', 'grep', 'list', 'question'].map((permission) => ({
            permission,
            pattern: '*',
            action: 'allow',
          }))),
      {
        permission: 'dovo_*',
        pattern: '*',
        action: 'deny',
      },
      ...(textOnly
        ? []
        : [
            {
              permission: registration.name + '_*',
              pattern: '*',
              action: 'deny',
            },
          ]),
    ])
    expect(chunks).toEqual(['Visible answer'])
    expect(journal).toHaveLength(5)
    expect(JSON.stringify(journal)).not.toContain('Another task')
    expect(JSON.parse(promptBody)).toMatchObject({
      model: {
        providerID: 'openai',
        modelID: 'test-model',
      },
      variant: 'high',
      parts: [
        {
          type: 'text',
          text: 'Test',
        },
        {
          type: 'file',
          mime: 'image/png',
          filename: 'image.png',
          url: 'data:image/png;base64,YWJj',
        },
      ],
    })
  } finally {
    events?.end()
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})
