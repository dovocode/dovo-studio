import { decode } from '../../shared/schema.js'
import { taskSchema } from '../../workspace.js'
import { responses, workspaceRecoveriesSchema, workspacePatchResultSchema } from './runtime.js'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { Effect, Schema } from 'effect'
import { RuntimeMutations, type MutationOutbox, type MutationStorage } from './mutations.js'
const connection = { address: 'http://netbird-host:4310', token: 'test-device' }
const urlPath = (url: Parameters<typeof fetch>[0]) =>
  typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
const ok = Schema.Struct({ ok: Schema.Boolean })
const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(Effect.result(effect))
afterEach(() => vi.unstubAllGlobals())
function fixture(initial: MutationOutbox = [], changed: () => void = () => {}) {
  let stored: MutationOutbox = structuredClone(initial)
  let count = 0
  const recovered: import('./runtime.js').WorkspaceRecovery[] = []
  const storage = {
    recoverWorkspaceEdit: async (
      _connection: typeof connection,
      edit: import('./runtime.js').WorkspaceRecovery,
    ) => {
      if (!recovered.some((item) => item.id === edit.id)) recovered.push(edit)
    },
    workspaceRecoveries: async () => recovered,
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
    recovered: () => recovered,
  }
}
it('keeps uncertain attachment payloads through reconnect and ordinary journal discard', async () => {
  const f = fixture()
  const upload = {
    id: '3e222e4e-63dc-40d0-b0cb-6d1bc3b9ead4',
    taskId: 'task',
    queuedMessageId: 'queued-message',
    name: 'file.txt',
    data: 'aGVsbG8=',
  }
  const requests: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (url) => {
      const path = urlPath(url)
      requests.push(path)
      return Response.json(
        path.endsWith('/status')
          ? { version: 1 }
          : path.endsWith('/upload-handled')
            ? { handled: true }
            : { ok: true },
      )
    }),
  )
  expect((await run(f.queue.stageAttachmentEffect(connection, upload, false)))._tag).toBe('Success')
  expect((await run(f.queue.stageAttachmentEffect(connection, upload, false)))._tag).toBe('Success')
  expect(f.stored()).toEqual([
    expect.objectContaining({
      id: upload.id,
      input: upload,
      path: '/api/attachments/recoverable-upload',
    }),
  ])
  const reopened = f.restart()
  expect((await run(reopened.recoverEffect(connection)))._tag).toBe('Success')
  expect(requests.some((path) => path.includes('/api/attachments/'))).toBe(false)
  expect(reopened.attachmentUploads(connection)).toHaveLength(1)
  expect(reopened.status(connection).error).toBe('Saved attachments need review.')
  expect((await run(reopened.discardEffect(connection)))._tag).toBe('Success')
  expect(f.stored()[0]?.input).toEqual(upload)
  expect((await run(reopened.finishAttachmentEffect(connection, upload.id)))._tag).toBe('Success')
  expect(f.stored()).toEqual([])
})
it('checks the durable attachment journal after restart and propagates read failures', async () => {
  const f = fixture()
  const upload = {
    id: '3e222e4e-63dc-40d0-b0cb-6d1bc3b9ead4',
    taskId: 'task',
    name: 'file.txt',
    data: 'aGVsbG8=',
    detached: true,
  }
  expect(await run(f.queue.attachmentPendingEffect(connection, upload.id))).toMatchObject({
    _tag: 'Success',
    success: false,
  })
  await run(f.queue.stageAttachmentEffect(connection, upload, false))
  expect(await run(f.restart().attachmentPendingEffect(connection, upload.id))).toMatchObject({
    _tag: 'Success',
    success: true,
  })
  vi.spyOn(f.storage, 'read').mockRejectedValueOnce(new Error('storage unavailable'))
  expect((await run(f.queue.attachmentPendingEffect(connection, upload.id)))._tag).toBe('Failure')
})
it('journals uploads before dispatch and reads a committed receipt instead of replaying on review', async () => {
  const f = fixture()
  const upload = {
    id: '3e222e4e-63dc-40d0-b0cb-6d1bc3b9ead4',
    taskId: 'task',
    name: 'file.txt',
    data: 'aGVsbG8=',
  }
  const receipt = {
    attachment: { id: upload.id, name: upload.name, mime: 'text/plain', size: 5 },
    revision: 3,
  }
  let sends = 0
  let payloadAtDispatch: unknown
  let errorAtDispatch: string | null | undefined
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (url) => {
      const path = urlPath(url)
      if (path.endsWith('/status')) return Response.json({ version: 1, attachmentUploads: 2 })
      if (path.endsWith('/upload-receipt')) return Response.json({ receipt, available: true })
      if (path.endsWith('/recoverable-upload')) {
        sends++
        payloadAtDispatch = f.stored()[0]?.input
        errorAtDispatch = f.queue.status(connection).error
        throw new TypeError('lost response')
      }
      throw new Error(`Unexpected request: ${path}`)
    }),
  )
  expect((await run(f.queue.requestAttachmentEffect(connection, upload, false)))._tag).toBe(
    'Failure',
  )
  const reopened = f.restart()
  const result = await run(reopened.retryAttachmentAfterReviewEffect(connection, upload.id))
  expect(result).toMatchObject({ _tag: 'Success', success: receipt })
  expect(payloadAtDispatch).toEqual(upload)
  expect(errorAtDispatch).toBeNull()
  expect(f.queue.status(connection).error).toBe('Saved attachments need review.')
  expect(sends).toBe(1)
  expect(f.stored()[0]?.input).toEqual(upload)
})
it('does not show review for an upload while it is still in flight', async () => {
  const f = fixture()
  const upload = {
    id: '3e222e4e-63dc-40d0-b0cb-6d1bc3b9ead4',
    taskId: 'task',
    name: 'file.txt',
    data: 'aGVsbG8=',
    detached: true,
  }
  let release: (() => void) | undefined
  let dispatched: (() => void) | undefined
  const started = new Promise<void>((resolve) => {
    dispatched = resolve
  })
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (url) => {
      if (urlPath(url).endsWith('/status'))
        return Response.json({ version: 1, attachmentUploads: 2 })
      dispatched?.()
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return Response.json({
        attachment: { id: upload.id, name: upload.name, mime: 'text/plain', size: 5 },
        revision: 1,
      })
    }),
  )
  const pending = run(f.queue.requestAttachmentEffect(connection, upload, false))
  await started
  expect((await run(f.queue.recoverEffect(connection)))._tag).toBe('Success')
  expect(f.queue.status(connection).error).toBeNull()
  expect(f.queue.status(connection).pending).toBe(0)
  expect(f.queue.attachmentUploads(connection)).toEqual([])
  release?.()
  expect((await pending)._tag).toBe('Success')
})
it('does not acknowledge when local journal removal fails', async () => {
  const f = fixture()
  const upload = {
    id: '3e222e4e-63dc-40d0-b0cb-6d1bc3b9ead4',
    taskId: 'task',
    name: 'file.txt',
    data: 'aGVsbG8=',
  }
  const requests: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (url) => {
      const path = urlPath(url)
      requests.push(path)
      return Response.json(path.endsWith('/upload-handled') ? { handled: true } : { ok: true })
    }),
  )
  await run(f.queue.stageAttachmentEffect(connection, upload, false))
  const update = f.storage.update
  f.storage.update = async () => {
    throw new Error('Storage failed')
  }
  expect((await run(f.queue.finishAttachmentEffect(connection, upload.id)))._tag).toBe('Failure')
  expect(f.stored()[0]?.input).toEqual(upload)
  expect(requests.some((path) => path.endsWith('/acknowledge-upload'))).toBe(false)
  f.storage.update = update
  expect((await run(f.queue.finishAttachmentEffect(connection, upload.id)))._tag).toBe('Success')
  expect(f.stored()).toEqual([])
})
it('preserves acknowledgement payload and retries it after restart', async () => {
  const f = fixture()
  const upload = {
    id: '3e222e4e-63dc-40d0-b0cb-6d1bc3b9ead4',
    taskId: 'task',
    name: 'file.txt',
    data: 'aGVsbG8=',
  }
  let online = false
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (url) => {
      const path = urlPath(url)
      if (path.endsWith('/status')) return Response.json({ version: 1 })
      if (path.endsWith('/upload-handled')) return Response.json({ handled: true })
      if (path.endsWith('/acknowledge-upload')) {
        if (!online) throw new TypeError('lost acknowledgement response')
        return Response.json({ ok: true })
      }
      throw new Error(`Unexpected request: ${path}`)
    }),
  )
  await run(f.queue.stageAttachmentEffect(connection, upload, false))
  expect((await run(f.queue.finishAttachmentEffect(connection, upload.id)))._tag).toBe('Failure')
  expect(f.stored()).toEqual([
    {
      id: upload.id,
      path: '/api/attachments/acknowledge-upload',
      method: 'POST',
      input: upload,
      attachmentReplacement: false,
    },
  ])
  const reopened = f.restart()
  online = true
  expect((await run(reopened.recoverEffect(connection)))._tag).toBe('Success')
  expect(f.stored()).toEqual([])
})
it('retains acknowledgement payload when the destination disappears before retirement', async () => {
  const f = fixture()
  const upload = {
    id: '3e222e4e-63dc-40d0-b0cb-6d1bc3b9ead4',
    taskId: 'task',
    name: 'file.txt',
    data: 'aGVsbG8=',
  }
  let checks = 0
  let acknowledgements = 0
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (url) => {
      const path = urlPath(url)
      if (path.endsWith('/status')) return Response.json({ version: 1 })
      if (path.endsWith('/upload-handled')) return Response.json({ handled: ++checks === 1 })
      if (path.endsWith('/acknowledge-upload')) acknowledgements++
      return Response.json({ ok: true })
    }),
  )
  await run(f.queue.stageAttachmentEffect(connection, upload, false))
  expect((await run(f.queue.finishAttachmentEffect(connection, upload.id)))._tag).toBe('Failure')
  expect(f.stored()[0]?.input).toEqual(upload)
  expect(acknowledgements).toBe(0)
  expect((await run(f.restart().recoverEffect(connection)))._tag).toBe('Failure')
  expect(f.stored()[0]?.input).toEqual(upload)
  expect(acknowledgements).toBe(0)
})
it('preserves the journal and rejects a receipt for another attachment', async () => {
  const f = fixture()
  const upload = {
    id: '3e222e4e-63dc-40d0-b0cb-6d1bc3b9ead4',
    taskId: 'task',
    name: 'file.txt',
    data: 'aGVsbG8=',
  }
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async () =>
      Response.json({
        available: true,
        receipt: {
          attachment: {
            id: 'c22b7703-e0a7-4f59-ab87-703ef50e824c',
            name: upload.name,
            mime: 'text/plain',
            size: 5,
          },
          revision: 3,
        },
      }),
    ),
  )
  await run(f.queue.stageAttachmentEffect(connection, upload, false))
  const result = await run(f.queue.retryAttachmentAfterReviewEffect(connection, upload.id))
  expect(result._tag).toBe('Failure')
  expect(f.stored()[0]?.input).toEqual(upload)
})
it('retains a queued upload until its saved destination confirms membership', async () => {
  const f = fixture()
  const upload = {
    id: '3e222e4e-63dc-40d0-b0cb-6d1bc3b9ead4',
    taskId: 'task',
    queuedMessageId: 'message',
    name: 'file.txt',
    data: 'aGVsbG8=',
  }
  let handled = false
  let acknowledgements = 0
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (url) => {
      if (urlPath(url).endsWith('/upload-handled')) return Response.json({ handled })
      acknowledgements++
      return Response.json({ ok: true })
    }),
  )
  await run(f.queue.stageAttachmentEffect(connection, upload, false))
  expect((await run(f.queue.finishAttachmentEffect(connection, upload.id)))._tag).toBe('Failure')
  expect(f.stored()[0]?.input).toEqual(upload)
  expect(acknowledgements).toBe(0)
  handled = true
  expect((await run(f.queue.finishAttachmentEffect(connection, upload.id)))._tag).toBe('Success')
  expect(f.stored()).toEqual([])
  expect(acknowledgements).toBe(1)
})
it('never replays an unavailable committed receipt', async () => {
  const f = fixture()
  const upload = {
    id: '3e222e4e-63dc-40d0-b0cb-6d1bc3b9ead4',
    taskId: 'task',
    name: 'file.txt',
    data: 'aGVsbG8=',
  }
  const requests: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (url) => {
      requests.push(urlPath(url))
      return Response.json({
        available: false,
        receipt: {
          attachment: { id: upload.id, name: upload.name, mime: 'text/plain', size: 5 },
          revision: 3,
        },
      })
    }),
  )
  await run(f.queue.stageAttachmentEffect(connection, upload, false))
  expect((await run(f.queue.retryAttachmentAfterReviewEffect(connection, upload.id)))._tag).toBe(
    'Failure',
  )
  expect(f.stored()[0]?.input).toEqual(upload)
  expect(requests).toHaveLength(1)
  expect(requests[0]).toContain('/upload-receipt')
})
it('retains the upload until the runtime durably fences explicit discard', async () => {
  const f = fixture()
  const upload = {
    id: '3e222e4e-63dc-40d0-b0cb-6d1bc3b9ead4',
    taskId: 'task',
    name: 'file.txt',
    data: 'aGVsbG8=',
  }
  let online = false
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (url) => {
      expect(urlPath(url)).toContain('/abandon-upload')
      if (!online) throw new TypeError('lost response')
      return Response.json({ ok: true })
    }),
  )
  await run(f.queue.stageAttachmentEffect(connection, upload, false))
  expect((await run(f.queue.discardAttachmentEffect(connection, upload.id)))._tag).toBe('Failure')
  expect(f.stored()[0]?.input).toEqual(upload)
  online = true
  expect((await run(f.restart().discardAttachmentEffect(connection, upload.id)))._tag).toBe(
    'Success',
  )
  expect(f.stored()).toEqual([])
})
it('retires a safely rejected checklist clear so newer progress can be reviewed and cleared', async () => {
  const f = fixture()
  let stale = true
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (url) => {
      if (urlPath(url).endsWith('/status'))
        return Response.json({ version: 1, acknowledgements: true })
      if (urlPath(url).endsWith('/acknowledge')) return Response.json({ ok: true })
      return stale
        ? Response.json({ error: 'The checklist changed', mutationRejected: true }, { status: 409 })
        : Response.json({ ok: true })
    }),
  )
  expect(
    (
      await run(
        f.queue.requestEffect(
          connection,
          '/api/tasks/checklist/clear',
          { id: 'task', expectedItems: [] },
          ok,
        ),
      )
    )._tag,
  ).toBe('Failure')
  expect(f.stored()).toEqual([])
  expect(f.queue.status(connection).error).toBeNull()
  stale = false
  expect(
    (
      await run(
        f.queue.requestEffect(
          connection,
          '/api/tasks/checklist/clear',
          { id: 'task', expectedItems: [{ text: 'New progress', status: 'pending' }] },
          ok,
        ),
      )
    )._tag,
  ).toBe('Success')
  expect(f.stored()).toEqual([])
})
it('retires a rejected task-list undo but retains an uncertain 404 for review', async () => {
  const f = fixture()
  let status = 409
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (url) => {
      if (urlPath(url).endsWith('/status'))
        return Response.json({ version: 1, acknowledgements: true })
      if (urlPath(url).endsWith('/acknowledge')) return Response.json({ ok: true })
      return Response.json(
        { error: 'Undo unavailable', ...(status === 409 ? { mutationRejected: true } : {}) },
        { status },
      )
    }),
  )
  const submit = () =>
    run(
      f.queue.requestEffect(
        connection,
        '/api/tasks/list-action',
        { action: 'undo', token: 'token' },
        ok,
      ),
    )
  expect((await submit())._tag).toBe('Failure')
  expect(f.stored()).toEqual([])
  status = 404
  expect((await submit())._tag).toBe('Failure')
  expect(f.stored()).toEqual([expect.objectContaining({ blocked: true })])
})
it('recovers body interruption and retires receipts only after durable journal removal', async () => {
  const f = fixture()
  let interrupted = true
  const acknowledgements: MutationOutbox[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (url) => {
      if (urlPath(url).endsWith('/status'))
        return Response.json({ version: 1, acknowledgements: true })
      if (urlPath(url).endsWith('/acknowledge')) {
        acknowledgements.push(f.stored())
        return Response.json({ ok: true })
      }
      if (interrupted)
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error('Connection reset'))
            },
          }),
        )
      return Response.json({ ok: true })
    }),
  )
  expect(
    (
      await run(
        f.queue.requestEffect(
          connection,
          '/api/tasks/lifecycle',
          { id: 'task', action: 'archive' },
          ok,
        ),
      )
    )._tag,
  ).toBe('Failure')
  expect(f.stored()).toEqual([expect.objectContaining({ id: 'operation-1' })])
  expect(f.stored()[0]?.blocked).toBeUndefined()
  interrupted = false
  expect((await run(f.restart().recoverEffect(connection)))._tag).toBe('Success')
  expect(f.stored()).toEqual([])
  expect(acknowledgements).toEqual([[]])
})
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
  expect(failed._tag).toBe('Failure')
  expect(f.stored()).toHaveLength(1)
  reachable = true
  expect((await run(f.restart().recoverEffect(connection)))._tag).toBe('Success')
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
  expect(result._tag).toBe('Success')
  expect(result).toMatchObject({ _tag: 'Success', success: { ok: true } })
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
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(f.stored()[0]?.blocked).toBe(true)
  expect(f.queue.status({ ...connection, token: 'another-device' }).pending).toBe(0)
  await run(f.queue.discardEffect(connection))
  expect(f.stored()).toEqual([])
  fetch.mockClear()
  const failing = new RuntimeMutations({
    ...f.storage,
    update: async () => {
      throw new Error('Disk full')
    },
  })
  const result = await run(
    failing.requestEffect(connection, '/api/tasks/lifecycle', { id: 'task', action: 'delete' }, ok),
  )
  expect(result._tag).toBe('Failure')
  expect(fetch).not.toHaveBeenCalled()
})
it('keeps multiple offline sends ordered and retains each identity through recovery', async () => {
  const f = fixture()
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new Error('Offline')))
  for (const messageId of ['first', 'second']) {
    expect(
      await run(f.queue.requestEffect(connection, '/api/tasks/message', { messageId }, ok)),
    ).toMatchObject({ _tag: 'Success', success: { ok: true } })
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
  expect((await run(f.restart().recoverEffect(connection)))._tag).toBe('Success')
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
  ).toMatchObject({ _tag: 'Success', success: { ok: true } })
  expect(f.stored()).toEqual([])
  const saved = fixture([
    { id: 'prior', path: '/api/tasks/lifecycle', method: 'POST', input: { id: 'task' } },
  ])
  fetch.mockClear()
  expect((await run(saved.queue.recoverEffect(connection)))._tag).toBe('Failure')
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
    ).toMatchObject({ _tag: 'Failure', failure: { message: 'Action rejected' } })
    expect(f.stored()).toEqual([])
    reject = false
    expect(
      await run(f.queue.requestEffect(connection, '/api/tasks/lifecycle', { id: 'next' }, ok)),
    ).toMatchObject({ _tag: 'Success', success: { ok: true } })
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
  ).toBe('Failure')
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
    ).toBe('Success')
    expect(
      (
        await run(
          f.queue.requestEffect(connection, '/api/tasks/lifecycle', { id: 'uncertain' }, ok),
        )
      )._tag,
    ).toBe('Failure')
    expect(f.stored()).toHaveLength(1)
    expect(f.stored()[0]?.input).toEqual({ id: 'uncertain' })
    fetch.mockClear()
    expect(await run(f.queue.recoverEffect(connection))).toMatchObject({
      _tag: 'Failure',
      failure: { message: 'Update this runtime before recovering saved actions.' },
    })
    expect(fetch).not.toHaveBeenCalled()
    expect(await run(f.queue.recoverEffect(connection, true))).toMatchObject({
      _tag: 'Failure',
      failure: { message: 'Update this runtime before recovering saved actions.' },
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
  ).toBe('Failure')
  expect(f.stored()).toHaveLength(1)
  upgraded = true
  expect((await run(f.queue.recoverEffect(connection, true)))._tag).toBe('Success')
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
  expect((await run(f.restart().recoverEffect(connection)))._tag).toBe('Success')
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
  expect(results.map((result) => result._tag)).toEqual(['Success', 'Success'])
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
  ).toBe('Failure')
  expect(fetch).not.toHaveBeenCalled()
  expect(update).not.toHaveBeenCalled()
  expect((await run(queue.discardEffect(connection)))._tag).toBe('Success')
  expect(saved).toEqual([])
  expect((await run(queue.assertEmptyEffect(connection)))._tag).toBe('Success')
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
  expect((await run(f.queue.assertEmptyEffect(connection)))._tag).toBe('Failure')
  const fetch = vi.fn<typeof globalThis.fetch>()
  vi.stubGlobal('fetch', fetch)
  expect(
    (await run(f.queue.requestEffect(connection, '/api/tasks/message', { messageId: 'new' }, ok)))
      ._tag,
  ).toBe('Failure')
  expect(f.stored()).toEqual([old])
  expect(fetch).not.toHaveBeenCalled()
  await run(f.queue.discardEffect(connection))
  expect((await run(f.restart().assertEmptyEffect(connection)))._tag).toBe('Success')
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
  ).toBe('Failure')
  expect(f.stored()).toEqual([{ ...old, blocked: true, receiptToken: connection.token }])
})

it('clears a stale local error when another client has drained the journal', async () => {
  const f = fixture()
  vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error('Offline')))
  await run(f.queue.requestEffect(connection, '/api/tasks/message', { messageId: 'old' }, ok))
  expect(f.queue.status(connection).error).not.toBeNull()
  await run(f.restart().discardEffect(connection))
  await run(f.queue.recoverEffect(connection))
  expect(f.queue.status(connection)).toEqual({ reviewRequired: false, pending: 0, error: null })
})

it('reads durable state on each empty recovery without notifying unchanged status', async () => {
  const changed = vi.fn<() => void>()
  const f = fixture([], changed)
  const read = vi.spyOn(f.storage, 'read')
  await run(f.queue.recoverEffect(connection))
  await run(f.queue.recoverEffect(connection))
  expect(read).toHaveBeenCalledTimes(2)
  expect(changed).not.toHaveBeenCalled()
  expect(f.queue.status(connection)).toEqual({ reviewRequired: false, pending: 0, error: null })
})

it('notifies changes from other writers while ignoring equivalent freshly decoded journals', async () => {
  const changed = vi.fn<() => void>()
  const f = fixture(
    [{ id: 'saved', path: '/api/tasks/message', method: 'POST', input: { text: 'old' } }],
    changed,
  )
  expect((await run(f.queue.assertEmptyEffect(connection)))._tag).toBe('Failure')
  expect(changed).toHaveBeenCalledTimes(2) // Loaded actions and their actionable status.
  changed.mockClear()
  expect((await run(f.queue.assertEmptyEffect(connection)))._tag).toBe('Failure')
  expect(changed).not.toHaveBeenCalled()
  await f.storage.update(connection, (pending) =>
    pending.map((entry) => ({ ...entry, input: { text: 'changed elsewhere' }, blocked: true })),
  )
  expect((await run(f.queue.assertEmptyEffect(connection)))._tag).toBe('Failure')
  expect(changed).toHaveBeenCalledOnce()
  changed.mockClear()
  await f.storage.clear()
  expect((await run(f.queue.recoverEffect(connection)))._tag).toBe('Success')
  expect(changed).toHaveBeenCalledTimes(2) // Removed actions and cleared the review notice.
  changed.mockClear()
  expect((await run(f.queue.recoverEffect(connection)))._tag).toBe('Success')
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
  expect(f.queue.status(connection)).toEqual({
    reviewRequired: false,
    pending: 0,
    error: 'Conflict',
  })
  changed.mockClear()
  await run(f.queue.recoverEffect(connection))
  expect(changed).toHaveBeenCalledOnce()
  expect(f.queue.status(connection)).toEqual({ reviewRequired: false, pending: 0, error: null })
  changed.mockClear()
  await run(f.queue.recoverEffect(connection))
  expect(changed).not.toHaveBeenCalled()
})
it('keeps the receipt unretired when durable outbox removal fails after acceptance', async () => {
  const f = fixture()
  const update = f.storage.update
  f.storage.update = async (connection, change) => {
    if (!change(f.stored()).length) throw new Error('Journal disk full')
    return update(connection, change)
  }
  const fetcher = vi.fn<typeof fetch>(async (url) =>
    Response.json(
      urlPath(url).endsWith('/status') ? { version: 1, acknowledgements: true } : { ok: true },
    ),
  )
  vi.stubGlobal('fetch', fetcher)
  expect(
    (
      await run(
        f.queue.requestEffect(
          connection,
          '/api/tasks/lifecycle',
          { id: 'task', action: 'archive' },
          ok,
        ),
      )
    )._tag,
  ).toBe('Failure')
  expect(f.stored()).toHaveLength(1)
  expect(fetcher.mock.calls.some(([url]) => urlPath(url).endsWith('/acknowledge'))).toBe(false)
})

it('restores multiple pending bubbles, preserves the receipt-to-snapshot handoff, and clears discard', async () => {
  const task = decode(taskSchema, {
    id: 'task',
    title: 'Task',
    repositoryId: 'repo',
    agentId: '',
    status: 'running',
    createdAt: '',
    messages: [],
    files: [],
    draft: '',
    example: false,
  })
  const f = fixture()
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new Error('Offline')))
  for (const id of ['first', 'second']) {
    const result = await run(
      f.queue.requestEffect(
        connection,
        '/api/tasks/message',
        { id: task.id, messageId: id, text: id },
        responses.ok,
      ),
    )
    expect(result).toMatchObject({ _tag: 'Success', success: { ok: true, pending: true } })
  }
  const restarted = f.restart()
  await run(restarted.recoverEffect(connection))
  expect(restarted.pendingMessages(connection, task).map((item) => item.message.id)).toEqual([
    'first',
    'second',
  ])
  expect(restarted.pendingMessages({ ...connection, token: 'another-token' }, task)).toEqual([])
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (url) =>
      Response.json(urlPath(url).endsWith('/status') ? { version: 1 } : { ok: true }),
    ),
  )
  await run(restarted.recoverEffect(connection))
  expect(f.stored()).toEqual([])
  expect(restarted.pendingMessages(connection, task).map((item) => item.message.id)).toEqual([
    'first',
    'second',
  ])
  const messages = restarted.pendingMessages(connection, task).map((item) => item.message)
  restarted.acknowledgeMessages(connection, [{ ...task, messages }])
  expect(restarted.pendingMessages(connection, task)).toEqual([])
  await run(restarted.discardEffect(connection))
  expect(restarted.pendingMessages(connection, task)).toEqual([])
})

it('retires rejected workspace edits without blocking subsequent model switches', async () => {
  const f = fixture()
  let rejected = true
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (url) => {
      if (urlPath(url).endsWith('/status'))
        return Response.json({ version: 1, acknowledgements: true })
      if (urlPath(url).endsWith('/acknowledge')) return Response.json({ ok: true })
      return rejected
        ? Response.json({ error: 'Invalid request data.' }, { status: 400 })
        : Response.json({ ok: true })
    }),
  )
  const input = {
    collection: 'tasks',
    id: 'task',
    changes: { agentOverrides: { before: null, after: null } },
  }
  expect(
    (await run(f.queue.requestEffect(connection, '/api/workspace', input, ok, 'PATCH')))._tag,
  ).toBe('Failure')
  expect(f.stored()).toEqual([])
  expect(f.queue.status(connection)).toEqual({ reviewRequired: false, pending: 0, error: null })
  rejected = false
  expect(
    (await run(f.queue.requestEffect(connection, '/api/workspace', input, ok, 'PATCH')))._tag,
  ).toBe('Success')
})
it('resolves older blocked validation receipts while preserving uncertain commands', async () => {
  const f = fixture([
    { id: 'old-edit', path: '/api/workspace', method: 'PATCH', input: {}, blocked: true },
  ])
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (url) =>
      Response.json(
        urlPath(url).endsWith('/status') ? { version: 1 } : { error: 'Invalid request data.' },
        { status: urlPath(url).endsWith('/status') ? 200 : 400 },
      ),
    ),
  )
  expect((await run(f.queue.recoverEffect(connection)))._tag).toBe('Success')
  expect(f.stored()).toEqual([])
  expect(f.queue.status(connection)).toEqual({ reviewRequired: false, pending: 0, error: null })
})

it.each([403, 404, 409, 422])(
  'removes confirmed rejected workspace edits (%s), but retains unmarked uncertainty',
  async (status) => {
    const f = fixture()
    let confirmed = true
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (url) =>
        urlPath(url).endsWith('/status')
          ? Response.json({ version: 1 })
          : Response.json(
              { error: 'Edit rejected', ...(confirmed ? { mutationRejected: true } : {}) },
              { status },
            ),
      ),
    )
    expect(
      (
        await run(
          f.queue.requestEffect(
            connection,
            '/api/workspace',
            { collection: 'tasks', id: 'task', changes: {} },
            ok,
            'PATCH',
          ),
        )
      )._tag,
    ).toBe('Failure')
    expect(f.queue.status(connection)).toEqual({ reviewRequired: false, pending: 0, error: null })
    confirmed = false
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
  },
)
it('resolves an old rejected edit before sending a different new model selection', async () => {
  const f = fixture([
    { id: 'old', path: '/api/workspace', method: 'PATCH', input: { old: true }, blocked: true },
  ])
  const sent: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (url, options) => {
      if (urlPath(url).endsWith('/status')) return Response.json({ version: 1 })
      const id = new Headers(options?.headers).get('X-Dovo-Mutation-Id') ?? ''
      sent.push(id)
      return id === 'old'
        ? Response.json({ error: 'Invalid request data.' }, { status: 400 })
        : Response.json({ ok: true })
    }),
  )
  expect(
    (await run(f.queue.requestEffect(connection, '/api/workspace', { model: 'new' }, ok, 'PATCH')))
      ._tag,
  ).toBe('Success')
  expect(sent).toEqual(['old', 'operation-1'])
  expect(f.queue.status(connection)).toEqual({ reviewRequired: false, pending: 0, error: null })
})
it('requests an authoritative refresh after reconnect replays a reconciled workspace edit', async () => {
  const f = fixture([{ id: 'saved-edit', path: '/api/workspace', method: 'PATCH', input: {} }])
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (url) =>
      urlPath(url).endsWith('/status')
        ? Response.json({ version: 1 })
        : Response.json({ revision: 4, runtimeInstanceId: 'runtime', reconciled: true }),
    ),
  )
  const before = f.queue.workspaceRefreshCheckpoint(connection)
  await Effect.runPromise(f.queue.recoverEffect(connection))
  expect(f.stored()).toEqual([])
  expect(f.queue.requiresWorkspaceRefresh(connection)).toBe(true)
  f.queue.workspaceRefreshed(connection, before)
  expect(f.queue.requiresWorkspaceRefresh(connection)).toBe(true)
  f.queue.workspaceRefreshed(connection, f.queue.workspaceRefreshCheckpoint(connection))
  expect(f.queue.requiresWorkspaceRefresh(connection)).toBe(false)
  expect(f.queue.requiresWorkspaceRefresh({ ...connection, token: 'other-device' })).toBe(false)
})
it('refreshes successful direct patches even when callers omit reconciliation metadata', async () => {
  const f = fixture()
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (url) =>
      urlPath(url).endsWith('/status')
        ? Response.json({ version: 1 })
        : Response.json({ ok: true, reconciled: true }),
    ),
  )
  await Effect.runPromise(f.queue.requestEffect(connection, '/api/workspace', {}, ok, 'PATCH'))
  expect(f.queue.requiresWorkspaceRefresh(connection)).toBe(true)
  const first = f.queue.workspaceRefreshCheckpoint(connection)
  await Effect.runPromise(
    f.queue.requestEffect(connection, '/api/workspace', { next: true }, ok, 'PATCH'),
  )
  f.queue.workspaceRefreshed(connection, first)
  expect(f.queue.requiresWorkspaceRefresh(connection)).toBe(true)
})
it('refreshes committed workspace edits even if a subsequent unrelated command is blocked', async () => {
  const f = fixture([
    { id: 'edit', path: '/api/workspace', method: 'PATCH', input: {} },
    { id: 'command', path: '/api/tasks/lifecycle', method: 'POST', input: {}, blocked: true },
  ])
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (url) =>
      urlPath(url).endsWith('/status')
        ? Response.json({ version: 1 })
        : Response.json({ revision: 2, reconciled: true }),
    ),
  )
  expect((await run(f.queue.recoverEffect(connection)))._tag).toBe('Failure')
  expect(f.stored().map((item) => item.id)).toEqual(['command'])
  expect(f.queue.requiresWorkspaceRefresh(connection)).toBe(true)
})

it('automatically merges a legacy stale edit and durably preserves competing intent', async () => {
  const f = fixture()
  const host = decode(taskSchema, {
    id: 'task',
    repositoryId: 'repo',
    agentId: 'agent',
    status: 'draft',
    createdAt: '2026-10-13T00:00:00Z',
    messages: [],
    files: [],
    example: false,
    title: 'Runtime title',
    draft: '',
  })
  const writes: unknown[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (url, init) => {
      const path = urlPath(url)
      if (path.includes('/api/mutations/status')) return Response.json({ version: 1 })
      if (path.includes('/api/snapshot'))
        return Response.json({
          revision: 4,
          runtimeInstanceId: 'runtime',
          owner: false,
          workspace: {
            version: 1,
            runtimeAddress: '',
            agents: [],
            repositories: [],
            automations: [],
            tasks: [host],
          },
          approvals: [],
          questions: [],
          terminals: [],
          runs: [],
          devices: [],
          pendingDevices: [],
        })
      if (typeof init?.body !== 'string') throw new Error('Expected JSON body')
      writes.push(JSON.parse(init.body))
      if (writes.length === 1)
        return Response.json({ error: 'Another client changed title' }, { status: 409 })
      return Response.json({ revision: 5, runtimeInstanceId: 'runtime' })
    }),
  )
  const result = await run(
    f.queue.workspaceEffect(
      connection,
      {
        collection: 'tasks',
        id: 'task',
        changes: {
          title: { before: 'Old title', after: 'Local title' },
          draft: { before: '', after: 'Independent draft' },
        },
      },
      'stable',
    ),
  )
  expect(result._tag).toBe('Success')
  expect(writes[1]).toEqual({
    collection: 'tasks',
    id: 'task',
    changes: { draft: { before: '', after: 'Independent draft' } },
  })
  expect(f.recovered()).toHaveLength(1)
  expect(f.recovered()[0]?.patch.changes.title?.after).toBe('Local title')
})

it('settles a modern rejected workspace edit and proceeds with the next independent edit', async () => {
  const f = fixture([
    {
      id: 'rejected',
      path: '/api/workspace',
      method: 'PATCH',
      input: { collection: 'tasks', id: 'task', changes: {} },
    },
    {
      id: 'next',
      path: '/api/workspace',
      method: 'PATCH',
      input: { collection: 'tasks', id: 'other', changes: {} },
    },
  ])
  const ids: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (url, init) => {
      if (urlPath(url).endsWith('/status'))
        return Response.json({ version: 1, workspaceMutations: 1 })
      const id = new Headers(init?.headers).get('X-Dovo-Mutation-Id')!
      ids.push(id)
      return Response.json({
        revision: 3,
        runtimeInstanceId: 'runtime',
        outcome: id === 'rejected' ? 'rejected' : 'applied',
        reason: id === 'rejected' ? 'Task is active' : undefined,
      })
    }),
  )
  await run(f.queue.recoverEffect(connection))
  expect(ids).toEqual(['rejected', 'next'])
  expect(f.stored()).toEqual([])
})

it('does not let a stale streamed snapshot clear the acknowledged workspace refresh', async () => {
  const f = fixture()
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (url) =>
      Response.json(
        urlPath(url).endsWith('/status')
          ? { version: 1, workspaceMutations: 1 }
          : { revision: 8, runtimeInstanceId: 'runtime', outcome: 'applied' },
      ),
    ),
  )
  await Effect.runPromise(
    f.queue.workspaceEffect(connection, { collection: 'agents', id: 'agent', changes: {} }, 'edit'),
  )
  const checkpoint = f.queue.workspaceRefreshCheckpoint(connection)
  f.queue.workspaceRefreshed(connection, checkpoint, { revision: 7, runtimeInstanceId: 'runtime' })
  expect(f.queue.requiresWorkspaceRefresh(connection)).toBe(true)
  f.queue.workspaceRefreshed(connection, checkpoint, { revision: 8, runtimeInstanceId: 'runtime' })
  expect(f.queue.requiresWorkspaceRefresh(connection)).toBe(false)
})

it('keeps workspace edits queued without receipts and recovers automatically after upgrade', async () => {
  const f = fixture([
    {
      id: 'edit',
      path: '/api/workspace',
      method: 'PATCH',
      input: { collection: 'agents', id: 'agent', changes: {} },
    },
  ])
  let upgraded = false
  let writes = 0
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (url) => {
      if (urlPath(url).endsWith('/status'))
        return upgraded
          ? Response.json({ version: 1, workspaceMutations: 1 })
          : Response.json({ error: 'Not found' }, { status: 404 })
      writes++
      return Response.json({ revision: 2, runtimeInstanceId: 'runtime', outcome: 'applied' })
    }),
  )
  await run(f.queue.recoverEffect(connection))
  expect(writes).toBe(0)
  expect(f.stored()).toHaveLength(1)
  upgraded = true
  await run(f.queue.recoverEffect(connection))
  expect(writes).toBe(1)
  expect(f.stored()).toEqual([])
})

it('never mints another legacy retry identity after a lost response and changed host', async () => {
  const f = fixture()
  let agent = {
    id: 'agent',
    name: 'Runtime name',
    instructions: '',
    provider: 'codex',
    model: '',
    permission: 'ask',
    endpoint: '',
  }
  let loseResponse = true
  const retryIds: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (url, init) => {
      const path = urlPath(url)
      if (path.endsWith('/status')) return Response.json({ version: 1 })
      if (path.includes('/api/snapshot'))
        return Response.json({
          revision: 4,
          runtimeInstanceId: 'runtime',
          owner: false,
          workspace: {
            version: 1,
            runtimeAddress: '',
            agents: [agent],
            repositories: [],
            tasks: [],
            automations: [],
          },
          approvals: [],
          questions: [],
          terminals: [],
          runs: [],
          devices: [],
          pendingDevices: [],
        })
      const id = new Headers(init?.headers).get('X-Dovo-Mutation-Id')!
      if (id === 'original')
        return Response.json({ error: 'Another client changed name' }, { status: 409 })
      retryIds.push(id)
      if (loseResponse) {
        agent = { ...agent, name: 'Before', instructions: 'New runtime instructions' }
        throw new Error('Lost response after retry committed')
      }
      return Response.json(
        { error: 'This action ID already belongs to another request.' },
        { status: 409 },
      )
    }),
  )
  const patch = {
    collection: 'agents',
    id: 'agent',
    changes: {
      name: { before: 'Before', after: 'Local name' },
      instructions: { before: '', after: 'Local instructions' },
    },
  }
  expect((await run(f.queue.workspaceEffect(connection, patch, 'original')))._tag).toBe('Failure')
  loseResponse = false
  expect((await run(f.restart().workspaceEffect(connection, patch, 'original')))._tag).toBe(
    'Success',
  )
  expect(retryIds.length).toBeGreaterThanOrEqual(2)
  expect(new Set(retryIds).size).toBe(1)
  expect(agent.name).toBe('Before')
  expect(f.recovered().length).toBeGreaterThan(0)
})

it('retains a legacy rejected edit when durable recovery storage cannot be written', async () => {
  const f = fixture([
    {
      id: 'edit',
      path: '/api/workspace',
      method: 'PATCH',
      input: {
        collection: 'agents',
        id: 'agent',
        changes: { name: { before: 'Before', after: 'Local' } },
      },
    },
  ])
  const queue = new RuntimeMutations({
    ...f.storage,
    recoverWorkspaceEdit: async () => {
      throw new Error('Recovery disk full')
    },
  })
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (url) =>
      urlPath(url).endsWith('/status')
        ? Response.json({ version: 1 })
        : Response.json({ error: 'Invalid edit' }, { status: 400 }),
    ),
  )
  expect((await run(queue.recoverEffect(connection)))._tag).toBe('Failure')
  expect(f.stored()).toHaveLength(1)
})

it('settles acknowledged workspace receipts from older runtimes without manual discard', async () => {
  const f = fixture([
    {
      id: 'old',
      path: '/api/workspace',
      method: 'PATCH',
      input: {
        collection: 'agents',
        id: 'gone',
        changes: { name: { before: 'Before', after: 'Local' } },
      },
    },
  ])
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (url) => {
      if (urlPath(url).endsWith('/status')) return Response.json({ version: 1 })
      if (urlPath(url).includes('/api/snapshot'))
        return Response.json({
          revision: 4,
          runtimeInstanceId: 'runtime',
          owner: false,
          workspace: {
            version: 1,
            runtimeAddress: '',
            agents: [],
            tasks: [],
            repositories: [],
            automations: [],
          },
          approvals: [],
          questions: [],
          terminals: [],
          runs: [],
          devices: [],
          pendingDevices: [],
        })
      return Response.json(
        {
          error:
            'This action was already acknowledged. Discard the stale saved action; it was not repeated.',
        },
        { status: 409 },
      )
    }),
  )
  expect((await run(f.queue.recoverEffect(connection)))._tag).toBe('Success')
  expect(f.stored()).toEqual([])
  expect(f.recovered()).toHaveLength(1)
})
it('syncs independent workspace edits after a rejected command while preserving the command', async () => {
  const f = fixture([
    {
      id: 'command',
      path: '/api/tasks/lifecycle',
      method: 'POST',
      input: { id: 'gone', action: 'archive' },
    },
    {
      id: 'workspace',
      path: '/api/workspace',
      method: 'PATCH',
      input: { collection: 'agents', id: 'agent', changes: {} },
    },
  ])
  const sent: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (url, init) => {
      if (urlPath(url).endsWith('/status'))
        return Response.json({ version: 1, workspaceMutations: 1 })
      const id = new Headers(init?.headers).get('X-Dovo-Mutation-Id')!
      sent.push(id)
      return id === 'command'
        ? Response.json({ error: 'Item not found' }, { status: 404 })
        : Response.json({ revision: 4, runtimeInstanceId: 'runtime', outcome: 'applied' })
    }),
  )
  await run(f.queue.recoverEffect(connection))
  expect(sent).toEqual(['command', 'workspace'])
  expect(f.stored()).toEqual([expect.objectContaining({ id: 'command', blocked: true })])
  expect(
    (
      await run(
        f.queue.requestEffect(
          connection,
          '/api/workspace',
          { collection: 'agents', id: 'other', changes: {} },
          workspacePatchResultSchema,
          'PATCH',
        ),
      )
    )._tag,
  ).toBe('Success')
  expect(sent).toEqual(['command', 'workspace', 'operation-1'])
  expect(f.stored()).toHaveLength(1)
})
it('reads server recoveries when the local recovery journal is corrupt and reports the missing source', async () => {
  const f = fixture()
  const queue = new RuntimeMutations({
    ...f.storage,
    workspaceRecoveries: async () => {
      throw new Error('Corrupt local journal')
    },
  })
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    Response.json({
      edits: [
        {
          id: 'remote',
          createdAt: '2026-10-14',
          patch: { collection: 'agents', id: 'agent', changes: {} },
          host: null,
        },
      ],
      nextCursor: '123',
    }),
  )
  vi.stubGlobal('fetch', fetch)
  const value = await Effect.runPromise(
    queue.requestEffect(
      connection,
      '/api/workspace/recovered-edits',
      undefined,
      workspaceRecoveriesSchema,
      'GET',
    ),
  )
  expect(value.edits.map((edit) => edit.id)).toEqual(['remote'])
  expect(value.warnings).toHaveLength(1)
  expect(value.nextCursor).toBe('123')
  expect(fetch).toHaveBeenCalledOnce()
})

function renewalFixture() {
  const previous = {
    address: 'http://old-account.local',
    token: 'old-token',
    runtimeId: 'same-runtime',
    accountSession: 'same-account',
  }
  const next = { ...previous, address: 'http://new-account.local', token: 'new-token' }
  const message = {
    id: 'message-action',
    path: '/api/tasks/message',
    method: 'POST' as const,
    input: { id: 'task', messageId: 'stable-message', text: 'Offline message' },
  }
  const action = {
    id: 'uncertain-action',
    path: '/api/tasks/cancel',
    method: 'POST' as const,
    input: { id: 'task' },
  }
  const journals = new Map<string, MutationOutbox>([[previous.token, [message, action]]])
  let failCopy = false,
    failClear = false
  const storage: MutationStorage = {
    id: () => 'new-action',
    read: async (c) => structuredClone(journals.get(c.token) ?? []),
    clear: async (c) => {
      if (failClear) throw new Error('Cleanup unavailable')
      journals.delete(c.token)
    },
    update: async (c, change) => {
      if (failCopy && c.token === next.token) throw new Error('Disk full')
      const saved = change(structuredClone(journals.get(c.token) ?? []))
      journals.set(c.token, structuredClone(saved))
      return saved
    },
  }
  return {
    previous,
    next,
    message,
    action,
    journals,
    storage,
    queue: new RuntimeMutations(storage),
    failCopy: () => {
      failCopy = true
    },
    failClear: () => {
      failClear = true
    },
  }
}

it('renews access with durable actions, recovers messages once and requires consent for uncertain commands', async () => {
  const f = renewalFixture(),
    commit = vi.fn<() => void>()
  const sent: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (url, init) => {
      if (urlPath(url).endsWith('/health'))
        return Response.json({ service: 'dovo-runtime', runtimeId: 'same-runtime' })
      if (urlPath(url).endsWith('/status')) return Response.json({ version: 1 })
      sent.push(urlPath(url))
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer new-token')
      return Response.json({ ok: true })
    }),
  )
  await Effect.runPromise(f.queue.renewConnectionEffect(f.previous, f.next, Effect.sync(commit)))
  expect(commit).toHaveBeenCalledOnce()
  expect(f.journals.has(f.previous.token)).toBe(false)
  expect(f.queue.status(f.next).reviewRequired).toBe(true)
  await run(f.queue.recoverEffect(f.next))
  expect(sent).toEqual(['http://new-account.local/api/tasks/message'])
  expect(f.journals.get(f.next.token)?.map((item) => item.id)).toEqual([f.action.id])
  await run(f.queue.recoverEffect(f.next, true))
  expect(sent).toHaveLength(1)
  await Effect.runPromise(f.queue.recoverEffect(f.next, true, true))
  expect(sent).toEqual([
    'http://new-account.local/api/tasks/message',
    'http://new-account.local/api/tasks/cancel',
  ])
  expect(f.journals.get(f.next.token)).toEqual([])
})

it('does not publish a new credential when its journal cannot be persisted', async () => {
  const f = renewalFixture(),
    commit = vi.fn<() => void>()
  f.failCopy()
  expect(
    (await run(f.queue.renewConnectionEffect(f.previous, f.next, Effect.sync(commit))))._tag,
  ).toBe('Failure')
  expect(commit).not.toHaveBeenCalled()
  expect(f.journals.get(f.previous.token)).toEqual([f.message, f.action])
})
it('requires review when renewing only a LAN computer internet fallback and rejects late old-credential work', async () => {
  const f = renewalFixture()
  const peer = { origin: 'https://connect.test', secret: 'a'.repeat(64) }
  const previous = {
    address: f.previous.address,
    token: f.previous.token,
    runtimeId: f.previous.runtimeId,
    internet: {
      address: 'http://old-tunnel.local',
      token: 'old-internet',
      runtimeId: f.previous.runtimeId,
      session: 'account',
      peer,
    },
  }
  const next = { ...previous, internet: { ...previous.internet, token: 'new-internet' } }
  await Effect.runPromise(f.queue.renewConnectionEffect(previous, next, Effect.void))
  expect(f.journals.get(previous.token)).toHaveLength(2)
  expect(f.queue.status(next).reviewRequired).toBe(true)
  expect(
    f.journals.get(previous.token)?.find((item) => item.id === f.action.id)?.reviewAfterRenewal,
  ).toBe(true)
  expect((await run(f.queue.assertEmptyEffect(previous)))._tag).toBe('Failure')
  expect(
    (await run(f.queue.requestEffect(previous, '/api/tasks/cancel', { id: 'late' }, ok)))._tag,
  ).toBe('Failure')
})
it('persists the first receipt credential across restarts and requires consent before crossing credentials', async () => {
  const f = fixture()
  let applied = 0
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (url) => {
      if (urlPath(url).endsWith('/status')) return Response.json({ version: 1 })
      applied++
      return Response.json({ error: 'Temporary failure' }, { status: 503 })
    }),
  )
  await run(f.queue.requestEffect(connection, '/api/tasks/cancel', { id: 'task' }, ok))
  expect(f.stored()[0]?.receiptToken).toBe(connection.token)
  const before = applied
  const changed = { ...connection, token: 'another-device' }
  const restarted = f.restart()
  await run(restarted.recoverEffect(changed))
  expect(applied).toBe(before)
  expect(restarted.status(changed).reviewRequired).toBe(true)
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (url) => {
      if (urlPath(url).endsWith('/status')) return Response.json({ version: 1 })
      applied++
      return Response.json({ ok: true })
    }),
  )
  await Effect.runPromise(restarted.recoverEffect(changed, true, true))
  expect(applied).toBe(before + 1)
  expect(f.stored()).toEqual([])
})

it('keeps source actions after a failed commit and safely repeats an interrupted handoff', async () => {
  const f = renewalFixture()
  await run(
    f.queue.renewConnectionEffect(f.previous, f.next, Effect.fail(new Error('Account changed'))),
  )
  expect(f.journals.get(f.previous.token)).toHaveLength(2)
  expect(f.journals.get(f.next.token)).toHaveLength(2)
  await Effect.runPromise(f.queue.renewConnectionEffect(f.previous, f.next, Effect.void))
  expect(f.journals.get(f.next.token)).toHaveLength(2)
  expect(f.journals.has(f.previous.token)).toBe(false)
})

it('preserves the replacement after cleanup fails and rejects late writes using replaced credentials', async () => {
  const f = renewalFixture()
  f.failClear()
  await Effect.runPromise(f.queue.renewConnectionEffect(f.previous, f.next, Effect.void))
  expect(f.journals.get(f.next.token)).toHaveLength(2)
  const result = await run(
    f.queue.requestEffect(
      f.previous,
      '/api/tasks/message',
      { id: 'task', messageId: 'late', text: 'Late' },
      ok,
    ),
  )
  expect(result._tag).toBe('Failure')
  expect(f.journals.get(f.previous.token)).toEqual([f.message, f.action])
})

it.each(['runtimeId', 'accountSession'] as const)(
  'rejects journal transfer to another %s',
  async (field) => {
    const f = renewalFixture(),
      commit = vi.fn<() => void>()
    const result = await run(
      f.queue.renewConnectionEffect(
        f.previous,
        { ...f.next, [field]: 'different' },
        Effect.sync(commit),
      ),
    )
    expect(result._tag).toBe('Failure')
    expect(commit).not.toHaveBeenCalled()
    expect(f.journals.get(f.previous.token)).toHaveLength(2)
  },
)

it('keeps a temporary Connect lease rejection recoverable without blocking the saved action', async () => {
  const f = fixture()
  let valid = false
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (url) =>
      urlPath(url).endsWith('/status')
        ? Response.json({ version: 1 })
        : valid
          ? Response.json({ ok: true })
          : Response.json(
              { error: 'Account access requires an authorized Dovo Connect tunnel' },
              { status: 403 },
            ),
    ),
  )
  await run(
    f.queue.requestEffect(
      connection,
      '/api/tasks/message',
      { id: 'task', messageId: 'same-message', text: 'Hello' },
      ok,
    ),
  )
  expect(f.stored()).toHaveLength(1)
  expect(f.stored()[0]?.blocked).toBeUndefined()
  valid = true
  await Effect.runPromise(f.queue.recoverEffect(connection))
  expect(f.stored()).toEqual([])
})

it('recovers an uncertain duplicate after remount using the original copy and receipt IDs', async () => {
  const f = fixture()
  const delivered: Array<{ receipt: string | null; input: unknown }> = []
  let loseResponse = true
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (url, init) => {
      if (urlPath(url).endsWith('/status')) return Response.json({ version: 1, queueMutations: 1 })
      if (typeof init?.body !== 'string') throw new Error('Expected JSON body')
      delivered.push({
        receipt: new Headers(init.headers).get('X-Dovo-Mutation-Id'),
        input: JSON.parse(init.body),
      })
      expect(f.stored()).toHaveLength(1)
      if (loseResponse) throw new TypeError('Response lost after the copy was committed')
      return Response.json({ ok: true })
    }),
  )
  const input = {
    id: 'task',
    action: 'duplicate',
    messageId: 'source',
    duplicateMessageId: 'original-copy',
  }
  expect(
    (await run(f.queue.requestEffect(connection, '/api/tasks/queue', input, responses.queueAction)))
      ._tag,
  ).toBe('Failure')
  expect(f.stored()).toHaveLength(1)
  loseResponse = false
  const reopened = f.restart()
  expect(
    await run(
      reopened.requestEffect(
        connection,
        '/api/tasks/queue',
        { ...input, duplicateMessageId: 'candidate-after-remount' },
        responses.queueAction,
      ),
    ),
  ).toMatchObject({ _tag: 'Success', success: { ok: true, recovered: true } })
  expect(delivered.length).toBeGreaterThanOrEqual(2)
  expect(
    delivered.every(
      (command) =>
        command.receipt === 'operation-1' &&
        JSON.stringify(command.input) === JSON.stringify(input),
    ),
  ).toBe(true)
  expect(f.stored()).toEqual([])
  const next = { ...input, duplicateMessageId: 'intentional-second-copy' }
  expect((await run(reopened.requestEffect(connection, '/api/tasks/queue', next, ok)))._tag).toBe(
    'Success',
  )
  expect(delivered.at(-1)).toEqual({ receipt: 'operation-2', input: next })
})

it('settles a rejected stale queue move without blocking subsequent user actions', async () => {
  const f = fixture()
  let rejectMove = true
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (url) => {
      if (urlPath(url).endsWith('/status')) return Response.json({ version: 1, queueMutations: 1 })
      return rejectMove
        ? Response.json({ error: 'The queue changed', mutationRejected: true }, { status: 409 })
        : Response.json({ ok: true })
    }),
  )
  const input = {
    id: 'task',
    action: 'move',
    messageId: 'b',
    beforeMessageId: 'a',
    expectedMessageIds: ['a', 'b'],
  }
  expect((await run(f.queue.requestEffect(connection, '/api/tasks/queue', input, ok)))._tag).toBe(
    'Failure',
  )
  expect(f.stored()).toEqual([])
  expect(f.queue.status(connection).error).toBeNull()
  rejectMove = false
  expect(
    (
      await run(
        f.queue.requestEffect(
          connection,
          '/api/tasks/queue',
          { ...input, expectedMessageIds: ['a', 'c', 'b'] },
          ok,
        ),
      )
    )._tag,
  ).toBe('Success')
})

it('keeps foreground queue controls compatible with hosts without queue receipts', async () => {
  const f = fixture()
  const commands: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (url, init) => {
      if (urlPath(url).endsWith('/status')) return Response.json({ version: 1 })
      expect(new Headers(init?.headers).has('X-Dovo-Mutation-Id')).toBe(false)
      commands.push(urlPath(url))
      return Response.json({ ok: true })
    }),
  )
  expect(
    (
      await run(
        f.queue.requestEffect(
          connection,
          '/api/tasks/queue',
          { id: 'task', action: 'duplicate', messageId: 'a', duplicateMessageId: 'b' },
          ok,
        ),
      )
    )._tag,
  ).toBe('Success')
  expect(
    (
      await run(
        f.queue.requestEffect(connection, '/api/tasks/queue', { id: 'task', action: 'resume' }, ok),
      )
    )._tag,
  ).toBe('Success')
  expect(f.stored()).toEqual([])
  expect(commands).toHaveLength(2)
})
