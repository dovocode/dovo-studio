import { afterEach, expect, it, vi } from 'vite-plus/test'
import { Effect, Schema } from 'effect'
import { RuntimeMutations, type MutationOutbox, type MutationStorage } from './mutations.js'
const connection = { address: 'http://netbird-host:4310', token: 'test-device' }
const urlPath = (url: Parameters<typeof fetch>[0]) =>
  typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
const ok = Schema.Struct({ ok: Schema.Boolean })
const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(Effect.either(effect))
afterEach(() => vi.unstubAllGlobals())
function fixture(initial: MutationOutbox = [], changed: () => void = () => {}) {
  let stored: MutationOutbox = structuredClone(initial)
  let count = 0
  const storage = {
    id: () => `operation-${++count}`,
    read: async () => structuredClone(stored),
    clear: async () => {
      stored = []
    },
    update: async (
      _connection: typeof connection,
      change: (pending: MutationOutbox) => MutationOutbox,
    ) => {
      stored = structuredClone(change(structuredClone(stored)))
      return stored
    },
  }
  return {
    queue: new RuntimeMutations(storage, changed),
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
    update: async () => {
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

it.each([400, 409])(
  'removes a directly rejected legacy command (%s) and allows the next action',
  async (status) => {
    const f = fixture()
    let reject = true
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
        if (urlPath(url).endsWith('/api/mutations/status'))
          return Response.json({ error: 'Not found' }, { status: 404 })
        expect(new Headers(init?.headers).has('X-Dovo-Mutation-Id')).toBe(false)
        expect(f.stored()).toHaveLength(1)
        return reject
          ? Response.json({ error: 'Action rejected' }, { status })
          : Response.json({ ok: true })
      }),
    )
    expect(
      await run(f.queue.requestEffect(connection, '/api/tasks/lifecycle', { id: 'rejected' }, ok)),
    ).toMatchObject({ _tag: 'Left', left: { message: 'Action rejected' } })
    expect(f.stored()).toEqual([])
    reject = false
    expect(
      await run(f.queue.requestEffect(connection, '/api/tasks/lifecycle', { id: 'next' }, ok)),
    ).toMatchObject({ _tag: 'Right', right: { ok: true } })
    expect(f.stored()).toEqual([])
  },
)

it('removes only the rejected legacy command when another client appends during its send', async () => {
  const f = fixture()
  const other = {
    id: 'other-client',
    path: '/api/tasks/lifecycle',
    method: 'POST' as const,
    input: { id: 'other-task' },
  }
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (urlPath(url).endsWith('/api/mutations/status'))
        return Response.json({ error: 'Not found' }, { status: 404 })
      await f.storage.update(connection, (pending) => [...pending, other])
      return Response.json({ error: 'Conflict' }, { status: 409 })
    }),
  )
  expect(
    (await run(f.queue.requestEffect(connection, '/api/tasks/lifecycle', { id: 'rejected' }, ok)))
      ._tag,
  ).toBe('Left')
  expect(f.stored()).toEqual([other])
})

it.each(['connection', 'gateway', 'invalid JSON', 'invalid schema', 'unreadable body'] as const)(
  'keeps an uncertain legacy command after %s, including after support was cached',
  async (failure) => {
    const f = fixture()
    let sends = 0
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (url) => {
      if (urlPath(url).endsWith('/api/mutations/status'))
        return Response.json({ error: 'Not found' }, { status: 404 })
      sends++
      if (sends === 1) return Response.json({ ok: true })
      expect(f.stored()).toHaveLength(1)
      switch (failure) {
        case 'connection':
          throw new Error('Connection lost after commit')
        case 'gateway':
          return Response.json({ error: 'Unavailable' }, { status: 503 })
        case 'invalid JSON':
          return new Response('Not JSON')
        case 'invalid schema':
          return Response.json({ unexpected: true })
        case 'unreadable body': {
          const response = Response.json({ ok: true })
          vi.spyOn(response, 'text').mockRejectedValue(new Error('Response lost'))
          return response
        }
      }
    })
    vi.stubGlobal('fetch', fetch)
    expect(
      (await run(f.queue.requestEffect(connection, '/api/tasks/lifecycle', { id: 'first' }, ok)))
        ._tag,
    ).toBe('Right')
    expect(
      (
        await run(
          f.queue.requestEffect(connection, '/api/tasks/lifecycle', { id: 'uncertain' }, ok),
        )
      )._tag,
    ).toBe('Left')
    expect(f.stored()).toHaveLength(1)
    expect(f.stored()[0]?.input).toEqual({ id: 'uncertain' })
    fetch.mockClear()
    expect(await run(f.queue.recoverEffect(connection))).toMatchObject({
      _tag: 'Left',
      left: { message: 'Update this runtime before recovering saved actions.' },
    })
    expect(fetch).not.toHaveBeenCalled()
    expect(await run(f.queue.recoverEffect(connection, true))).toMatchObject({
      _tag: 'Left',
      left: { message: 'Update this runtime before recovering saved actions.' },
    })
    expect(fetch).toHaveBeenCalledOnce()
    expect(f.stored()).toHaveLength(1)
    expect(sends).toBe(2)
  },
)

it('rechecks legacy receipt support on explicit recovery after a runtime upgrade', async () => {
  const f = fixture()
  let upgraded = false
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      if (urlPath(url).endsWith('/api/mutations/status'))
        return upgraded
          ? Response.json({ version: 1 })
          : Response.json({ error: 'Not found' }, { status: 404 })
      if (!upgraded) throw new Error('Connection lost after commit')
      expect(new Headers(init?.headers).get('X-Dovo-Mutation-Id')).toBe('operation-1')
      return Response.json({ ok: true })
    }),
  )
  expect(
    (await run(f.queue.requestEffect(connection, '/api/tasks/lifecycle', { id: 'task' }, ok)))._tag,
  ).toBe('Left')
  expect(f.stored()).toHaveLength(1)
  upgraded = true
  expect((await run(f.queue.recoverEffect(connection, true)))._tag).toBe('Right')
  expect(f.stored()).toEqual([])
})

it('retains independent offline writers and removes acknowledgements by identity', async () => {
  const f = fixture(),
    second = f.restart()
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new Error('Offline')))
  await Promise.all(
    [f.queue, second].map((queue, index) =>
      run(queue.requestEffect(connection, '/api/tasks/message', { messageId: String(index) }, ok)),
    ),
  )
  expect(f.stored()).toHaveLength(2)
  const original = f.stored().map((item) => item.id)
  const delivered: string[] = []
  let added = false
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      if (urlPath(url).endsWith('/api/mutations/status')) return Response.json({ version: 1 })
      delivered.push(new Headers(init?.headers).get('X-Dovo-Mutation-Id')!)
      if (!added) {
        added = true
        await f.storage.update(connection, (pending) => [
          ...pending,
          {
            id: 'another-tab',
            path: '/api/tasks/message',
            method: 'POST',
            input: { messageId: 'later' },
          },
        ])
      }
      return Response.json({ ok: true })
    }),
  )
  expect((await run(f.restart().recoverEffect(connection)))._tag).toBe('Right')
  expect(delivered).toEqual([...original, 'another-tab'])
  expect(f.stored()).toEqual([])
})

it('concurrent recovery reuses receipt identities and preserves the ordered journal', async () => {
  const f = fixture([
    { id: 'first', path: '/api/tasks/message', method: 'POST', input: { messageId: 'a' } },
    { id: 'second', path: '/api/tasks/message', method: 'POST', input: { messageId: 'b' } },
  ])
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let firstRequests = 0
  const applied = new Set<string>()
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      if (urlPath(url).endsWith('/api/mutations/status')) return Response.json({ version: 1 })
      const id = new Headers(init?.headers).get('X-Dovo-Mutation-Id')!
      if (id === 'first') {
        firstRequests++
        if (firstRequests === 2) release()
        await gate
      }
      applied.add(id)
      return Response.json({ ok: true })
    }),
  )
  const results = await Promise.all(
    [f.queue, f.restart()].map((queue) => run(queue.recoverEffect(connection))),
  )
  expect(results.map((result) => result._tag)).toEqual(['Right', 'Right'])
  expect(firstRequests).toBe(2)
  expect([...applied]).toEqual(['first', 'second'])
  expect(f.stored()).toEqual([])
})

it('preserves malformed saved actions and fails before sending or overwriting them', async () => {
  const update = vi
    .fn<MutationStorage['update']>()
    .mockRejectedValue(new Error('Must not overwrite'))
  let saved: unknown = [{ id: 'old', method: 'DELETE' }]
  const queue = new RuntimeMutations({
    id: () => 'new',
    read: async () => saved,
    update,
    clear: async () => {
      saved = []
    },
  })
  const fetch = vi.fn<typeof globalThis.fetch>()
  vi.stubGlobal('fetch', fetch)
  expect(
    (await run(queue.requestEffect(connection, '/api/tasks/message', { messageId: 'new' }, ok)))
      ._tag,
  ).toBe('Left')
  expect(fetch).not.toHaveBeenCalled()
  expect(update).not.toHaveBeenCalled()
  expect((await run(queue.discardEffect(connection)))._tag).toBe('Right')
  expect(saved).toEqual([])
  expect((await run(queue.assertEmptyEffect(connection)))._tag).toBe('Right')
})

it('refuses to forget unloaded saved actions and refuses unsent commands behind blocked actions', async () => {
  const old = {
    id: 'old',
    path: '/api/tasks/message',
    method: 'POST' as const,
    input: { messageId: 'old' },
    blocked: true,
  }
  const f = fixture([old])
  expect((await run(f.queue.assertEmptyEffect(connection)))._tag).toBe('Left')
  const fetch = vi.fn<typeof globalThis.fetch>()
  vi.stubGlobal('fetch', fetch)
  expect(
    (await run(f.queue.requestEffect(connection, '/api/tasks/message', { messageId: 'new' }, ok)))
      ._tag,
  ).toBe('Left')
  expect(f.stored()).toEqual([old])
  expect(fetch).not.toHaveBeenCalled()
  await run(f.queue.discardEffect(connection))
  expect((await run(f.restart().assertEmptyEffect(connection)))._tag).toBe('Right')
})

it('removes a newly refused unsent command when recovery of an earlier action fails', async () => {
  const old = {
    id: 'old',
    path: '/api/tasks/message',
    method: 'POST' as const,
    input: { messageId: 'old' },
  }
  const f = fixture([old])
  vi.stubGlobal(
    'fetch',
    vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async (url) =>
        urlPath(url).endsWith('/api/mutations/status')
          ? Response.json({ version: 1 })
          : Response.json({ error: 'Conflict' }, { status: 409 }),
      ),
  )
  expect(
    (await run(f.queue.requestEffect(connection, '/api/tasks/message', { messageId: 'new' }, ok)))
      ._tag,
  ).toBe('Left')
  expect(f.stored()).toEqual([{ ...old, blocked: true }])
})

it('clears a stale local error when another client has drained the journal', async () => {
  const f = fixture()
  vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error('Offline')))
  await run(f.queue.requestEffect(connection, '/api/tasks/message', { messageId: 'old' }, ok))
  expect(f.queue.status(connection).error).not.toBeNull()
  await run(f.restart().discardEffect(connection))
  await run(f.queue.recoverEffect(connection))
  expect(f.queue.status(connection)).toEqual({ pending: 0, error: null })
})

it('reads durable state on each empty recovery without notifying unchanged status', async () => {
  const changed = vi.fn<() => void>()
  const f = fixture([], changed)
  const read = vi.spyOn(f.storage, 'read')
  await run(f.queue.recoverEffect(connection))
  await run(f.queue.recoverEffect(connection))
  expect(read).toHaveBeenCalledTimes(2)
  expect(changed).not.toHaveBeenCalled()
  expect(f.queue.status(connection)).toEqual({ pending: 0, error: null })
})

it('notifies changes from other writers while ignoring equivalent freshly decoded journals', async () => {
  const changed = vi.fn<() => void>()
  const f = fixture(
    [{ id: 'saved', path: '/api/tasks/message', method: 'POST', input: { text: 'old' } }],
    changed,
  )
  expect((await run(f.queue.assertEmptyEffect(connection)))._tag).toBe('Left')
  expect(changed).toHaveBeenCalledOnce()
  changed.mockClear()
  expect((await run(f.queue.assertEmptyEffect(connection)))._tag).toBe('Left')
  expect(changed).not.toHaveBeenCalled()
  await f.storage.update(connection, (pending) =>
    pending.map((entry) => ({ ...entry, input: { text: 'changed elsewhere' }, blocked: true })),
  )
  expect((await run(f.queue.assertEmptyEffect(connection)))._tag).toBe('Left')
  expect(changed).toHaveBeenCalledOnce()
  changed.mockClear()
  await f.storage.clear()
  expect((await run(f.queue.recoverEffect(connection)))._tag).toBe('Right')
  expect(changed).toHaveBeenCalledOnce()
  changed.mockClear()
  expect((await run(f.queue.recoverEffect(connection)))._tag).toBe('Right')
  expect(changed).not.toHaveBeenCalled()
})

it('notifies clearing a stale error once when the durable journal is already empty', async () => {
  const changed = vi.fn<() => void>()
  const f = fixture([], changed)
  vi.stubGlobal(
    'fetch',
    vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        urlPath(url).endsWith('/api/mutations/status')
          ? Response.json({ error: 'Not found' }, { status: 404 })
          : Response.json({ error: 'Conflict' }, { status: 409 }),
      ),
  )
  await run(f.queue.requestEffect(connection, '/api/tasks/lifecycle', { id: 'task' }, ok))
  expect(f.queue.status(connection)).toEqual({ pending: 0, error: 'Conflict' })
  changed.mockClear()
  await run(f.queue.recoverEffect(connection))
  expect(changed).toHaveBeenCalledOnce()
  expect(f.queue.status(connection)).toEqual({ pending: 0, error: null })
  changed.mockClear()
  await run(f.queue.recoverEffect(connection))
  expect(changed).not.toHaveBeenCalled()
})
