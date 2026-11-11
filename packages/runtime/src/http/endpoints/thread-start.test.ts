import { afterEach, expect, it, vi } from 'vite-plus/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Effect } from 'effect'
import {
  RuntimeMutations,
  SCRATCH_PROJECT_ID,
  decode,
  defaultTaskHarness,
  responses,
  snapshotSchema,
  threadStartMessage,
  threadStartResultSchema,
  type MutationOutbox,
  type Task,
} from '@dovo/protocol'
import { startRuntime } from '../../index'
import type { AgentAdapter } from '../../agents/execution/types'
import { runtimeIntegration, waitForRuntime } from '../../testing/integration'

vi.setConfig(runtimeIntegration)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
const token = 'thread-start-owner-token-at-least-32-characters'

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'dovo-thread-start-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const databasePath = join(root, 'runtime.sqlite')
  let runtime = await start()
  async function start() {
    const started = await startRuntime({ databasePath, ownerToken: token, port: 0 })
    const run = vi.fn<AgentAdapter['run']>(async (input) => {
      input.onSession('provider-session')
      input.onText('Done')
    })
    vi.spyOn(started.services.agents, 'get').mockResolvedValue({
      probe: vi.fn<AgentAdapter['probe']>(),
      run,
    })
    return Object.assign(started, { run })
  }
  cleanups.push(() => runtime.close())
  const requests: string[] = []
  const request = (path: string, input?: unknown, method = 'POST', mutationId?: string) => {
    requests.push(`${method} ${path}`)
    return fetch(`http://127.0.0.1:${runtime.port}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(mutationId ? { 'x-dovo-mutation-id': mutationId } : {}),
      },
      body: input === undefined ? undefined : JSON.stringify(input),
    })
  }
  const draft = (text = 'Start here'): Task => ({
    id: randomUUID(),
    repositoryId: SCRATCH_PROJECT_ID,
    title: 'New thread',
    agentId: '',
    harness: defaultTaskHarness('codex'),
    execution: 'main',
    status: 'draft',
    createdAt: new Date().toISOString(),
    messages: [],
    files: [],
    draft: text,
    example: false,
  })
  const startThread = (task: Task, messageId: string, extra = {}, mutationId?: string) =>
    request(
      '/api/tasks/message',
      {
        id: task.id,
        messageId,
        text: task.draft,
        initialTitle: { before: task.title, after: task.draft.slice(0, 80) },
        createTask: task,
        ...extra,
      },
      'POST',
      mutationId,
    )
  const tasks = () => runtime.services.store.get().tasks
  const sent = (id: string) => {
    const task = runtime.services.store.task(id)
    return [...task.messages, ...(task.queue ?? [])].filter((message) => message.role === 'user')
  }
  return {
    get runtime() {
      return runtime
    },
    async restart() {
      await runtime.close()
      runtime = await start()
    },
    request,
    requests,
    draft,
    startThread,
    tasks,
    sent,
  }
}

it('advertises thread starts in the snapshot', async () => {
  const f = await setup()
  const response = await f.request('/api/snapshot', undefined, 'GET')
  expect(decode(snapshotSchema, await response.json()).threadStartSupported).toBe(true)
})

it('creates the draft and accepts its first message in one request', async () => {
  const f = await setup()
  const task = f.draft()
  const response = await f.startThread(task, 'first')
  expect(response.status).toBe(200)
  expect(f.requests).toEqual(['POST /api/tasks/message'])
  expect(f.sent(task.id).map((message) => message.text)).toEqual(['Start here'])
  // The runtime consumes the sent draft and applies the first title exactly as before.
  const created = f.runtime.services.store.task(task.id)
  expect(created).toMatchObject({
    draft: '',
    title: 'Start here',
    repositoryId: SCRATCH_PROJECT_ID,
  })
  await waitForRuntime(() => expect(f.runtime.run).toHaveBeenCalledTimes(1))
})

it('retries a lost response, a receipt replay and a restart without duplicates', async () => {
  const f = await setup()
  const task = f.draft()
  expect((await f.startThread(task, 'first', {}, 'mutation-1')).status).toBe(200)
  // Lost response: the receipt returns the original acknowledgement.
  expect((await f.startThread(task, 'first', {}, 'mutation-1')).status).toBe(200)
  // A client without the receipt, for example after renewing its credential.
  expect((await f.startThread(task, 'first')).status).toBe(200)
  await f.restart()
  expect((await f.startThread(task, 'first')).status).toBe(200)
  expect(f.tasks().filter((item) => item.id === task.id)).toHaveLength(1)
  expect(f.sent(task.id)).toHaveLength(1)
})

it('preserves an existing thread instead of overwriting it', async () => {
  const f = await setup()
  const task = f.draft()
  expect((await f.startThread(task, 'first')).status).toBe(200)
  // Another message cannot reuse the creation, and the same message cannot change the draft.
  const other = await f.startThread({ ...task, draft: 'Other' }, 'second')
  expect(other.status).toBe(409)
  expect(await other.json()).toMatchObject({ mutationRejected: true })
  expect((await f.startThread({ ...task, title: 'Changed' }, 'first')).status).toBe(409)
  expect(f.sent(task.id).map((message) => message.text)).toEqual(['Start here'])

  // A draft created by a separate workspace edit has no thread-start owner.
  const saved = f.draft('Saved draft')
  const created = await f.request(
    '/api/workspace',
    { collection: 'tasks', id: saved.id, create: saved, changes: {} },
    'PATCH',
  )
  expect(created.status).toBe(200)
  expect((await f.startThread({ ...saved, draft: 'Replacement' }, 'new')).status).toBe(409)
  expect(f.runtime.services.store.task(saved.id)).toMatchObject({ draft: 'Saved draft' })
  expect(f.sent(saved.id)).toHaveLength(0)
})

it('never resurrects a deleted thread', async () => {
  const f = await setup()
  const task = f.draft()
  expect((await f.startThread(task, 'first')).status).toBe(200)
  await waitForRuntime(() =>
    expect(f.runtime.services.store.task(task.id).activeRunId).toBeUndefined(),
  )
  const deleted = await f.request('/api/tasks/lifecycle', { id: task.id, action: 'delete' })
  expect(deleted.status).toBe(200)
  await waitForRuntime(() => expect(f.tasks().some((item) => item.id === task.id)).toBe(false))
  const retry = await f.startThread(task, 'first')
  expect(retry.status).toBe(409)
  await f.restart()
  expect((await f.startThread(task, 'first')).status).toBe(409)
  expect(f.tasks().some((item) => item.id === task.id)).toBe(false)
})

it('acknowledges the snapshot cursor that contains the thread', async () => {
  const f = await setup()
  const task = f.draft()
  const response = await f.startThread(task, 'first', {}, 'cursor')
  const ack = decode(threadStartResultSchema, await response.json())
  expect(ack).toMatchObject({ ok: true, runtimeInstanceId: f.runtime.services.instanceId })
  const snapshot = decode(
    snapshotSchema,
    await (await f.request('/api/snapshot', undefined, 'GET')).json(),
  )
  expect(snapshot.runtimeInstanceId).toBe(ack.runtimeInstanceId)
  expect(snapshot.revision).toBeGreaterThanOrEqual(ack.revision ?? Infinity)
  const listed = snapshot.workspace.tasks.find((item) => item.id === task.id)
  expect(listed).toBeDefined()
})

it('replays a lost acknowledgement after deletion without recreating the thread', async () => {
  const f = await setup()
  const task = f.draft()
  const first = decode(
    threadStartResultSchema,
    await (await f.startThread(task, 'first', {}, 'lost-ack')).json(),
  )
  await waitForRuntime(() =>
    expect(f.runtime.services.store.task(task.id).activeRunId).toBeUndefined(),
  )
  expect((await f.request('/api/tasks/lifecycle', { id: task.id, action: 'delete' })).status).toBe(
    200,
  )
  await waitForRuntime(() => expect(f.tasks().some((item) => item.id === task.id)).toBe(false))
  const snapshot = async () =>
    decode(snapshotSchema, await (await f.request('/api/snapshot', undefined, 'GET')).json())
  // The receipt keeps the original success but reports the current cursor. A snapshot at that
  // cursor proves the thread is gone, so a client can settle its projected creation.
  const replay = decode(
    threadStartResultSchema,
    await (await f.startThread(task, 'first', {}, 'lost-ack')).json(),
  )
  expect(replay.ok).toBe(true)
  expect(replay.runtimeInstanceId).toBe(first.runtimeInstanceId)
  expect(replay.revision).toBeGreaterThan(first.revision ?? Infinity)
  const current = await snapshot()
  expect(current.revision).toBeGreaterThanOrEqual(replay.revision ?? Infinity)
  expect(current.workspace.tasks.some((item) => item.id === task.id)).toBe(false)
  expect(f.runtime.services.store.wasTaskDeleted(task.id)).toBe(true)

  // After a restart the replay names the new instance; new attempts stay rejected.
  await f.restart()
  const restarted = decode(
    threadStartResultSchema,
    await (await f.startThread(task, 'first', {}, 'lost-ack')).json(),
  )
  expect(restarted.runtimeInstanceId).toBe(f.runtime.services.instanceId)
  expect(restarted.runtimeInstanceId).not.toBe(first.runtimeInstanceId)
  expect((await f.startThread(task, 'first', {}, 'new-attempt')).status).toBe(409)
  expect((await f.startThread(task, 'first')).status).toBe(409)
  expect((await snapshot()).workspace.tasks.some((item) => item.id === task.id)).toBe(false)
})

it('rejects invalid drafts before creating anything', async () => {
  const f = await setup()
  const task = f.draft()
  // Runtime-owned state cannot be injected through a new draft.
  const attempts: Array<[unknown, Record<string, unknown>]> = [
    [{ ...task, id: randomUUID() }, {}],
    [{ ...task, status: 'running' }, {}],
    [{ ...task, providerLock: 'codex' }, {}],
    [{ ...task, sessionId: 'provider-session' }, {}],
    [{ ...task, queue: [] }, {}],
    [
      {
        ...task,
        messages: [{ id: 'old', role: 'user', text: 'Injected', createdAt: task.createdAt }],
      },
      {},
    ],
    [task, { attachmentIds: [randomUUID()] }],
    [task, { sendNow: true }],
  ]
  for (const [createTask, extra] of attempts) {
    const response = await f.request('/api/tasks/message', {
      id: task.id,
      messageId: 'first',
      text: 'Start here',
      createTask,
      ...extra,
    })
    expect({ status: response.status, createTask }).toMatchObject({ status: 400 })
  }
  const steer = await f.request('/api/tasks/steer', {
    id: task.id,
    messageId: 'first',
    text: 'Start here',
    runId: 'run',
    createTask: task,
  })
  expect(steer.status).toBe(400)
  expect(f.tasks().some((item) => item.id === task.id)).toBe(false)
  // The valid request still works with the same identities.
  expect((await f.startThread(task, 'first')).status).toBe(200)
})

it('rejects runtime state copied from a started thread', async () => {
  const f = await setup()
  const source = f.draft()
  expect((await f.startThread(source, 'first')).status).toBe(200)
  await waitForRuntime(() =>
    expect(f.runtime.services.store.task(source.id)).toMatchObject({
      activeRunId: undefined,
      sessionId: 'provider-session',
    }),
  )
  const started: Record<string, unknown> = { ...f.runtime.services.store.task(source.id) }
  const fresh: Record<string, unknown> = { ...f.draft() }
  // Next-message settings are draft configuration; the rest belongs to the runtime.
  const copied = Object.keys(started).filter(
    (key) => started[key] !== undefined && fresh[key] === undefined && key !== 'draftTurnSettings',
  )
  // A real run leaves provider, history, lock and prompt state behind.
  expect(copied).toEqual(
    expect.arrayContaining([
      'sessionId',
      'sessionAgentId',
      'providerLock',
      'checkoutLocked',
      'queue',
      'queuePaused',
      'turns',
      'consumedMessageIds',
      'draftConsumption',
      'subagentInbox',
      'lastPromptAt',
      'updatedAt',
    ]),
  )
  const attempts = [
    { ...started, id: randomUUID() },
    ...copied.map((key) => ({ ...f.draft(), [key]: started[key] })),
  ]
  for (const createTask of attempts) {
    const id = String(createTask.id)
    const response = await f.request('/api/tasks/message', {
      id,
      messageId: 'copy',
      text: 'Start here',
      createTask,
    })
    expect({ status: response.status, fields: Object.keys(createTask) }).toMatchObject({
      status: 400,
    })
    expect(f.tasks().some((item) => item.id === id)).toBe(false)
  }
})

it('starts a thread through the real outbox with one durable command', async () => {
  const f = await setup()
  const connection = { address: `http://127.0.0.1:${f.runtime.port}`, token }
  let pending: MutationOutbox = []
  let serial = 0
  const outbox = new RuntimeMutations({
    id: () => `thread-start-${++serial}`,
    read: async () => pending,
    clear: async () => {
      pending = []
    },
    update: async (_, change) => {
      pending = change(pending)
      return pending
    },
  })
  const sent: string[] = []
  const realFetch = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
    sent.push(
      `${init?.method ?? 'GET'} ${new URL(url instanceof Request ? url.url : url).pathname}`,
    )
    return realFetch(url, init)
  })
  const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)

  // Deferred send: durable local admission returns before any network request.
  const deferred = f.draft('Deferred start')
  const deferredInput = threadStartMessage(
    { id: deferred.id, messageId: 'deferred', text: deferred.draft },
    deferred,
  )
  expect(
    await run(outbox.enqueueEffect(connection, '/api/tasks/message', deferredInput, responses.ok)),
  ).toMatchObject({ ok: true, pending: true })
  expect(sent).toEqual([])
  expect(outbox.pendingTasks(connection, []).map((task) => task.id)).toEqual([deferred.id])
  expect(f.tasks().some((task) => task.id === deferred.id)).toBe(false)
  await run(outbox.recoverEffect(connection))
  // The receipt acknowledgement waits until the thread is cached.
  expect(sent.filter((request) => !request.startsWith('GET '))).toEqual(['POST /api/tasks/message'])
  expect(f.sent(deferred.id).map((message) => message.id)).toEqual(['deferred'])
  // The created thread stays projected until a cached snapshot contains its message.
  expect(outbox.pendingTasks(connection, []).map((task) => task.id)).toEqual([deferred.id])
  expect(pending).toHaveLength(1)
  const cached = [f.runtime.services.store.task(deferred.id)]
  await run(outbox.taskCreationsCachedEffect(connection, cached))
  outbox.acknowledgeMessages(connection, cached)
  expect(pending).toEqual([])
  expect(outbox.pendingTasks(connection, [])).toEqual([])
  expect(sent).toContain('POST /api/mutations/acknowledge')

  // Foreground send: one message request creates the thread; no workspace creation edit.
  sent.length = 0
  const foreground = f.draft('Foreground start')
  const foregroundInput = threadStartMessage(
    { id: foreground.id, messageId: 'foreground', text: foreground.draft },
    foreground,
  )
  expect(
    await run(
      outbox.requestEffect(connection, '/api/tasks/message', foregroundInput, responses.ok),
    ),
  ).toMatchObject({ ok: true })
  expect(sent.filter((request) => request.includes('/api/workspace'))).toEqual([])
  expect(sent.filter((request) => request === 'POST /api/tasks/message')).toHaveLength(1)
  expect(f.sent(foreground.id).map((message) => message.id)).toEqual(['foreground'])
  expect(f.runtime.services.store.task(foreground.id).draft).toBe('')
})
