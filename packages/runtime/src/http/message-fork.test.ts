import { afterEach, expect, it, vi } from 'vite-plus/test'
import { randomUUID } from 'node:crypto'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { defaultTaskHarness, resolveTaskAgent, type Task } from '@dovo/protocol'
import { startRuntime } from '../index.js'
import { fixture } from '../testing/fixture.js'
import { waitForRuntime } from '../testing/integration.js'
import type { AgentAdapter, AgentRun } from '../agents/execution/types.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const close of cleanups.splice(0).reverse()) await close()
})

async function setup() {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const token = 'message-fork-owner-token-at-least-32-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanups.push(runtime.close)
  const s = runtime.services
  // The project starts new threads in worktrees; the source thread uses the main checkout.
  s.store.update(() => ({
    ...f.workspace,
    repositories: f.workspace.repositories.map((repo) => ({
      ...repo,
      taskDefaults: { execution: 'worktree' as const },
    })),
  }))
  const created = s.tasks.create({
    title: 'Source thread',
    repositoryId: 'repo',
    agentId: '',
    harness: { ...defaultTaskHarness('claude'), model: 'source-model', permission: 'read-only' },
    execution: 'main',
    objective: '',
  })
  const attachment = { id: randomUUID(), name: 'notes.txt', mime: 'text/plain', size: 5 }
  s.db
    .prepare('INSERT INTO attachments VALUES(?,?,?,?)')
    .run(attachment.id, created.id, JSON.stringify(attachment), Buffer.from('notes'))
  const startedAt = new Date().toISOString()
  const turn = (
    id: string,
    assistantId: string,
    status: 'completed' | 'running' = 'completed',
  ) => ({
    id,
    assistantId,
    agentId: '',
    provider: 'claude' as const,
    model: 'source-model',
    status,
    startedAt,
  })
  s.store.updateTaskHistory(created.id, (task) => ({
    ...task,
    status: 'review',
    sessionId: 'source-provider-session',
    messages: [
      {
        id: 'user-1',
        role: 'user',
        text: 'First request',
        turnId: 't1',
        attachments: [attachment],
      },
      { id: 'answer-1', role: 'assistant', text: 'First answer', turnId: 't1' },
      { id: 'user-2', role: 'user', text: 'Second request', turnId: 't2' },
      { id: 'answer-2', role: 'assistant', text: 'Second answer', turnId: 't2' },
    ],
    turns: [turn('t1', 'answer-1'), turn('t2', 'answer-2')],
  }))
  const post = async (path: string, input: unknown) => {
    const response = await fetch(`http://127.0.0.1:${runtime.port}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    const text = await response.text()
    return { status: response.status, text, body: text ? (JSON.parse(text) as unknown) : null }
  }
  const runs: AgentRun[] = []
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      runs.push(run)
      run.onText('Fork reply')
    },
  })
  return { f, s, runtime, token, source: s.store.task(created.id), attachment, turn, post, runs }
}

async function sendAndWait(
  s: Awaited<ReturnType<typeof setup>>['s'],
  post: Awaited<ReturnType<typeof setup>>['post'],
  id: string,
  text: string,
) {
  const sent = await post('/api/tasks/message', {
    id,
    messageId: randomUUID(),
    text,
    attachmentIds: [],
  })
  expect(sent.status).toBe(200)
  await waitForRuntime(() => {
    const task = s.store.taskSummary(id)
    expect(task.status).not.toBe('draft')
    expect(task.status).not.toBe('running')
  })
}

it('forks settled history into a fresh thread and leaves the source unchanged', async () => {
  const { f, s, runtime, token, source, attachment, post, runs } = await setup()
  await writeFile(join(f.directory, 'hello.txt'), 'Source edit\n')
  const snapshot = (await (
    await fetch(`http://127.0.0.1:${runtime.port}/api/snapshot`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json()) as { messageForkSupported?: boolean }
  expect(snapshot.messageForkSupported).toBe(true)

  const input = { id: source.id, messageId: 'answer-1', forkId: randomUUID() }
  const response = await post('/api/tasks/fork-message', input)
  expect(response.status).toBe(200)
  expect(response.body).toEqual({ id: input.forkId })
  // A lost reply can be retried without a second thread.
  expect((await post('/api/tasks/fork-message', input)).body).toEqual({ id: input.forkId })
  expect((await post('/api/tasks/fork-message', { ...input, messageId: 'answer-2' })).status).toBe(
    409,
  )
  expect(s.store.get().tasks.filter((task) => task.forkedFrom?.taskId === source.id)).toHaveLength(
    1,
  )
  expect(s.store.task(source.id)).toEqual(source)

  const fork = s.store.task(input.forkId)
  expect(fork).toMatchObject({
    status: 'draft',
    repositoryId: 'repo',
    execution: 'worktree',
    forkedFrom: { taskId: source.id, messageId: 'answer-1', title: 'Source thread' },
  })
  expect(fork.sessionId).toBeUndefined()
  expect(fork.turns).toBeUndefined()
  expect(fork.messages.map((message) => message.text)).toEqual(['First request', 'First answer'])
  expect(resolveTaskAgent(fork, s.store.get().agents)).toMatchObject({
    provider: 'claude',
    model: 'source-model',
    permission: 'read-only',
  })
  const copied = fork.messages[0]?.attachments?.[0]
  expect(copied?.id).not.toBe(attachment.id)
  expect(s.attachments.read(fork.id, copied?.id ?? '').data).toBe(
    Buffer.from('notes').toString('base64'),
  )

  await sendAndWait(s, post, fork.id, 'Try another direction')
  expect(runs).toHaveLength(1)
  const [run] = runs
  expect(run?.sessionId).toBeUndefined()
  expect(run?.prompt).toContain('First request')
  expect(run?.prompt).toContain('First answer')
  expect(run?.prompt).toContain('Try another direction')
  expect(run?.prompt).not.toContain('Second request')
  expect(run?.prompt).not.toContain('Second answer')
  // Files are not rewound: the fork uses a new worktree and the source edit stays in place.
  const forkCwd = await s.checkouts.directory(fork.id)
  cleanups.push(() => rm(forkCwd, { recursive: true, force: true }))
  expect(run?.cwd).toBe(forkCwd)
  expect(forkCwd).not.toBe(f.directory)
  expect(await readFile(join(forkCwd, 'hello.txt'), 'utf8')).toBe('original\n')
  expect(await readFile(join(f.directory, 'hello.txt'), 'utf8')).toBe('Source edit\n')
  expect(s.store.task(source.id).sessionId).toBe('source-provider-session')
})

it('forks from a user message and sends that request with the next message', async () => {
  const { s, source, post, runs } = await setup()
  s.store.update((workspace) => ({
    ...workspace,
    repositories: workspace.repositories.map((repo) => ({
      ...repo,
      taskDefaults: { execution: 'main' as const },
    })),
  }))
  const forkId = randomUUID()
  expect(
    (await post('/api/tasks/fork-message', { id: source.id, messageId: 'user-2', forkId })).status,
  ).toBe(200)
  const fork = s.store.task(forkId)
  expect(fork.execution).toBe('main')
  expect(fork.messages.map((message) => message.id)).toEqual(['user-1', 'answer-1', 'user-2'])
  expect(fork.messages.at(-1)?.turnId).toBeUndefined()

  await sendAndWait(s, post, forkId, 'Also check the edge cases')
  expect(runs[0]?.prompt).toContain('Second request')
  expect(runs[0]?.prompt).toContain('Also check the edge cases')
  expect(runs[0]?.prompt).not.toContain('Second answer')
  const forked = s.store.task(forkId)
  const turnId = forked.turns?.at(-1)?.id
  expect(forked.messages.find((message) => message.id === 'user-2')?.turnId).toBe(turnId)
})

it('refuses unsettled messages and thread kinds that stay with their execution', async () => {
  const { s, source, turn, post } = await setup()
  const fork = async (messageId: string) =>
    post('/api/tasks/fork-message', { id: source.id, messageId, forkId: randomUUID() })
  s.store.updateTaskHistory(source.id, (task) => ({
    ...task,
    status: 'running',
    messages: [
      ...task.messages,
      { id: 'user-3', role: 'user', text: 'Third request', turnId: 't3' },
      { id: 'answer-3', role: 'assistant', text: 'Working', turnId: 't3' },
      { id: 'comment', role: 'user', text: 'Rename this', file: 'hello.txt' },
    ],
    turns: [...(task.turns ?? []), turn('t3', 'answer-3', 'running')],
  }))
  for (const messageId of ['user-3', 'answer-3']) {
    const refused = await fork(messageId)
    expect(refused.status).toBe(409)
    expect(refused.text).toContain('Wait for this turn to finish')
  }
  // Earlier settled history can be forked while a later turn runs.
  expect((await fork('answer-2')).status).toBe(200)
  expect((await fork('comment')).text).toContain('review comment')
  expect((await fork('missing')).status).toBe(404)
  expect(
    (await post('/api/tasks/fork-message', { id: 'missing', messageId: 'x', forkId: randomUUID() }))
      .status,
  ).toBe(404)

  const restrictions: Array<[Partial<Task>, string]> = [
    [
      { delegation: { parentTaskId: 'parent', parentRunId: 'run', key: 'child' } },
      'Delegated child threads',
    ],
    [
      {
        importedCodexSession: {
          key: 'import',
          sessionId: 'native',
          home: '/codex',
          transcriptPath: '/codex/session.jsonl',
          cwd: '/project',
          importedAt: new Date().toISOString(),
        },
      },
      'Imported',
    ],
    [
      { machineHandoff: { id: randomUUID(), targetRuntimeId: 'other', state: 'moved' } },
      'computer transfer',
    ],
  ]
  for (const [fields, reason] of restrictions) {
    s.store.updateTask(source.id, (task) => ({ ...task, status: 'review', ...fields }))
    const refused = await fork('answer-1')
    expect(refused.status).toBe(409)
    expect(refused.text).toContain(reason)
    s.store.updateTask(source.id, (task) => ({
      ...task,
      delegation: undefined,
      importedCodexSession: undefined,
      machineHandoff: undefined,
    }))
  }
  // A deleted fork ID is not reused for another thread.
  const forkId = randomUUID()
  expect(
    (await post('/api/tasks/fork-message', { id: source.id, messageId: 'answer-1', forkId }))
      .status,
  ).toBe(200)
  expect((await post('/api/tasks/lifecycle', { id: forkId, action: 'delete' })).status).toBe(200)
  const deleted = await post('/api/tasks/fork-message', {
    id: source.id,
    messageId: 'answer-1',
    forkId,
  })
  expect(deleted.status).toBe(409)
  expect(deleted.text).toContain('deleted')
})

it('copies attachments that history inherited from another thread', async () => {
  const { s, source, attachment, post } = await setup()
  // A turn fork owns copies of its files.
  const turnFork = await post('/api/tasks/fork', { id: source.id, turnId: 't1' })
  expect(turnFork.status).toBe(200)
  const turnForkId = s.store.get().tasks.find((task) => task.forkedFrom?.turnId === 't1')?.id ?? ''
  expect(turnFork.body).toEqual({ id: turnForkId })
  const turnCopy = s.store.task(turnForkId).messages[0]?.attachments?.[0]
  expect(turnCopy?.id).not.toBe(attachment.id)
  expect(s.attachments.read(turnForkId, turnCopy?.id ?? '').data).toBe(
    Buffer.from('notes').toString('base64'),
  )

  // A turn fork from an older runtime kept the source thread's attachment ID.
  const legacy = s.tasks.create({
    title: 'Older turn fork',
    repositoryId: 'repo',
    agentId: '',
    harness: defaultTaskHarness('claude'),
    execution: 'main',
    objective: '',
  }).id
  s.store.updateTaskHistory(legacy, (task) => ({
    ...task,
    status: 'review',
    messages: source.messages.slice(0, 2),
    turns: source.turns?.slice(0, 1),
  }))
  const forkFrom = async (id: string) => {
    const forkId = randomUUID()
    const response = await post('/api/tasks/fork-message', { id, messageId: 'answer-1', forkId })
    expect(response.status).toBe(200)
    return s.store.task(forkId)
  }
  for (const id of [turnForkId, legacy]) {
    const fork = await forkFrom(id)
    const file = fork.messages[0]?.attachments?.[0]
    expect(file).toMatchObject({ name: 'notes.txt' })
    expect(s.attachments.read(fork.id, file?.id ?? '').data).toBe(
      Buffer.from('notes').toString('base64'),
    )
  }

  // The original thread is deleted. Its file stays while history references it.
  expect((await post('/api/tasks/lifecycle', { id: source.id, action: 'delete' })).status).toBe(200)
  await s.attachments.prune()
  const afterDelete = await forkFrom(legacy)
  expect(afterDelete.messages[0]?.attachments).toHaveLength(1)

  // A file that is gone is left out. The message stays.
  s.db.prepare('DELETE FROM attachments WHERE id=?').run(attachment.id)
  const missing = await forkFrom(legacy)
  expect(missing.messages.map((message) => message.text)).toEqual(['First request', 'First answer'])
  expect(missing.messages[0]?.attachments).toEqual([])
})
