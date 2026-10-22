/// <reference types="node" />
import { ValidationError, mutableStruct, decodeResult } from './schema.js'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { Schema } from 'effect'
import { runtimeRequest, clearRuntimeRequestCache, getRuntimeSnapshotTag } from './client.js'
import { resolveRuntimeEndpoint } from '../runtime/connection/routes.js'
import { REPOSITORY_CLONE_TIMEOUT_MS } from '../scm/repositories/repositories.js'
import { cleanedDictationSchema, cleanupDictationSchema } from '../tasks/title-generation.js'
afterEach(() => {
  clearRuntimeRequestCache()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
const connection = {
  address: 'http://computer.test:51464',
  token: 'test-device-credential',
}
const dataSchema = mutableStruct({
  revision: Schema.Number.pipe(Schema.check(Schema.isFinite())),
})
const readSnapshot = (selected = connection) =>
  runtimeRequest(selected, selected.address, '/api/snapshot', undefined, dataSchema, 'GET')
it.each(['GET', 'HEAD', 'get', 'head'])(
  'reports a %s request with a body as an invalid request before attempting fetch',
  async (method) => {
    const request = vi.fn<typeof fetch>(async (url, options) => {
      new Request(url, options)
      return Response.json({ revision: 1 })
    })
    vi.stubGlobal('fetch', request)
    await expect(
      runtimeRequest(connection, connection.address, '/api/device-hosts', {}, dataSchema, method),
    ).rejects.toMatchObject({
      kind: 'request',
      message: `Runtime ${method.toUpperCase()} requests cannot include a body.`,
    })
    expect(request).not.toHaveBeenCalled()
  },
)
it.each([
  { path: '/api/scm/push', input: { repositoryId: 'repo' }, delay: 241000 },
  { path: '/api/scm/push', input: { repositoryId: 'repo', taskId: 'task' }, delay: 661000 },
  { path: '/api/tasks/handoff', input: { id: 'task', target: 'worktree' }, delay: 661000 },
  { path: '/api/mcp-apps/rpc', input: { method: 'tools/call' }, delay: 721000 },
  { path: '/api/mcp-apps/rpc', input: { method: 'resources/read' }, delay: 121000 },
  {
    path: '/api/agents/models',
    input: {
      provider: 'acp',
      model: 'b',
      acpMode: 'code',
      acpConfig: { thought: 'high', flag: 'true' },
    },
    delay: 201000,
  },
  { path: '/api/agents/models', input: { provider: 'grok', model: 'b' }, delay: 151000 },
  { path: '/api/tasks/commit-message', input: { id: 'task' }, delay: 91000 },
  { path: '/api/tasks/commit', input: { id: 'task', push: true }, delay: 151000 },
  {
    path: '/api/scm/repositories/github/create',
    input: { path: '/project', name: 'project', visibility: 'private' },
    delay: 241000,
  },
  {
    path: '/api/scm/repositories/forge/read',
    input: { connectionId: 'gitea', page: 1 },
    delay: 91000,
  },
  {
    path: '/api/scm/repositories/forge/inspect',
    input: { connectionId: 'gitea', repository: 'team/project' },
    delay: 61000,
  },
  {
    path: '/api/scm/repositories/forge/bind',
    input: {
      repositoryId: 'project',
      forge: { connectionId: 'gitea', repository: 'team/project' },
    },
    delay: 61000,
  },
  { path: '/api/previews/devices', input: { taskId: 'task' }, delay: 281000 },
  {
    path: '/api/previews/simulator/open',
    input: { taskId: 'task', id: 'remote:host:physical-ios:phone' },
    delay: 431000,
  },
  { path: '/api/pull-request-watch', input: { action: 'watch' }, delay: 61000 },
  {
    path: '/api/pipeline-watch',
    input: { action: 'watch', runIds: ['7', '8', '9'] },
    delay: 181000,
  },
  {
    path: '/api/pipeline-watch',
    input: { action: 'watch', runIds: Array.from({ length: 20 }, (_, index) => String(index)) },
    delay: 1200000,
  },
])('allows $path to finish without aborting or replaying it', async ({ path, input, delay }) => {
  vi.useFakeTimers()
  const request = vi.fn<typeof fetch>(async (_url, options) => {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, delay)
      options?.signal?.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(new Error('Request aborted'))
      })
    })
    return Response.json({ revision: 1 })
  })
  vi.stubGlobal('fetch', request)
  const pending = runtimeRequest(connection, connection.address, path, input, dataSchema).catch(
    (error: unknown) => error,
  )
  await vi.advanceTimersByTimeAsync(delay)
  expect(await pending).toEqual({ revision: 1 })
  expect(request).toHaveBeenCalledTimes(1)
  expect(request.mock.calls[0][1]?.signal?.aborted).toBe(false)
})
it.each([
  { path: '/api/scm/push', input: { repositoryId: 'repo' }, deadline: 300000 },
  { path: '/api/scm/push', input: { repositoryId: 'repo', taskId: 'task' }, deadline: 900000 },
  { path: '/api/tasks/handoff', input: { id: 'task', target: 'worktree' }, deadline: 900000 },
  { path: '/api/mcp-apps/rpc', input: { method: 'tools/call' }, deadline: 750000 },
  { path: '/api/mcp-apps/rpc', input: { method: 'resources/read' }, deadline: 150000 },
  { path: '/api/mcp-apps/rpc', input: { method: 'ui/cancel' }, deadline: 30000 },
  { path: '/api/agents/models', input: { provider: 'acp', model: '' }, deadline: 105000 },
  {
    path: '/api/agents/models',
    input: {
      provider: 'acp',
      model: 'b',
      acpMode: 'code',
      acpConfig: { thought: 'high', flag: 'true' },
    },
    deadline: 225000,
  },
  { path: '/api/agents/models', input: { provider: 'grok', model: 'b' }, deadline: 165000 },
  { path: '/api/agents/models', input: { provider: 'codex', model: 'b' }, deadline: 65000 },
  { path: '/api/tasks/commit-message', input: { id: 'task' }, deadline: 120000 },
  { path: '/api/tasks/commit', input: { id: 'task' }, deadline: 180000 },
  {
    path: '/api/scm/repositories/github/create',
    input: { path: '/project', name: 'project', visibility: 'private' },
    deadline: 300000,
  },
  {
    path: '/api/scm/repositories/forge/read',
    input: { connectionId: 'gitea', page: 1 },
    deadline: 180000,
  },
  {
    path: '/api/scm/repositories/forge/inspect',
    input: { connectionId: 'gitea', repository: 'team/project' },
    deadline: 180000,
  },
  {
    path: '/api/scm/repositories/forge/bind',
    input: {
      repositoryId: 'project',
      forge: { connectionId: 'gitea', repository: 'team/project' },
    },
    deadline: 180000,
  },
  { path: '/api/previews/devices', input: { taskId: 'task' }, deadline: 300000 },
  {
    path: '/api/previews/simulator/open',
    input: { taskId: 'task', id: 'remote:host:physical-ios:phone' },
    deadline: 450000,
  },
  { path: '/api/scm/repositories/git-status', input: { path: '/project' }, deadline: 30000 },
  { path: '/api/previews/browser/open', input: { taskId: 'task' }, deadline: 120000 },
  { path: '/api/pull-request-watch', input: { action: 'watch' }, deadline: 180000 },
  {
    path: '/api/pipeline-watch',
    input: { action: 'watch', runIds: ['7', '7', '8'] },
    deadline: 360000,
  },
  { path: '/api/pipeline-watch', input: { action: 'status' }, deadline: 30000 },
  { path: '/api/pull-request-watch', input: { action: 'stop' }, deadline: 30000 },
])('still bounds $path requests and aborts a stalled fetch', async ({ path, input, deadline }) => {
  vi.useFakeTimers()
  const request = vi.fn<typeof fetch>(
    (_url, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new Error('Request aborted')))
      }),
  )
  vi.stubGlobal('fetch', request)
  const pending = runtimeRequest(connection, connection.address, path, input, dataSchema).catch(
    (error: unknown) => error,
  )
  await vi.advanceTimersByTimeAsync(deadline - 1)
  expect(request.mock.calls[0][1]?.signal?.aborted).toBe(false)
  await vi.advanceTimersByTimeAsync(2)
  expect(await pending).toMatchObject({ kind: 'timeout' })
  expect(request).toHaveBeenCalledTimes(1)
  expect(request.mock.calls[0][1]?.signal?.aborted).toBe(true)
})
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
    return Response.json({
      revision: 1,
    })
  })
  vi.stubGlobal('fetch', request)
  const pending = runtimeRequest(connection, connection.address, path, {}, dataSchema).catch(
    (error: unknown) => error,
  )
  await vi.advanceTimersByTimeAsync(61000)
  expect(await pending).toEqual({
    revision: 1,
  })
  expect(request).toHaveBeenCalledTimes(1)
})
it('uses strict bounded dictation payloads and allows time for server cleanup timeout errors', async () => {
  expect(
    decodeResult(cleanupDictationSchema, {
      text: 'hello',
      extra: true,
    }).success,
  ).toBe(false)
  expect(
    decodeResult(cleanupDictationSchema, {
      text: 'x'.repeat(12001),
    }).success,
  ).toBe(false)
  expect(
    decodeResult(cleanedDictationSchema, {
      text: 'hello',
      title: 'unexpected',
    }).success,
  ).toBe(false)
  vi.useFakeTimers()
  let signal: AbortSignal | null | undefined
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (_url, options) => {
      signal = options?.signal
      await new Promise((resolve) => setTimeout(resolve, 31000))
      return Response.json(
        {
          error: 'Dictation cleanup timed out. Your dictation is unchanged.',
        },
        {
          status: 500,
        },
      )
    }),
  )
  const pending = runtimeRequest(
    connection,
    connection.address,
    '/api/tasks/dictation/cleanup',
    {
      text: 'hello',
    },
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
      Response.json(
        {
          revision: 1,
        },
        {
          headers: {
            ETag: 'W/"snapshot-one"',
          },
        },
      ),
    )
    .mockResolvedValueOnce(
      new Response(null, {
        status: 304,
        headers: {
          ETag: 'W/"snapshot-one"',
        },
      }),
    )
  vi.stubGlobal('fetch', request)
  const first = await readSnapshot(),
    unchanged = await readSnapshot()
  expect(first).toEqual({
    revision: 1,
  })
  expect(unchanged).toEqual({
    revision: 1,
  })
  expect(getRuntimeSnapshotTag(first)).toBe('W/"snapshot-one"')
  expect(getRuntimeSnapshotTag(unchanged)).toBe(getRuntimeSnapshotTag(first))
  expect(request.mock.calls[0][1]?.headers).not.toHaveProperty('If-None-Match')
  expect(request.mock.calls[1][1]?.headers).toHaveProperty('If-None-Match', 'W/"snapshot-one"')
})
it('isolates snapshot validators by runtime origin and credentials', async () => {
  const request = vi.fn<typeof fetch>().mockImplementation(async () =>
    Response.json(
      {
        revision: 1,
      },
      {
        headers: {
          ETag: 'W/"snapshot-one"',
        },
      },
    ),
  )
  vi.stubGlobal('fetch', request)
  await readSnapshot()
  await readSnapshot({
    ...connection,
    token: 'another-device-credential',
  })
  await readSnapshot({
    ...connection,
    address: 'http://other-computer.test:51464',
  })
  await readSnapshot({
    ...connection,
  })
  for (const index of [0, 1, 2])
    expect(request.mock.calls[index][1]?.headers).not.toHaveProperty('If-None-Match')
  expect(request.mock.calls[3][1]?.headers).toHaveProperty('If-None-Match', 'W/"snapshot-one"')
  clearRuntimeRequestCache(connection)
  await readSnapshot()
  expect(request.mock.calls[4][1]?.headers).not.toHaveProperty('If-None-Match')
})
it('does not reuse a full snapshot validator for a compact overview', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockImplementation(async () =>
      Response.json({ revision: 1 }, { headers: { ETag: 'W/"snapshot-one"' } }),
    )
  vi.stubGlobal('fetch', request)
  await readSnapshot()
  await runtimeRequest(
    connection,
    connection.address,
    '/api/snapshot?scope=overview',
    undefined,
    dataSchema,
    'GET',
  )
  await readSnapshot()
  expect(request.mock.calls[1][1]?.headers).not.toHaveProperty('If-None-Match')
  expect(request.mock.calls[2][1]?.headers).toHaveProperty('If-None-Match', 'W/"snapshot-one"')
})
it('reuses an unchanged large snapshot without storing a second JSON copy', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json(
        { revision: 1, history: 'x'.repeat(16 * 1024 * 1024 + 1) },
        { headers: { ETag: 'W/"large-snapshot"' } },
      ),
    )
    .mockResolvedValueOnce(new Response(null, { status: 304 }))
  vi.stubGlobal('fetch', request)
  const first = await readSnapshot()
  expect(await readSnapshot()).toEqual(first)
  expect(request).toHaveBeenCalledTimes(2)
  expect(request.mock.calls[1][1]?.headers).toHaveProperty('If-None-Match', 'W/"large-snapshot"')
})
it('recovers with one unconditional snapshot read if a 304 has no cached body', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(null, {
        status: 304,
      }),
    )
    .mockResolvedValueOnce(
      Response.json(
        {
          revision: 2,
        },
        {
          headers: {
            ETag: 'W/"snapshot-two"',
          },
        },
      ),
    )
  vi.stubGlobal('fetch', request)
  expect(await readSnapshot()).toEqual({
    revision: 2,
  })
  expect(request).toHaveBeenCalledTimes(2)
  expect(request.mock.calls[1][1]?.headers).not.toHaveProperty('If-None-Match')
})
it('does not reuse an in-flight response cache after its credentials were forgotten', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json(
        {
          revision: 1,
        },
        {
          headers: {
            ETag: 'W/"snapshot-one"',
          },
        },
      ),
    )
    .mockImplementationOnce(async () => {
      clearRuntimeRequestCache(connection)
      return new Response(null, {
        status: 304,
      })
    })
    .mockResolvedValueOnce(
      Response.json(
        {
          revision: 2,
        },
        {
          headers: {
            ETag: 'W/"snapshot-two"',
          },
        },
      ),
    )
    .mockResolvedValueOnce(
      Response.json(
        {
          revision: 2,
        },
        {
          headers: {
            ETag: 'W/"snapshot-two"',
          },
        },
      ),
    )
  vi.stubGlobal('fetch', request)
  await readSnapshot()
  expect(await readSnapshot()).toEqual({
    revision: 2,
  })
  await readSnapshot()
  expect(request.mock.calls[3][1]?.headers).not.toHaveProperty('If-None-Match')
})
it('expires idle snapshot bodies and bounds remembered credentials', async () => {
  vi.useFakeTimers()
  const request = vi.fn<typeof fetch>().mockImplementation(async () =>
    Response.json(
      {
        revision: 1,
      },
      {
        headers: {
          ETag: 'W/"snapshot-one"',
        },
      },
    ),
  )
  vi.stubGlobal('fetch', request)
  await readSnapshot()
  for (let index = 0; index < 8; index++)
    await readSnapshot({
      ...connection,
      token: `other-device-${index}`,
    })
  await readSnapshot()
  expect(request.mock.calls[9][1]?.headers).not.toHaveProperty('If-None-Match')
  await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1)
  await readSnapshot()
  expect(request.mock.calls[10][1]?.headers).not.toHaveProperty('If-None-Match')
})
it('never retries mutations on 304 or caches invalid schema responses', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(null, {
        status: 304,
      }),
    )
    .mockResolvedValueOnce(
      Response.json(
        {
          revision: 'invalid',
        },
        {
          headers: {
            ETag: 'W/"snapshot-bad"',
          },
        },
      ),
    )
    .mockResolvedValueOnce(
      Response.json(
        {
          revision: 1,
        },
        {
          headers: {
            ETag: 'W/"snapshot-one"',
          },
        },
      ),
    )
  vi.stubGlobal('fetch', request)
  await expect(
    runtimeRequest(connection, connection.address, '/api/workspace', {}, dataSchema, 'PATCH'),
  ).rejects.toThrow('unexpected unchanged response')
  expect(request).toHaveBeenCalledTimes(1)
  await expect(readSnapshot()).rejects.toThrow(ValidationError)
  await readSnapshot()
  expect(request.mock.calls[2][1]?.headers).not.toHaveProperty('If-None-Match')
})
it('clears remembered snapshots when device authentication is rejected', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json(
        {
          revision: 1,
        },
        {
          headers: {
            ETag: 'W/"snapshot-one"',
          },
        },
      ),
    )
    .mockResolvedValueOnce(
      Response.json(
        {
          error: 'Device revoked',
        },
        {
          status: 401,
        },
      ),
    )
    .mockResolvedValueOnce(
      Response.json(
        {
          revision: 2,
        },
        {
          headers: {
            ETag: 'W/"snapshot-two"',
          },
        },
      ),
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
      {
        address: 'http://my-computer:51464',
        token: 'private-device-token',
      },
      'http://my-computer:51464',
      '/api/snapshot',
      undefined,
      Schema.Unknown,
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
    Schema.Unknown,
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
      {
        code: '12345678',
      },
      mutableStruct({
        ok: Schema.Boolean,
      }),
    ),
  ).resolves.toEqual({
    ok: true,
  })
  expect(fetch.mock.calls[0]?.[1]?.headers).not.toHaveProperty('Authorization')
  fetch.mockResolvedValue(new Response('{"ok":true}'))
  await runtimeRequest(
    {
      address: 'http://localhost:8787',
      token: 'device-token',
    },
    'http://localhost:8787',
    '/api/snapshot',
    undefined,
    mutableStruct({
      ok: Schema.Boolean,
    }),
    'GET',
  )
  expect(fetch.mock.calls[1]?.[1]).toMatchObject({
    method: 'GET',
    headers: {
      Authorization: 'Bearer device-token',
    },
  })
  expect(fetch.mock.calls[1]?.[1]).not.toHaveProperty('body')
})
it('preserves runtime error messages and rejects invalid response schemas', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
    new Response('{"error":"Device revoked"}', {
      status: 401,
    }),
  )
  vi.stubGlobal('fetch', fetch)
  await expect(
    runtimeRequest(
      null,
      'http://localhost',
      '/api/snapshot',
      undefined,
      mutableStruct({
        ok: Schema.Boolean,
      }),
    ),
  ).rejects.toThrow('Device revoked')
  fetch.mockResolvedValue(new Response('{"ok":"invalid"}'))
  await expect(
    runtimeRequest(
      null,
      'http://localhost',
      '/api/snapshot',
      undefined,
      mutableStruct({
        ok: Schema.Boolean,
      }),
    ),
  ).rejects.toThrow(ValidationError)
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
      runtimeRequest(null, 'http://localhost', '/api/snapshot', undefined, Schema.Unknown),
    ).rejects.toThrow('took too long to respond'),
    vi.advanceTimersByTimeAsync(30000),
  ])
  expect(vi.getTimerCount()).toBe(0)
})

it('interrupts an in-flight request and aborts its transport', async () => {
  const { Effect, Fiber } = await import('effect')
  const { runtimeRequestEffect } = await import('./client.js')
  let signal: AbortSignal | undefined
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>((_url, options) => {
      signal = options?.signal ?? undefined
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })
    }),
  )
  const fiber = Effect.runFork(
    runtimeRequestEffect(
      connection,
      connection.address,
      '/api/snapshot',
      undefined,
      dataSchema,
      'GET',
    ),
  )
  await vi.waitFor(() => expect(signal).toBeDefined())
  await Effect.runPromise(Fiber.interrupt(fiber))
  expect(signal?.aborted).toBe(true)
})

it('bounds response body reads and aborts them on timeout', async () => {
  vi.useFakeTimers()
  let signal: AbortSignal | undefined
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (_url, options) => {
      signal = options?.signal ?? undefined
      return new Response(
        new ReadableStream({
          start(controller) {
            signal?.addEventListener('abort', () => controller.error(new Error('aborted')), {
              once: true,
            })
          },
        }),
      )
    }),
  )
  const pending = runtimeRequest(
    connection,
    connection.address,
    '/api/snapshot',
    undefined,
    dataSchema,
    'GET',
    100,
  ).catch((error: unknown) => error)
  await vi.advanceTimersByTimeAsync(101)
  expect(await pending).toMatchObject({ _tag: 'RuntimeRequestError', kind: 'timeout' })
  expect(signal?.aborted).toBe(true)
})

it('accepts cancellation from a native Promise caller', async () => {
  const controller = new AbortController()
  let signal: AbortSignal | undefined
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>((_url, options) => {
      signal = options?.signal ?? undefined
      return new Promise((_resolve, reject) =>
        signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }),
      )
    }),
  )
  const pending = runtimeRequest(
    connection,
    connection.address,
    '/api/snapshot',
    undefined,
    dataSchema,
    'GET',
    undefined,
    controller.signal,
  )
  const settled = pending.catch((error: unknown) => error)
  await vi.waitFor(() => expect(signal).toBeDefined())
  controller.abort()
  expect(await settled).toBeInstanceOf(Error)
  expect(signal?.aborted).toBe(true)
})

it('rejects cross-origin API paths before sending credentials while retaining HTTP', async () => {
  const fetcher = vi.fn<(url: unknown, init?: RequestInit) => Promise<Response>>(
    async (_url, _init) => new Response('{"ok":true}'),
  )
  vi.stubGlobal('fetch', fetcher)
  const schema = mutableStruct({ ok: Schema.Boolean })
  await expect(
    runtimeRequest(
      { address: 'http://vpn-host:51464', token: 'device-token' },
      'http://vpn-host:51464',
      'http://other-host/api/test',
      {},
      schema,
    ),
  ).rejects.toThrow('Invalid runtime address')
  expect(fetcher).not.toHaveBeenCalled()
  await expect(
    runtimeRequest(null, 'http://vpn-host:51464', '/api/pair/claim', { secret: 'private' }, schema),
  ).resolves.toEqual({ ok: true })
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error' })
})

it.each([307, 308])(
  'does not forward pairing secrets through an HTTP %s redirect',
  async (status) => {
    const { createServer } = await import('node:http')
    const { once } = await import('node:events')
    let forwarded = false
    const destination = createServer((_request, response) => {
      forwarded = true
      response.end('{"ok":true}')
    })
    destination.listen(0, '127.0.0.1')
    await once(destination, 'listening')
    const target = destination.address()
    if (!target || typeof target === 'string') throw new Error('Missing test port')
    const source = createServer((_request, response) => {
      response.writeHead(status, { Location: `http://127.0.0.1:${target.port}/collect` })
      response.end()
    })
    source.listen(0, '127.0.0.1')
    await once(source, 'listening')
    const origin = source.address()
    if (!origin || typeof origin === 'string') throw new Error('Missing test port')
    try {
      await expect(
        runtimeRequest(
          null,
          `http://127.0.0.1:${origin.port}`,
          '/api/pair/claim',
          { secret: 'synthetic-pairing-secret' },
          mutableStruct({ ok: Schema.Boolean }),
        ),
      ).rejects.toThrow(/fetch|reach|connect|request/i)
      expect(forwarded).toBe(false)
    } finally {
      source.closeAllConnections()
      destination.closeAllConnections()
      await Promise.all([
        new Promise<void>((resolve) => source.close(() => resolve())),
        new Promise<void>((resolve) => destination.close(() => resolve())),
      ])
    }
  },
)

it('retries a dropped snapshot read before reporting the host offline', async () => {
  const transport = vi
    .fn<typeof globalThis.fetch>()
    .mockRejectedValueOnce(new TypeError('The network connection was lost.'))
    .mockResolvedValueOnce(new Response('Bad gateway', { status: 502 }))
    .mockResolvedValue(Response.json({ revision: 3 }))
  vi.stubGlobal('fetch', transport)
  await expect(readSnapshot()).resolves.toEqual({ revision: 3 })
  expect(transport).toHaveBeenCalledTimes(3)
})

it('stops retrying a read after two transient failures', async () => {
  const transport = vi
    .fn<typeof globalThis.fetch>()
    .mockRejectedValue(new TypeError('Network request failed'))
  vi.stubGlobal('fetch', transport)
  await expect(readSnapshot()).rejects.toMatchObject({ kind: 'connection' })
  expect(transport).toHaveBeenCalledTimes(3)
})

it('never retries mutations or rejected reads', async () => {
  const transport = vi
    .fn<typeof globalThis.fetch>()
    .mockRejectedValue(new TypeError('Network request failed'))
  vi.stubGlobal('fetch', transport)
  await expect(
    runtimeRequest(connection, connection.address, '/api/tasks', {}, dataSchema),
  ).rejects.toMatchObject({ kind: 'connection' })
  expect(transport).toHaveBeenCalledTimes(1)
  transport.mockReset().mockResolvedValue(Response.json({ error: 'Revoked' }, { status: 401 }))
  await expect(readSnapshot()).rejects.toMatchObject({ status: 401, message: 'Revoked' })
  expect(transport).toHaveBeenCalledTimes(1)
})

it.each([
  '/api/scm/source/identity',
  '/api/agents/models/cached',
  '/api/scm/pulls/detail',
  '/api/scm/pulls/overview',
  '/api/scm/pulls/options/read',
  '/api/scm/inspect',
  '/api/scm/changes',
  '/api/scm/work/options',
  '/api/scm/work/issues/list',
  '/api/scm/work/issues/detail',
  '/api/scm/work/pipelines/list',
  '/api/scm/work/pipelines/detail',
  '/api/scm/work/pipelines/definitions',
])('retries the safe POST read %s after a transient gateway failure', async (path) => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response('Runtime reconnecting', { status: 503 }))
    .mockResolvedValue(Response.json({ revision: 2 }))
  vi.stubGlobal('fetch', transport)
  const input = { repositoryId: 'source', expectedReaderIdentity: 'verified-account' }
  await expect(
    runtimeRequest(connection, connection.address, path + '?refresh=true', input, dataSchema),
  ).resolves.toEqual({ revision: 2 })
  expect(transport).toHaveBeenCalledTimes(2)
  for (const [url, init] of transport.mock.calls) {
    expect(url instanceof Request ? url.url : url instanceof URL ? url.href : url).toBe(
      connection.address + path + '?refresh=true',
    )
    expect(init?.body).toBe(JSON.stringify(input))
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${connection.token}` })
  }
})

it.each([401, 403, 404, 409, 500])(
  'never retries a safe POST read rejected with %s',
  async (status) => {
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => Response.json({ error: 'Read rejected' }, { status }))
    vi.stubGlobal('fetch', transport)
    await expect(
      runtimeRequest(connection, connection.address, '/api/scm/source/identity', {}, dataSchema),
    ).rejects.toMatchObject({ status })
    expect(transport).toHaveBeenCalledOnce()
  },
)

it.each([
  '/api/scm/pulls/action',
  '/api/scm/pulls/comment',
  '/api/scm/pulls/create',
  '/api/scm/pulls/task',
  '/api/scm/work/issues/create',
  '/api/scm/work/issues/action',
  '/api/scm/work/pipelines/action',
  '/api/scm/work/task',
  '/api/scm/instructions/save',
  '/api/sync/ticket',
  '/api/scm/future/read',
])('dispatches %s once on an uncertain failure or 503', async (path) => {
  const transport = vi.fn<typeof fetch>().mockRejectedValue(new Error('Response lost'))
  vi.stubGlobal('fetch', transport)
  await expect(
    runtimeRequest(connection, connection.address, path, {}, dataSchema),
  ).rejects.toMatchObject({ kind: 'connection' })
  expect(transport).toHaveBeenCalledOnce()
  transport.mockReset().mockImplementation(async () => new Response('Unavailable', { status: 503 }))
  await expect(
    runtimeRequest(connection, connection.address, path, {}, dataSchema),
  ).rejects.toMatchObject({ status: 503 })
  expect(transport).toHaveBeenCalledOnce()
})

it('bounds safe POST reads to two retries and one overall deadline', async () => {
  vi.useFakeTimers()
  const transport = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => new Response('Unavailable', { status: 503 }))
  vi.stubGlobal('fetch', transport)
  const failed = runtimeRequest(
    connection,
    connection.address,
    '/api/scm/pulls/detail',
    {},
    dataSchema,
  ).catch((error: unknown) => error)
  await vi.advanceTimersByTimeAsync(1000)
  expect(await failed).toMatchObject({ status: 503 })
  expect(transport).toHaveBeenCalledTimes(3)
  transport.mockClear()
  const timed = runtimeRequest(
    connection,
    connection.address,
    '/api/scm/source/identity',
    {},
    dataSchema,
    'POST',
    50,
  ).catch((error: unknown) => error)
  await vi.advanceTimersByTimeAsync(50)
  expect(await timed).toMatchObject({ kind: 'timeout' })
  expect(transport).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(1000)
  expect(transport).toHaveBeenCalledOnce()
})

it('does not classify a non-POST mutation as a safe read by its path', async () => {
  const transport = vi.fn<typeof fetch>().mockRejectedValue(new Error('Response lost'))
  vi.stubGlobal('fetch', transport)
  await expect(
    runtimeRequest(
      connection,
      connection.address,
      '/api/scm/pulls/detail',
      {},
      dataSchema,
      'PATCH',
    ),
  ).rejects.toMatchObject({ kind: 'connection' })
  expect(transport).toHaveBeenCalledOnce()
})

it('reports the status of a plain-text gateway failure', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response('Unavailable', { status: 500 })),
  )
  await expect(readSnapshot()).rejects.toMatchObject({
    status: 500,
    message: 'Runtime request failed (500)',
  })
})

it('retries a dropped chat message because the runtime deduplicates its message ID', async () => {
  const transport = vi
    .fn<typeof globalThis.fetch>()
    .mockRejectedValueOnce(new TypeError('The network connection was lost.'))
    .mockResolvedValue(Response.json({ ok: true }))
  vi.stubGlobal('fetch', transport)
  const input = { id: 'task', messageId: 'message-1', text: 'Hello', attachmentIds: [] }
  await expect(
    runtimeRequest(connection, connection.address, '/api/tasks/message', input, Schema.Unknown),
  ).resolves.toEqual({ ok: true })
  expect(transport).toHaveBeenCalledTimes(2)
  for (const [, init] of transport.mock.calls) expect(init?.body).toBe(JSON.stringify(input))
})

it('preserves same-origin paths containing a double slash when selecting a transport route', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true }))
  vi.stubGlobal('fetch', fetcher)
  const connection = { address: 'http://path-origin.local', token: 'path-origin-paired-token' }
  await runtimeRequest(
    connection,
    connection.address,
    '/.//other-host/api/test',
    {},
    Schema.Struct({ ok: Schema.Boolean }),
  )
  const target = fetcher.mock.calls[0]![0]
  expect(target).toBeInstanceOf(URL)
  expect(target instanceof URL && target.origin).toBe(connection.address)
  expect(target instanceof URL && target.pathname).toBe('//other-host/api/test')
})

it('keeps a verified route warm when a caller cancels a request', async () => {
  const connection = {
    address: 'http://cancel-keeps-route.local',
    token: 'cancel-token',
    runtimeId: 'cancel-runtime',
  }
  const fetcher = vi.fn<typeof fetch>((input, options) => {
    const url = new URL(input instanceof Request ? input.url : input)
    if (url.pathname === '/health')
      return Promise.resolve(
        Response.json({ service: 'dovo-runtime', runtimeId: connection.runtimeId }),
      )
    return new Promise<Response>((_resolve, reject) =>
      options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
        once: true,
      }),
    )
  })
  vi.stubGlobal('fetch', fetcher)
  await resolveRuntimeEndpoint(connection, new AbortController().signal)
  const controller = new AbortController()
  const pending = runtimeRequest(
    connection,
    connection.address,
    '/api/snapshot',
    undefined,
    dataSchema,
    'GET',
    undefined,
    controller.signal,
  ).catch((error: unknown) => error)
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
  controller.abort()
  await pending
  await resolveRuntimeEndpoint(connection, new AbortController().signal)
  expect(fetcher).toHaveBeenCalledTimes(2)
})

it.each([
  { method: 'GET', outcome: { revision: 2 }, requests: 2 },
  { method: 'POST', outcome: { kind: 'connection' }, requests: 1 },
])(
  'invalidates a route after a dropped $method response body without replaying mutations',
  async ({ method, outcome, requests }) => {
    const connection = {
      address: `http://body-failure-${method.toLowerCase()}.local`,
      token: 'body-failure-token',
      runtimeId: 'body-failure-runtime',
      alternateAddresses: ['http://body-recovery.local'],
    }
    let failed = false
    const payloads: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input) => {
        const url = new URL(input instanceof Request ? input.url : input)
        if (url.pathname === '/health') {
          if (url.origin === connection.address && failed) throw new Error('Host disappeared')
          return Response.json({ service: 'dovo-runtime', runtimeId: connection.runtimeId })
        }
        payloads.push(url.origin)
        if (url.origin === connection.address) {
          failed = true
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new Error('Body connection lost'))
              },
            }),
          )
        }
        return Response.json({ revision: 2 })
      }),
    )
    const pending = runtimeRequest(
      connection,
      connection.address,
      '/api/test',
      undefined,
      dataSchema,
      method,
    )
    expect(await pending.catch((error: unknown) => error)).toMatchObject(outcome)
    expect(payloads).toEqual([connection.address, 'http://body-recovery.local'].slice(0, requests))
    expect(await resolveRuntimeEndpoint(connection, new AbortController().signal)).toMatchObject({
      address: 'http://body-recovery.local',
    })
  },
)

it('does not evict a recovered route when an earlier request fails late', async () => {
  const connection = {
    address: 'http://late-failure.local',
    token: 'late-token',
    runtimeId: 'late-runtime',
    alternateAddresses: ['http://late-recovery.local'],
  }
  let primary = true
  let fail: (error: Error) => void = () => {}
  const health: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input instanceof Request ? input.url : input)
      if (url.pathname === '/health') {
        health.push(url.origin)
        return Response.json({
          service: 'dovo-runtime',
          runtimeId:
            primary || url.origin !== connection.address ? connection.runtimeId : 'wrong-runtime',
        })
      }
      return new Promise<Response>((_resolve, reject) => {
        fail = reject
      })
    }),
  )
  const pending = runtimeRequest(
    connection,
    connection.address,
    '/api/tasks/run',
    {},
    dataSchema,
  ).catch((error: unknown) => error)
  await vi.waitFor(() => expect(health).toHaveLength(2))
  // Ensure the mutation has reached its transport before replacing its selected route.
  await vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3))
  primary = false
  const { invalidateRuntimeRoute } = await import('../runtime/connection/routes.js')
  invalidateRuntimeRoute(connection)
  expect(await resolveRuntimeEndpoint(connection, new AbortController().signal)).toMatchObject({
    address: 'http://late-recovery.local',
  })
  const probes = health.length
  fail(new Error('Old connection lost'))
  await expect(pending).resolves.toMatchObject({ kind: 'connection' })
  expect(await resolveRuntimeEndpoint(connection, new AbortController().signal)).toMatchObject({
    address: 'http://late-recovery.local',
  })
  expect(health).toHaveLength(probes)
})
