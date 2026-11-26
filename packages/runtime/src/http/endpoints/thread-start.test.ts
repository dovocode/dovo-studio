import { afterEach, expect, it, vi } from 'vite-plus/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
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
import { deferred, runtimeIntegration, waitForRuntime } from '../../testing/integration'
import { fixture } from '../../testing/fixture.js'

vi.setConfig(runtimeIntegration)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
const token = 'thread-start-owner-token-at-least-32-characters'
const receiptCases = (
  await readFile(
    new URL('../../../../../verification/send-receipt-cases.jsonl', import.meta.url),
    'utf8',
  )
)
  .trim()
  .split('\n')
  .map(
    (line) =>
      JSON.parse(line) as {
        input: { loseReply: boolean; failRemoval: boolean; loseCompaction: boolean }
        acceptedBeforeRestart: boolean
        savedAfterFirstRemoval: boolean
        finalReceipt: 'full' | 'retired'
        admissions: number
      },
  )

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
    root,
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

it('accepts a new worktree send and its follow-up before setup finishes', async () => {
  const f = await setup()
  const git = await fixture()
  cleanups.push(git.cleanup)
  const s = f.runtime.services
  s.store.update((workspace) => ({ ...workspace, ...git.workspace }))
  s.preferences.save({ worktreesRoot: join(f.root, 'worktrees') })
  const entered = deferred<void>()
  const setupDone = deferred<void>()
  vi.spyOn(s.git, 'setupWorktree').mockImplementation(async () => {
    entered.resolve()
    await setupDone.promise
    return ''
  })
  const task: Task = {
    ...f.draft('First worktree prompt'),
    repositoryId: 'repo',
    execution: 'worktree',
    setupCommand: 'echo Setup',
  }
  try {
    expect((await f.startThread(task, 'first')).status).toBe(200)
    await entered.promise
    expect(f.runtime.run).not.toHaveBeenCalled()
    expect(
      (
        await f.request('/api/tasks/message', {
          id: task.id,
          messageId: 'second',
          text: 'Second worktree prompt',
        })
      ).status,
    ).toBe(200)
    expect(f.sent(task.id).map(({ id }) => id)).toEqual(['first', 'second'])
    setupDone.resolve()
    await waitForRuntime(() => {
      expect(f.runtime.run).toHaveBeenCalledTimes(2)
      expect(s.store.taskSummary(task.id).activeRunId).toBeUndefined()
    })
    expect(f.runtime.run.mock.calls.map(([run]) => run.prompt)).toEqual([
      'user: First worktree prompt',
      'user: Second worktree prompt',
    ])
  } finally {
    setupDone.resolve()
  }
})

it('keeps the registered checkout when Stop interrupts setup during a side chat', async () => {
  const f = await setup()
  const git = await fixture()
  cleanups.push(git.cleanup)
  const s = f.runtime.services
  s.store.update((workspace) => ({ ...workspace, ...git.workspace }))
  s.preferences.save({ worktreesRoot: join(f.root, 'worktrees') })
  s.titles.save({ agentId: 'agent', model: 'utility-model', reasoning: '' })
  const entered = deferred<string>()
  const setupDone = deferred<void>()
  const sideStarted = deferred<string>()
  const sideDone = deferred<void>()
  vi.spyOn(s.git, 'setupWorktree')
    .mockRejectedValueOnce(new Error('First setup attempt failed'))
    .mockImplementation(async (cwd, _command, signal) => {
      entered.resolve(cwd)
      await setupDone.promise
      signal?.throwIfAborted()
      return ''
    })
  f.runtime.run.mockImplementation(async (run) => {
    if (!run.prompt.includes('Read hello.txt')) {
      run.onText('Done')
      return
    }
    sideStarted.resolve(run.cwd)
    await sideDone.promise
    run.onText(await readFile(join(run.cwd, 'hello.txt'), 'utf8'))
  })
  const task: Task = {
    ...f.draft(),
    repositoryId: 'repo',
    execution: 'worktree',
    setupCommand: 'echo Setup',
  }
  let side: Promise<Response> | undefined
  let retry: Promise<Response> | undefined
  try {
    expect((await f.startThread(task, 'first')).status).toBe(200)
    await waitForRuntime(() => expect(s.store.taskSummary(task.id).status).toBe('failed'))
    const cwd = await s.checkouts.fileDirectory(task.id)
    const { id: chatId } = s.titles.saveSideChat({ id: task.id })
    side = f.request('/api/tasks/side-chat/ask', {
      id: task.id,
      chatId,
      question: 'Read hello.txt',
    })
    expect(
      await Promise.race([sideStarted.promise, side.then((response) => response.status)]),
    ).toBe(cwd)
    retry = f.request('/api/tasks/retry-failed', { id: task.id })
    expect((await retry).status).toBe(200)
    expect(await entered.promise).toBe(cwd)
    expect(
      (
        await f.request('/api/tasks/cancel', {
          id: task.id,
          runId: s.store.taskSummary(task.id).activeRunId,
        })
      ).status,
    ).toBe(200)
    setupDone.resolve()
    await waitForRuntime(() => expect(s.store.taskSummary(task.id).activeRunId).toBeUndefined())
    expect(await s.checkouts.fileDirectory(task.id)).toBe(cwd)
    expect(s.store.taskSummary(task.id).worktreeSetupComplete).toBe(false)
    sideDone.resolve()
    const answer = await side
    expect(answer.status).toBe(200)
    expect(await answer.json()).toMatchObject({ answer: 'original' })
  } finally {
    setupDone.resolve()
    sideDone.resolve()
    await Promise.all([side, retry])
  }
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

it.each(receiptCases)(
  'follows the Lean send receipt case $input',
  async ({ input, acceptedBeforeRestart, savedAfterFirstRemoval, finalReceipt, admissions }) => {
    const f = await setup()
    const task = f.draft('Keep this first message')
    const actionId = 'receipt-conformance'
    const message = threadStartMessage({ id: task.id, messageId: 'first', text: task.draft }, task)
    const connection = { address: `http://127.0.0.1:${f.runtime.port}`, token }
    let saved: MutationOutbox = []
    let failRemoval = false
    const client = () =>
      new RuntimeMutations({
        id: () => actionId,
        read: async () => structuredClone(saved),
        clear: async () => {
          saved = []
        },
        update: async (_, change) => {
          const next = change(structuredClone(saved))
          if (failRemoval && !next.length) throw new Error('Local journal unavailable')
          saved = next
          return saved
        },
      })
    let dropReply = input.loseReply
    let compactions = 0
    const fetchRuntime = globalThis.fetch
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (resource, init) => {
      const url = new URL(resource instanceof Request ? resource.url : resource)
      if (url.pathname === '/api/mutations/acknowledge') {
        compactions++
        if (input.loseCompaction) throw new TypeError('Compaction request lost')
      }
      // The disposable runtime can obtain a different loopback port on restart.
      url.port = String(f.runtime.port)
      const response = await fetchRuntime(url, init)
      if (dropReply && url.pathname === '/api/tasks/message' && response.ok) {
        await response.body?.cancel()
        throw new TypeError('Send reply lost')
      }
      return response
    })

    const initial = client()
    await Effect.runPromise(
      initial.enqueueEffect(connection, '/api/tasks/message', message, responses.ok),
    )
    const reply = await Effect.runPromise(Effect.result(initial.recoverEffect(connection)))
    expect(reply._tag === 'Success').toBe(acceptedBeforeRestart)
    expect(saved).toHaveLength(1)
    expect(f.runtime.services.mutations.status('owner', actionId).status).toBe('succeeded')
    await waitForRuntime(() => {
      expect(f.runtime.run).toHaveBeenCalledTimes(admissions)
      expect(f.runtime.services.store.task(task.id).activeRunId).toBeUndefined()
    })

    await f.restart()
    dropReply = false
    const recovered = client()
    await Effect.runPromise(recovered.recoverEffect(connection))
    expect(saved).toHaveLength(1)
    expect(compactions).toBe(0)
    failRemoval = input.failRemoval
    const cached = [f.runtime.services.store.task(task.id)]
    const result = await Effect.runPromise(
      Effect.result(recovered.taskCreationsCachedEffect(connection, cached)),
    )
    expect(result._tag === 'Failure').toBe(savedAfterFirstRemoval)
    expect(saved.length > 0).toBe(savedAfterFirstRemoval)
    const beforeRetry = savedAfterFirstRemoval
      ? [compactions, f.runtime.services.mutations.status('owner', actionId).status]
      : undefined
    expect(beforeRetry).toEqual(savedAfterFirstRemoval ? [0, 'succeeded'] : undefined)
    if (savedAfterFirstRemoval) {
      failRemoval = false
      await Effect.runPromise(recovered.taskCreationsCachedEffect(connection, cached))
    }
    expect(saved).toEqual([])
    await waitForRuntime(() => {
      expect(compactions).toBe(1)
      expect(f.runtime.services.mutations.status('owner', actionId).status).toBe(
        finalReceipt === 'retired' ? 'uncertain' : 'succeeded',
      )
    })
    const replay = await f.request('/api/tasks/message', message, 'POST', actionId)
    expect(replay.status).toBe(finalReceipt === 'retired' ? 409 : 200)
    expect((await replay.json()).mutationRetired === true).toBe(finalReceipt === 'retired')
    expect(f.sent(task.id)).toHaveLength(admissions)
    expect(f.runtime.run).not.toHaveBeenCalled()
  },
)

it('preserves the follow-up identity after dequeue and restart', async () => {
  const f = await setup()
  const task = f.draft()
  expect((await f.startThread(task, 'first')).status).toBe(200)
  await waitForRuntime(() => expect(f.runtime.run).toHaveBeenCalledTimes(1))
  const followUp = { id: task.id, messageId: 'follow-up', text: 'Keep going' }
  expect((await f.request('/api/tasks/message', followUp)).status).toBe(200)
  await waitForRuntime(() => {
    const started = f.runtime.services.store.task(task.id)
    expect(started.messages).toContainEqual(expect.objectContaining({ id: followUp.messageId }))
    expect(started.activeRunId).toBeUndefined()
  })
  const accepted = f.sent(task.id)

  await f.restart()
  expect((await f.request('/api/tasks/message', followUp)).status).toBe(200)
  expect(
    (await f.request('/api/tasks/message', { ...followUp, text: 'Changed input' })).status,
  ).toBe(409)
  expect(f.sent(task.id)).toEqual(accepted)
  expect(f.runtime.run).not.toHaveBeenCalled()
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
