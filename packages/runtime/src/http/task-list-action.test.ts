import { afterEach, expect, it, vi } from 'vite-plus/test'
import { Schema } from 'effect'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decode, questionPromptSchema, type Task } from '@dovo/protocol'
import { startRuntime } from '../index'
import { taskListAction } from './endpoints/task-list-action'

const token = 'thread-list-action-test-token-at-least-32-characters'
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const close of cleanup.splice(0)) await close()
})
const task: Task = {
  id: 'parent',
  title: 'Parent',
  agentId: '',
  repositoryId: '',
  status: 'draft',
  createdAt: '2026-09-23T00:00:00Z',
  messages: [],
  files: [],
  draft: '',
  example: false,
  snoozedUntil: '2026-11-01T00:00:00Z',
}
const resultSchema = Schema.Struct({ ok: Schema.Boolean, undo: Schema.String })

async function setup() {
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanup.push(runtime.close)
  runtime.services.store.update((workspace) => ({
    ...workspace,
    tasks: [
      task,
      {
        ...task,
        id: 'child',
        archived: true,
        autoSettled: true,
        snoozedUntil: '2026-11-02T00:00:00Z',
        delegation: { parentTaskId: 'parent', parentRunId: 'finished', key: 'child' },
      },
    ],
  }))
  const send = (input: unknown, mutationId?: string) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/tasks/list-action`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(mutationId ? { 'x-dovo-mutation-id': mutationId } : {}),
      },
      body: JSON.stringify(input),
    })
  return { ...runtime.services, send }
}
const settle = {
  action: 'settle',
  id: 'parent',
  expectedArchived: null,
  expectedSnoozedUntil: '2026-11-01T00:00:00Z',
  snoozedUntil: null,
}

it('restores each family member’s original lifecycle state and retains the mutation receipt', async () => {
  const { store, send } = await setup()
  const before = store
    .get()
    .tasks.map(({ id, archived, autoSettled, settledAt, snoozedUntil }) => ({
      id,
      archived,
      autoSettled,
      settledAt,
      snoozedUntil,
    }))
  const response = await send(settle, 'settle-receipt')
  expect(response.status).toBe(200)
  const result = decode(resultSchema, await response.json())
  expect(store.task('parent').archived).toBe(true)
  expect(store.task('child').snoozedUntil).toBeUndefined()
  expect(decode(resultSchema, await (await send(settle, 'settle-receipt')).json())).toEqual(result)
  const undo = await send({ action: 'undo', token: result.undo }, 'undo-receipt')
  expect(undo.status).toBe(200)
  expect(
    store.get().tasks.map(({ id, archived, autoSettled, settledAt, snoozedUntil }) => ({
      id,
      archived,
      autoSettled,
      settledAt,
      snoozedUntil,
    })),
  ).toEqual(before)
  expect((await send({ action: 'undo', token: result.undo }, 'undo-receipt')).status).toBe(200)
})

it('rejects a stale undo without changing any family member', async () => {
  const { store, send } = await setup()
  const result = decode(resultSchema, await (await send(settle, 'settle-stale')).json())
  store.updateTask('child', (child) => ({ ...child, snoozedUntil: '2026-12-01T00:00:00Z' }))
  const before = store.get().tasks
  const undo = await send({ action: 'undo', token: result.undo }, 'undo-stale')
  expect(undo.status).toBe(409)
  expect(await undo.json()).toMatchObject({ mutationRejected: true })
  expect(store.get().tasks).toEqual(before)
})

it('restores snooze independently for each descendant and rejects stale initial state', async () => {
  const { store, send } = await setup()
  const request = { ...settle, action: 'snooze', snoozedUntil: '2026-12-03T00:00:00Z' }
  const before = store.get().tasks.map((entry) => entry.snoozedUntil)
  const result = decode(resultSchema, await (await send(request)).json())
  expect(store.get().tasks.map((entry) => entry.snoozedUntil)).toEqual([
    request.snoozedUntil,
    request.snoozedUntil,
  ])
  expect((await send({ action: 'undo', token: result.undo })).status).toBe(200)
  expect(store.get().tasks.map((entry) => entry.snoozedUntil)).toEqual(before)
  expect((await send({ ...request, expectedSnoozedUntil: null }, 'stale-action')).status).toBe(409)
})

it('invalidates undo after a conflicting change even if the value is changed back', async () => {
  const { store, send } = await setup()
  const result = decode(resultSchema, await (await send(settle)).json())
  store.updateTask('child', (child) => ({ ...child, snoozedUntil: '2026-12-01T00:00:00Z' }))
  store.updateTask('child', (child) => ({ ...child, snoozedUntil: undefined }))
  const undo = await send({ action: 'undo', token: result.undo })
  expect(undo.status).toBe(409)
  expect(store.task('parent').archived).toBe(true)
})

it('does not invalidate undo for unrelated workspace changes', async () => {
  const { store, send } = await setup()
  const result = decode(resultSchema, await (await send(settle)).json())
  store.updateTask('parent', (parent) => ({ ...parent, title: 'Renamed' }))
  expect((await send({ action: 'undo', token: result.undo })).status).toBe(200)
  expect(store.task('parent').title).toBe('Renamed')
})

it('binds undo to the original device and expires it', async () => {
  const services = await setup()
  const result = taskListAction(services, 'first-device', settle)
  if (!('undo' in result)) throw new Error('Expected an undo token')
  expect(() =>
    taskListAction(services, 'other-device', { action: 'undo', token: result.undo }),
  ).toThrow('Undo has expired or is unavailable.')
  const now = Date.now()
  vi.spyOn(Date, 'now').mockReturnValue(now + 31_000)
  expect(() =>
    taskListAction(services, 'first-device', { action: 'undo', token: result.undo }),
  ).toThrow('Undo has expired or is unavailable.')
  expect(services.store.task('parent').archived).toBe(true)
})

it('keeps a pending question answerable by rejecting Settle through both client routes', async () => {
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanup.push(runtime.close)
  const { store, questions } = runtime.services
  store.update((workspace) => ({
    ...workspace,
    tasks: [
      task,
      {
        ...task,
        id: 'child',
        delegation: { parentTaskId: task.id, parentRunId: 'ended', key: 'child' },
      },
    ],
  }))
  const pending = questions.request(
    'child',
    decode(questionPromptSchema, {
      title: 'Choose a branch',
      questions: [{ id: 'branch', header: 'Branch', question: 'Which branch?', custom: true }],
    }),
    new AbortController().signal,
  )
  const question = questions.list()[0]!
  const request = (path: string, input: unknown, method = 'POST') =>
    fetch(`http://127.0.0.1:${runtime.port}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  const attempts = [
    () => request('/api/tasks/list-action', settle),
    () =>
      request(
        '/api/workspace',
        {
          collection: 'tasks',
          id: task.id,
          changes: { archived: { before: null, after: true } },
        },
        'PATCH',
      ),
  ]
  for (const attempt of attempts) {
    const response = await attempt()
    expect(response.status).toBe(409)
    expect(await response.text()).toContain('Choose a branch')
    expect(store.get().tasks.map((entry) => entry.archived)).toEqual([undefined, undefined])
    expect(questions.status(question.id)).toBe('pending')
  }
  const answer = await request('/api/tasks/answer', {
    id: question.id,
    answers: { branch: ['main'] },
  })
  expect(answer.status).toBe(200)
  await expect(pending).resolves.toEqual({ branch: ['main'] })
  expect((await attempts[0]!()).status).toBe(200)
})

it.each([false, true])(
  'replays the Settle receipt after restart and checks intervening changes ($0)',
  async (changed) => {
    const dir = await mkdtemp(join(tmpdir(), 'dovo-task-list-undo-'))
    cleanup.push(() => rm(dir, { recursive: true, force: true }))
    const options = { databasePath: join(dir, 'runtime.sqlite'), ownerToken: token, port: 0 }
    let runtime = await startRuntime(options)
    cleanup.unshift(runtime.close)
    runtime.services.store.update((workspace) => ({ ...workspace, tasks: [task] }))
    const send = (input: unknown, mutationId?: string) =>
      fetch(`http://127.0.0.1:${runtime.port}/api/tasks/list-action`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(mutationId ? { 'x-dovo-mutation-id': mutationId } : {}),
        },
        body: JSON.stringify(input),
      })
    const response = await send(settle, 'settle-restart')
    expect(response.status).toBe(200)
    const receipt = decode(resultSchema, await response.json())
    if (changed) {
      for (const snoozedUntil of ['2026-12-01T00:00:00Z', undefined])
        runtime.services.store.updateTask(task.id, (current) => ({ ...current, snoozedUntil }))
    }
    await runtime.close()
    runtime = await startRuntime(options)
    cleanup.unshift(runtime.close)
    expect(decode(resultSchema, await (await send(settle, 'settle-restart')).json())).toEqual(
      receipt,
    )
    const undo = await send({ action: 'undo', token: receipt.undo })
    expect(undo.status).toBe(changed ? 409 : 200)
    expect(await undo.text()).toContain(
      changed ? 'This thread or a subthread changed' : '"ok":true',
    )
    const updated = runtime.services.store.taskSummary(task.id)
    expect(updated.archived).toBe(changed ? true : undefined)
    expect(updated.snoozedUntil).toBe(changed ? undefined : task.snoozedUntil)
  },
)
