import { afterEach, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { runtimeRequest, clearRuntimeRequestCache, getRuntimeSnapshotTag } from './client.js'
import { REPOSITORY_CLONE_TIMEOUT_MS } from './repositories.js'
import { cleanedDictationSchema, cleanupDictationSchema } from './title-generation.js'

afterEach(() => {
  clearRuntimeRequestCache()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const connection = { address: 'http://computer.test:51464', token: 'test-device-credential' }
const dataSchema = z.object({ revision: z.number() })
const readSnapshot = (selected = connection) =>
  runtimeRequest(selected, selected.address, '/api/snapshot', undefined, dataSchema, 'GET')

it.each([
  '/api/scm/work/issues/list',
  '/api/scm/work/issues/action',
  '/api/scm/work/pipelines/action',
  '/api/scm/jira/bind',
])('allows CLI-backed %s to finish without an early timeout or duplicate request', async (path) => {
  vi.useFakeTimers()
  const request = vi.fn<typeof fetch>(async (_url, options) => {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 61000)
      options?.signal?.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(new Error('Request aborted'))
      })
    })
    return Response.json({ revision: 1 })
  })
  vi.stubGlobal('fetch', request)
  const pending = runtimeRequest(connection, connection.address, path, {}, dataSchema).catch(
    (error: unknown) => error,
  )
  await vi.advanceTimersByTimeAsync(61000)
  expect(await pending).toEqual({ revision: 1 })
  expect(request).toHaveBeenCalledTimes(1)
})

it('uses strict bounded dictation payloads and allows time for server cleanup timeout errors', async () => {
  expect(cleanupDictationSchema.safeParse({ text: 'hello', extra: true }).success).toBe(false)
  expect(cleanupDictationSchema.safeParse({ text: 'x'.repeat(12001) }).success).toBe(false)
  expect(cleanedDictationSchema.safeParse({ text: 'hello', title: 'unexpected' }).success).toBe(
    false,
  )
  vi.useFakeTimers()
  let signal: AbortSignal | null | undefined
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (_url, options) => {
      signal = options?.signal
      await new Promise((resolve) => setTimeout(resolve, 31000))
      return Response.json(
        { error: 'Dictation cleanup timed out. Your dictation is unchanged.' },
        { status: 500 },
      )
    }),
  )
  const pending = runtimeRequest(
    connection,
    connection.address,
    '/api/tasks/dictation/cleanup',
    { text: 'hello' },
    cleanedDictationSchema,
  )
  const rejected = pending.catch((error: unknown) => error)
  await vi.advanceTimersByTimeAsync(31000)
  expect(await rejected).toMatchObject({
    message: expect.stringContaining('Dictation cleanup timed out'),
  })
  expect(signal?.aborted).toBe(false)
})

it('reuses only a validated snapshot body after a conditional GET returns 304', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({ revision: 1 }, { headers: { ETag: 'W/"snapshot-one"' } }),
    )
    .mockResolvedValueOnce(
      new Response(null, { status: 304, headers: { ETag: 'W/"snapshot-one"' } }),
    )
  vi.stubGlobal('fetch', request)
  const first = await readSnapshot(),
    unchanged = await readSnapshot()
  expect(first).toEqual({ revision: 1 })
  expect(unchanged).toEqual({ revision: 1 })
  expect(getRuntimeSnapshotTag(first)).toBe('W/"snapshot-one"')
  expect(getRuntimeSnapshotTag(unchanged)).toBe(getRuntimeSnapshotTag(first))
  expect(request.mock.calls[0][1]?.headers).not.toHaveProperty('If-None-Match')
  expect(request.mock.calls[1][1]?.headers).toHaveProperty('If-None-Match', 'W/"snapshot-one"')
})

it('isolates snapshot validators by runtime origin and credentials', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockImplementation(async () =>
      Response.json({ revision: 1 }, { headers: { ETag: 'W/"snapshot-one"' } }),
    )
  vi.stubGlobal('fetch', request)
  await readSnapshot()
  await readSnapshot({ ...connection, token: 'another-device-credential' })
  await readSnapshot({ ...connection, address: 'http://other-computer.test:51464' })
  await readSnapshot({ ...connection })
  for (const index of [0, 1, 2])
    expect(request.mock.calls[index][1]?.headers).not.toHaveProperty('If-None-Match')
  expect(request.mock.calls[3][1]?.headers).toHaveProperty('If-None-Match', 'W/"snapshot-one"')
  clearRuntimeRequestCache(connection)
  await readSnapshot()
  expect(request.mock.calls[4][1]?.headers).not.toHaveProperty('If-None-Match')
})

it('recovers with one unconditional snapshot read if a 304 has no cached body', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 304 }))
    .mockResolvedValueOnce(
      Response.json({ revision: 2 }, { headers: { ETag: 'W/"snapshot-two"' } }),
    )
  vi.stubGlobal('fetch', request)
  expect(await readSnapshot()).toEqual({ revision: 2 })
  expect(request).toHaveBeenCalledTimes(2)
  expect(request.mock.calls[1][1]?.headers).not.toHaveProperty('If-None-Match')
})

it('does not reuse an in-flight response cache after its credentials were forgotten', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({ revision: 1 }, { headers: { ETag: 'W/"snapshot-one"' } }),
    )
    .mockImplementationOnce(async () => {
      clearRuntimeRequestCache(connection)
      return new Response(null, { status: 304 })
    })
    .mockResolvedValueOnce(
      Response.json({ revision: 2 }, { headers: { ETag: 'W/"snapshot-two"' } }),
    )
    .mockResolvedValueOnce(
      Response.json({ revision: 2 }, { headers: { ETag: 'W/"snapshot-two"' } }),
    )
  vi.stubGlobal('fetch', request)
  await readSnapshot()
  expect(await readSnapshot()).toEqual({ revision: 2 })
  await readSnapshot()
  expect(request.mock.calls[3][1]?.headers).not.toHaveProperty('If-None-Match')
})

it('expires idle snapshot bodies and bounds remembered credentials', async () => {
  vi.useFakeTimers()
  const request = vi
    .fn<typeof fetch>()
    .mockImplementation(async () =>
      Response.json({ revision: 1 }, { headers: { ETag: 'W/"snapshot-one"' } }),
    )
  vi.stubGlobal('fetch', request)
  await readSnapshot()
  for (let index = 0; index < 8; index++)
    await readSnapshot({ ...connection, token: `other-device-${index}` })
  await readSnapshot()
  expect(request.mock.calls[9][1]?.headers).not.toHaveProperty('If-None-Match')
  await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1)
  await readSnapshot()
  expect(request.mock.calls[10][1]?.headers).not.toHaveProperty('If-None-Match')
})

it('never retries mutations on 304 or caches invalid schema responses', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 304 }))
    .mockResolvedValueOnce(
      Response.json({ revision: 'invalid' }, { headers: { ETag: 'W/"snapshot-bad"' } }),
    )
    .mockResolvedValueOnce(
      Response.json({ revision: 1 }, { headers: { ETag: 'W/"snapshot-one"' } }),
    )
  vi.stubGlobal('fetch', request)
  await expect(
    runtimeRequest(connection, connection.address, '/api/workspace', {}, dataSchema, 'PATCH'),
  ).rejects.toThrow('unexpected unchanged response')
  expect(request).toHaveBeenCalledTimes(1)
  await expect(readSnapshot()).rejects.toThrow(z.ZodError)
  await readSnapshot()
  expect(request.mock.calls[2][1]?.headers).not.toHaveProperty('If-None-Match')
})

it('clears remembered snapshots when device authentication is rejected', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({ revision: 1 }, { headers: { ETag: 'W/"snapshot-one"' } }),
    )
    .mockResolvedValueOnce(Response.json({ error: 'Device revoked' }, { status: 401 }))
    .mockResolvedValueOnce(
      Response.json({ revision: 2 }, { headers: { ETag: 'W/"snapshot-two"' } }),
    )
  vi.stubGlobal('fetch', request)
  await readSnapshot()
  await expect(readSnapshot()).rejects.toThrow('Device revoked')
  await readSnapshot()
  expect(request.mock.calls[2][1]?.headers).not.toHaveProperty('If-None-Match')
})

it('explains unreachable hosts without exposing saved credentials', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network request failed')))
  await expect(
    runtimeRequest(
      { address: 'http://my-computer:51464', token: 'private-device-token' },
      'http://my-computer:51464',
      '/api/snapshot',
      undefined,
      z.unknown(),
      'GET',
    ),
  ).rejects.toThrow(
    'Cannot reach my-computer:51464. Check that its runtime is running and both devices are on the same Wi-Fi or VPN.',
  )
})

it('allows clone requests more time than ordinary requests', async () => {
  vi.useFakeTimers()
  vi.stubGlobal(
    'fetch',
    (_url: URL, options: RequestInit) =>
      new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(new Error('Request aborted')))
      }),
  )
  const request = runtimeRequest(
    null,
    'http://localhost',
    '/api/scm/repositories/add',
    {},
    z.unknown(),
  )
  await Promise.all([
    expect(request).rejects.toThrow('took too long to respond'),
    (async () => {
      await vi.advanceTimersByTimeAsync(30000)
      expect(vi.getTimerCount()).toBe(1)
      await vi.advanceTimersByTimeAsync(REPOSITORY_CLONE_TIMEOUT_MS)
    })(),
  ])
  expect(vi.getTimerCount()).toBe(0)
})

it('validates responses and only sends credentials on authenticated requests', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('{"ok":true}'))
  vi.stubGlobal('fetch', fetch)
  await expect(
    runtimeRequest(
      null,
      'http://localhost:8787',
      '/api/pair/request',
      { code: '12345678' },
      z.object({ ok: z.boolean() }),
    ),
  ).resolves.toEqual({ ok: true })
  expect(fetch.mock.calls[0]?.[1]?.headers).not.toHaveProperty('Authorization')
  fetch.mockResolvedValue(new Response('{"ok":true}'))
  await runtimeRequest(
    { address: 'http://localhost:8787', token: 'device-token' },
    'http://localhost:8787',
    '/api/snapshot',
    undefined,
    z.object({ ok: z.boolean() }),
    'GET',
  )
  expect(fetch.mock.calls[1]?.[1]).toMatchObject({
    method: 'GET',
    headers: { Authorization: 'Bearer device-token' },
  })
  expect(fetch.mock.calls[1]?.[1]).not.toHaveProperty('body')
})

it('preserves runtime error messages and rejects invalid response schemas', async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(new Response('{"error":"Device revoked"}', { status: 401 }))
  vi.stubGlobal('fetch', fetch)
  await expect(
    runtimeRequest(
      null,
      'http://localhost',
      '/api/snapshot',
      undefined,
      z.object({ ok: z.boolean() }),
    ),
  ).rejects.toThrow('Device revoked')
  fetch.mockResolvedValue(new Response('{"ok":"invalid"}'))
  await expect(
    runtimeRequest(
      null,
      'http://localhost',
      '/api/snapshot',
      undefined,
      z.object({ ok: z.boolean() }),
    ),
  ).rejects.toThrow(z.ZodError)
})

it('aborts stalled requests without requiring AbortSignal.timeout on mobile', async () => {
  vi.useFakeTimers()
  vi.stubGlobal(
    'fetch',
    (_url: URL, options: RequestInit) =>
      new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(new Error('Request aborted')))
      }),
  )
  await Promise.all([
    expect(
      runtimeRequest(null, 'http://localhost', '/api/snapshot', undefined, z.unknown()),
    ).rejects.toThrow('took too long to respond'),
    vi.advanceTimersByTimeAsync(30000),
  ])
  expect(vi.getTimerCount()).toBe(0)
})
