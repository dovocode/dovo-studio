import { createServer } from 'node:http'
import { once } from 'node:events'
import { defaultTaskHarness } from '@dovo/protocol'
import { expect, it } from 'vite-plus/test'
import { readOpencodeThread } from './opencode-thread'

it.each([1, 2])(
  'reads OpenCode v%s native history over HTTP without starting or interrupting a turn',
  async (version) => {
    const requests: { path: string; method: string | undefined }[] = []
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://localhost')
      requests.push({ path: url.pathname, method: request.method })
      response.setHeader('Content-Type', 'application/json')
      if (url.pathname === '/api/info') {
        response.statusCode = version === 2 ? 200 : 404
        return response.end(JSON.stringify({ version: `${version}.0.24` }))
      }
      if (version === 1 && url.pathname === '/session/child/message')
        return response.end(
          JSON.stringify([
            {
              info: { id: 'user', role: 'user' },
              parts: [{ id: 'prompt', type: 'text', text: 'Inspect' }],
            },
            {
              info: { id: 'assistant', role: 'assistant' },
              parts: [{ id: 'reply', type: 'text', text: 'Done' }],
            },
          ]),
        )
      if (version === 2 && url.pathname === '/api/session/child/message') {
        const older = !url.searchParams.get('cursor')
        return response.end(
          JSON.stringify({
            data: [
              {
                id: older ? 'prompt' : 'reply',
                type: 'user',
                time: { created: 1 },
                text: older ? 'Inspect' : 'More',
              },
            ],
            cursor: { next: older ? 'next' : null },
          }),
        )
      }
      response.statusCode = 404
      response.end(JSON.stringify({ error: `Unexpected request: ${url.pathname}` }))
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture address')
    try {
      const entries = await readOpencodeThread(
        {
          ...defaultTaskHarness('opencode'),
          id: 'fixture',
          name: 'Fixture',
          endpoint: `http://127.0.0.1:${address.port}`,
        },
        'child',
      )
      expect(entries).toEqual([
        { id: 'prompt', role: 'user', text: 'Inspect' },
        {
          id: 'reply',
          role: version === 1 ? 'assistant' : 'user',
          text: version === 1 ? 'Done' : 'More',
        },
      ])
      expect(requests.every((request) => request.method === 'GET')).toBe(true)
      expect(requests).toHaveLength(version === 1 ? 2 : 3)
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    }
  },
)
