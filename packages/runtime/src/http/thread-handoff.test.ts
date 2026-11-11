import { afterEach, expect, it, vi } from 'vite-plus/test'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { defaultTaskHarness, lockedTaskProvider } from '@dovo/protocol'
import { startRuntime } from '../index.js'
import { fixture } from '../testing/fixture.js'
import type { AgentRun, AgentAdapter } from '../agents/execution/types.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const close of cleanups.splice(0).reverse()) await close()
})
async function setup() {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const token = 'thread-handoff-owner-token-at-least-32-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanups.push(runtime.close)
  const s = runtime.services
  s.store.update(() => f.workspace)
  const task = s.tasks.create({
    title: 'Keep this conversation',
    repositoryId: 'repo',
    agentId: 'agent',
    execution: 'main',
    objective: 'Implement the original request',
  })
  s.store.updateTaskHistory(task.id, (task) => ({
    ...task,
    status: 'review',
    sessionId: 'private-provider-session',
    sessionAgentId: 'old-fingerprint',
    contextUsage: { used: 400, limit: 500, updatedAt: new Date().toISOString() },
    nativeTodos: [{ id: 'todo', text: 'Finish the work', status: 'pending' }],
    messages: [
      ...task.messages,
      { id: 'answer', role: 'assistant', text: 'The first part is done.' },
    ],
    turns: [
      {
        id: 'old-turn',
        assistantId: 'answer',
        agentId: 'agent',
        provider: 'codex',
        model: 'old',
        status: 'completed',
        startedAt: new Date().toISOString(),
      },
    ],
  }))
  const post = (path: string, input: unknown, method = 'POST') =>
    fetch(`http://127.0.0.1:${runtime.port}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  return { f, s, task, post }
}
it('changes the current harness while keeping history, checklist, files and old provider facts', async () => {
  const { f, s, task, post } = await setup()
  await writeFile(join(f.directory, 'hello.txt'), 'Uncommitted work\n')
  const before = s.store.task(task.id)
  const input = {
    id: task.id,
    requestId: randomUUID(),
    harness: defaultTaskHarness('claude'),
    stop: false,
  }
  const response = await post('/api/tasks/continue-harness', input)
  expect(await response.text()).toBe('{"ok":true}')
  expect(response.status).toBe(200)
  const changed = s.store.task(task.id)
  expect(changed.messages).toEqual(before.messages)
  expect(changed.turns).toEqual(before.turns)
  expect(changed.nativeTodos).toEqual(before.nativeTodos)
  expect(changed.sessionId).toBeUndefined()
  expect(changed.contextUsage).toBeUndefined()
  expect(lockedTaskProvider(changed, s.store.get().agents)).toBe('claude')
  expect(changed.harnessHandoff?.checkpoint).toMatch(/^[a-f0-9]{40}$/)
  expect(
    await s.git.command(f.directory, ['show', `${changed.harnessHandoff?.checkpoint}:hello.txt`]),
  ).toBe('Uncommitted work\n')
  expect((await post('/api/tasks/continue-harness', input)).status).toBe(200)
  expect(
    (await post('/api/tasks/continue-harness', { ...input, harness: defaultTaskHarness('codex') }))
      .status,
  ).toBe(409)
  expect(
    (
      await post(
        '/api/workspace',
        {
          collection: 'tasks',
          id: task.id,
          changes: { harness: { before: changed.harness, after: defaultTaskHarness('codex') } },
        },
        'PATCH',
      )
    ).status,
  ).toBe(409)
  const calls: AgentRun[] = []
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      calls.push(run)
      run.onText('Continued safely')
    },
  })
  const run = await s.tasks.start(task.id)
  await run.done
  expect(calls).toHaveLength(1)
  expect(calls[0].sessionId).toBeUndefined()
  expect(calls[0].prompt).toContain('Implement the original request')
  expect(calls[0].prompt).toContain('The first part is done.')
  expect(calls[0].prompt).toContain('Finish the work')
  expect(s.store.task(task.id).turns?.at(-1)?.provider).toBe('claude')
})
it('rejects queued input and computer fences, including forged client handoff fields', async () => {
  const { s, task, post } = await setup()
  const input = {
    id: task.id,
    requestId: randomUUID(),
    harness: defaultTaskHarness('claude'),
    stop: false,
  }
  s.store.updateTask(task.id, (task) => ({
    ...task,
    queue: [{ id: 'queued', role: 'user', text: 'Do this next', createdAt: '' }],
  }))
  expect((await post('/api/tasks/continue-harness', input)).status).toBe(409)
  expect(s.store.task(task.id).sessionId).toBe('private-provider-session')
  s.store.updateTask(task.id, (task) => ({
    ...task,
    queue: undefined,
    machineHandoff: { id: input.requestId, targetRuntimeId: 'other', state: 'moved' },
  }))
  expect((await post('/api/tasks/continue-harness', input)).status).toBe(409)
  await expect(s.tasks.start(task.id)).rejects.toThrow(/another computer/)
  await expect(s.tasks.restoreTurn(task.id, 'old-turn', 'undo')).rejects.toThrow(/another computer/)
  await expect(s.tasks.restoreFile(task.id, 'hello.txt')).rejects.toThrow(/another computer/)
  expect(() => s.tasks.removeFeedback(task.id, 'old-message')).toThrow(/another computer/)
  await expect(s.tasks.send(task.id, 'new-message', 'Do not run twice')).rejects.toThrow(
    /another computer/,
  )
  expect(
    (
      await post(
        '/api/workspace',
        {
          collection: 'tasks',
          id: task.id,
          changes: {
            machineHandoff: { before: s.store.task(task.id).machineHandoff, after: null },
          },
        },
        'PATCH',
      )
    ).status,
  ).toBe(409)
})
it('waits for a stopped worker before changing its harness and keeps the partial reply', async () => {
  const { s, task, post } = await setup()
  let abortObserved = false
  let began!: () => void
  const started = new Promise<void>((resolve) => {
    began = resolve
  })
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      run.onText('Partial work before stop')
      began()
      await new Promise<void>((resolve) =>
        run.signal.addEventListener(
          'abort',
          () => {
            abortObserved = true
            resolve()
          },
          { once: true },
        ),
      )
    },
  })
  const active = await s.tasks.start(task.id)
  const stopped = active.done.then(
    () => undefined,
    (error: unknown) => error,
  )
  await started
  const denied = await post('/api/tasks/continue-harness', {
    id: task.id,
    requestId: randomUUID(),
    harness: defaultTaskHarness('claude'),
    stop: false,
  })
  expect(denied.status).toBe(409)
  expect(abortObserved).toBe(false)
  const response = await post('/api/tasks/continue-harness', {
    id: task.id,
    requestId: randomUUID(),
    harness: defaultTaskHarness('claude'),
    stop: true,
  })
  expect(response.status).toBe(200)
  expect(String(await stopped)).toContain('Cancelled by user')
  expect(abortObserved).toBe(true)
  expect(
    s.store
      .task(task.id)
      .messages.some((message) => message.text.includes('Partial work before stop')),
  ).toBe(true)
  expect(s.store.task(task.id).harness?.provider).toBe('claude')
  expect(s.store.task(task.id).status).toBe('review')
})
it('rechecks input after the stop boundary and preserves a racing message instead of leaving it behind', async () => {
  const { s, task, post } = await setup()
  const stop = s.tasks.stopForHandoff.bind(s.tasks)
  vi.spyOn(s.tasks, 'stopForHandoff').mockImplementation(async (...args) => {
    await stop(...args)
    s.store.updateTask(task.id, (task) => ({
      ...task,
      queue: [{ id: 'racing-input', role: 'user', text: 'Keep this late input', createdAt: '' }],
    }))
  })
  const response = await post('/api/tasks/continue-harness', {
    id: task.id,
    requestId: randomUUID(),
    harness: defaultTaskHarness('claude'),
    stop: false,
  })
  expect(response.status).toBe(409)
  expect(s.store.task(task.id).queue?.[0]?.text).toBe('Keep this late input')
  expect(s.store.task(task.id).harness?.provider ?? 'codex').toBe('codex')
  expect(s.store.task(task.id).harnessHandoff).toBeUndefined()
})
