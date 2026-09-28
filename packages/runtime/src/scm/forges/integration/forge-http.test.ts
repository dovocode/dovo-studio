import { expect, it, vi } from 'vitest'
import { ForgeHttp } from './forge-http'
import type { ForgeConnection } from '@dovo/protocol'
const connection: ForgeConnection = {
  id: 'test',
  name: 'Test',
  provider: 'gitea',
  baseUrl: 'https://forge.example/root',
  credential: 'token',
  revision: '1',
}
it('keeps authorization within the configured API origin and reverse proxy path', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true }))
  const http = new ForgeHttp(connection, () => 'token secret', fetcher)
  await expect(http.json('/api/v1/repos')).resolves.toEqual({ ok: true })
  expect(fetcher.mock.calls[0]?.[0]).toEqual(new URL('https://forge.example/root/api/v1/repos'))
  expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: 'token secret' })
  for (const url of [
    'https://other.example/root/api',
    'https://forge.example/root-other/api',
    '../outside',
    'https://forge.example/root/%2e%2e%2foutside',
    'https://secret@forge.example/root/api',
  ])
    await expect(http.json(url)).rejects.toThrow('unsafe API URL')
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it('follows read redirects only after validating their destination and never replays redirected writes', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'https://outside.example/file' } }),
    )
  const http = new ForgeHttp(connection, () => 'token secret', fetcher)
  await expect(http.text('diff')).rejects.toThrow('unsafe API URL')
  expect(fetcher).toHaveBeenCalledTimes(1)
  fetcher.mockResolvedValueOnce(
    new Response(null, { status: 307, headers: { location: '/root/elsewhere' } }),
  )
  await expect(http.json('pulls', { method: 'POST', body: { title: 'New' } })).rejects.toThrow(
    'redirected a write',
  )
  expect(fetcher).toHaveBeenCalledTimes(2)
})
it('does not echo upstream error bodies or retry an uncertain mutation', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response('token secret was rejected', { status: 403 }))
    .mockRejectedValueOnce(new Error('secret network detail'))
  const http = new ForgeHttp(connection, () => 'token secret', fetcher)
  await expect(http.json('repository')).rejects.toThrow('permission')
  await expect(http.json('merge', { method: 'POST', body: {} })).rejects.toThrow(
    'may already have completed',
  )
  expect(fetcher).toHaveBeenCalledTimes(2)
})
it('retains queued response status, bounds content, and reports invalid JSON', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ task: 'queued' }, { status: 202 }))
    .mockResolvedValueOnce(new Response('{invalid'))
    .mockResolvedValueOnce(new Response('x'.repeat(16 * 1024 * 1024 + 1)))
  const http = new ForgeHttp(connection, () => 'token secret', fetcher)
  expect(await http.jsonResponse('merge', { method: 'POST' })).toMatchObject({
    status: 202,
    data: { task: 'queued' },
  })
  await expect(http.json('invalid')).rejects.toThrow('invalid JSON')
  await expect(http.text('large')).rejects.toThrow('exceeds 16 MB')
})
