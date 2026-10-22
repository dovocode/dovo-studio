import { afterEach, expect, it, vi } from 'vite-plus/test'
import { Effect, Schema } from 'effect'
import { createRuntimeClient } from './runtime-client.js'
import { clearRuntimeRequestCache } from './client.js'

const connection = { address: 'http://100.64.0.2:4000', token: 'private-device-token' }
afterEach(() => {
  clearRuntimeRequestCache()
  vi.unstubAllGlobals()
})
it('binds authenticated Promise and Effect requests without repeating addresses', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ ok: true }))
  vi.stubGlobal('fetch', fetcher)
  const client = createRuntimeClient(connection)
  const schema = Schema.Struct({ ok: Schema.Boolean })
  expect(await client.request('/api/health', undefined, schema, { method: 'GET' })).toEqual({
    ok: true,
  })
  expect(
    await Effect.runPromise(
      client.requestEffect('/api/health', undefined, schema, { method: 'GET' }),
    ),
  ).toEqual({ ok: true })
  expect(fetcher).toHaveBeenCalledTimes(2)
  const [url, options] = fetcher.mock.calls[0]!
  expect(url instanceof Request ? url.url : url instanceof URL ? url.href : url).toBe(
    'http://100.64.0.2:4000/api/health',
  )
  expect(new Headers(options?.headers).get('authorization')).toBe('Bearer private-device-token')
})
it.each([
  ['http://100.64.0.2:4000', 'ws://100.64.0.2:4000'],
  ['https://runtime.test', 'wss://runtime.test'],
])('preserves the scheme for files and ticketed sockets on %s', (address, socket) => {
  const client = createRuntimeClient({ ...connection, address })
  expect(client.url('/file?share=approved')).toBe(`${address}/file?share=approved`)
  expect(client.socketUrl('/ws/terminal', 'one use&ticket')).toBe(
    `${socket}/ws/terminal?ticket=one+use%26ticket`,
  )
  expect(client.socketUrl('/ws/terminal', 'ticket')).not.toContain(connection.token)
})
it.each([
  'https://evil.test/file',
  '//evil.test/file',
  'http://user:password@100.64.0.2:4000/file',
  'javascript:alert(1)',
])('rejects URLs outside the selected runtime: %s', (path) => {
  const client = createRuntimeClient(connection)
  expect(() => client.url(path)).toThrow('selected origin')
  expect(() => client.socketUrl(path, 'ticket')).toThrow('selected origin')
})

it('rejects credential-bearing base URLs for files, sockets and requests', async () => {
  const client = createRuntimeClient({
    ...connection,
    address: 'http://user:password@runtime.test',
  })
  const fetcher = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetcher)
  const path = 'http://runtime.test/api/test'
  expect(() => client.url(path)).toThrow('selected origin')
  expect(() => client.socketUrl(path, 'ticket')).toThrow('selected origin')
  await expect(
    client.request(path, undefined, Schema.Unknown, { method: 'GET' }),
  ).rejects.toMatchObject({ kind: 'request' })
  expect(fetcher).not.toHaveBeenCalled()
})
