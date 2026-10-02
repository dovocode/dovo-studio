import { afterEach, expect, it, vi } from 'vite-plus/test'
import { Effect, Schema } from 'effect'
import { RuntimeMutations, type MutationOutbox } from './mutations.js'
const connection = { address: 'http://netbird-host:4310', token: 'test-device' }
const urlPath = (url: Parameters<typeof fetch>[0]) =>
  typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
const ok = Schema.Struct({ ok: Schema.Boolean })
const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(Effect.either(effect))
afterEach(() => vi.unstubAllGlobals())
function fixture(initial: MutationOutbox = []) {
  let stored: MutationOutbox = structuredClone(initial)
  let count = 0
  const storage = {
    id: () => `operation-${++count}`,
    read: async () => stored,
    write: async (_connection: typeof connection, value: MutationOutbox) => {
      stored = structuredClone(value)
    },
  }
  return {
    queue: new RuntimeMutations(storage),
    restart: () => new RuntimeMutations(storage),
    stored: () => stored,
    storage,
  }
}
it('persists before sending and recovers a lost response with the same action ID after restart', async () => {
  const f = fixture(),
    ids: string[] = []
  let reachable = false
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      if (urlPath(url).endsWith('/api/mutations/status')) return Response.json({ version: 1 })
      expect(f.stored()).toHaveLength(1)
      ids.push(new Headers(init?.headers).get('X-Dovo-Mutation-Id')!)
      if (!reachable) throw new Error('Connection lost after commit')
      return Response.json({ ok: true })
    }),
  )
  const failed = await run(
    f.queue.requestEffect(
      connection,
      '/api/tasks/lifecycle',
      { id: 'task', action: 'archive' },
      ok,
    ),
  )
  expect(failed._tag).toBe('Left')
  expect(f.stored()).toHaveLength(1)
  reachable = true
  expect((await run(f.restart().recoverEffect(connection)))._tag).toBe('Right')
  expect(new Set(ids)).toEqual(new Set(['operation-1']))
  expect(f.stored()).toEqual([])
})
it('accepts a saved send locally so composer text can be cleared, then delivers on reconnect', async () => {
  const f = fixture()
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new Error('Offline')))
  const result = await run(
    f.queue.requestEffect(
      connection,
      '/api/tasks/message',
      { id: 'task', messageId: 'message', text: 'Go' },
      ok,
    ),
  )
  expect(result._tag).toBe('Right')
  expect(result).toMatchObject({ _tag: 'Right', right: { ok: true } })
  expect(f.stored()[0]?.input).toEqual({ id: 'task', messageId: 'message', text: 'Go' })
  vi.stubGlobal(
    'fetch',
    vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        Response.json(
          urlPath(url).endsWith('/api/mutations/status') ? { version: 1 } : { ok: true },
        ),
      ),
  )
  await run(f.restart().recoverEffect(connection))
  expect(f.stored()).toEqual([])
})
it('holds conflicts for explicit review, isolates host credentials, and never sends before a failed durable write', async () => {
  const f = fixture()
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async (url) =>
      Response.json(
        urlPath(url).endsWith('/api/mutations/status')
          ? { version: 1 }
          : { error: 'Another device changed this task' },
        { status: urlPath(url).endsWith('/api/mutations/status') ? 200 : 409 },
      ),
    )
  vi.stubGlobal('fetch', fetch)
  await run(
    f.queue.requestEffect(
      connection,
      '/api/workspace',
      { collection: 'tasks', id: 'task', changes: {} },
      ok,
      'PATCH',
    ),
  )
  expect(f.stored()[0]?.blocked).toBe(true)
  fetch.mockClear()
  await run(f.queue.recoverEffect(connection))
  expect(fetch).not.toHaveBeenCalled()
  expect(f.queue.status({ ...connection, token: 'another-device' }).pending).toBe(0)
  await run(f.queue.discardEffect(connection))
  expect(f.stored()).toEqual([])
  const failing = new RuntimeMutations({
    ...f.storage,
    write: async () => {
      throw new Error('Disk full')
    },
  })
  const result = await run(
    failing.requestEffect(connection, '/api/tasks/lifecycle', { id: 'task', action: 'delete' }, ok),
  )
  expect(result._tag).toBe('Left')
  expect(fetch).not.toHaveBeenCalled()
})
it('keeps multiple offline sends ordered and retains each identity through recovery', async () => {
  const f = fixture()
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new Error('Offline')))
  for (const messageId of ['first', 'second']) {
    expect(
      await run(f.queue.requestEffect(connection, '/api/tasks/message', { messageId }, ok)),
    ).toMatchObject({ _tag: 'Right', right: { ok: true } })
  }
  expect(f.stored().map((entry) => entry.id)).toEqual(['operation-1', 'operation-2'])
  const delivered: unknown[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      if (urlPath(url).endsWith('/api/mutations/status')) return Response.json({ version: 1 })
      if (typeof init?.body !== 'string') throw new Error('Expected JSON request body')
      delivered.push(JSON.parse(init.body))
      return Response.json({ ok: true })
    }),
  )
  expect((await run(f.restart().recoverEffect(connection)))._tag).toBe('Right')
  expect(delivered).toEqual([{ messageId: 'first' }, { messageId: 'second' }])
  expect(f.stored()).toEqual([])
})
it('executes new actions on legacy hosts but refuses to blindly replay a saved action', async () => {
  const f = fixture()
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (url, init) => {
    if (urlPath(url).endsWith('/api/mutations/status'))
      return Response.json({ error: 'Not found' }, { status: 404 })
    expect(new Headers(init?.headers).has('X-Dovo-Mutation-Id')).toBe(false)
    return Response.json({ ok: true })
  })
  vi.stubGlobal('fetch', fetch)
  expect(
    await run(f.queue.requestEffect(connection, '/api/tasks/lifecycle', { id: 'task' }, ok)),
  ).toMatchObject({ _tag: 'Right', right: { ok: true } })
  expect(f.stored()).toEqual([])
  const saved = fixture([
    { id: 'prior', path: '/api/tasks/lifecycle', method: 'POST', input: { id: 'task' } },
  ])
  fetch.mockClear()
  expect((await run(saved.queue.recoverEffect(connection)))._tag).toBe('Left')
  expect(fetch).toHaveBeenCalledOnce()
  expect(saved.stored()).toHaveLength(1)
})
