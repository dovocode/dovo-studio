import { expect, it } from 'vite-plus/test'
import { Effect, Deferred, Fiber } from 'effect'
import {
  decode,
  runtimeProfile,
  snapshotSchema,
  taskSchema,
  type RuntimeOverview,
} from '@dovo/protocol'
import { optimisticTaskEffect, previewTasks, type OptimisticTask } from './optimistic-tasks'

const profile = runtimeProfile({
  address: 'http://computer.local:51464',
  token: 'test-device-credential-123',
})
const task = decode(taskSchema, {
  id: 'task',
  repositoryId: 'repo',
  agentId: 'agent',
  title: 'Task',
  status: 'review',
  createdAt: '2026-09-23T10:00:00Z',
  messages: [],
  files: [],
  draft: '',
  example: false,
})
const entry: RuntimeOverview = {
  profile,
  connected: true,
  lastSeen: null,
  error: null,
  pulls: null,
  pullError: null,
  snapshot: decode(snapshotSchema, {
    revision: 1,
    owner: false,
    workspace: {
      version: 1,
      runtimeAddress: '',
      agents: [],
      automations: [],
      tasks: [task],
      repositories: [],
    },
    approvals: [],
    questions: [],
    terminals: [],
    runs: [],
    devices: [],
    pendingDevices: [],
  }),
}
const change = (): OptimisticTask => ({
  id: Symbol(),
  connection: profile.connection,
  taskId: task.id,
  changes: { pinned: true },
})

it('shows pending changes over stale polls without modifying the cached snapshot', () => {
  const preview = previewTasks(entry, [change()])
  expect(preview.snapshot?.workspace.tasks[0]?.pinned).toBe(true)
  expect(
    previewTasks({ ...entry, profile: { ...profile, connection: { ...profile.connection } } }, [
      change(),
    ]).snapshot?.workspace.tasks[0]?.pinned,
  ).toBe(true)
  expect(entry.snapshot?.workspace.tasks[0]?.pinned).not.toBe(true)
  expect(previewTasks(entry, []).snapshot).toBe(entry.snapshot)
  expect(
    previewTasks(
      {
        ...entry,
        profile: { ...profile, connection: { ...profile.connection, token: 'replacement-token' } },
      },
      [change()],
    ).snapshot,
  ).toBe(entry.snapshot)
  expect(
    previewTasks(
      {
        ...entry,
        profile: {
          ...profile,
          connection: { ...profile.connection, address: 'http://other.local' },
        },
      },
      [change()],
    ).snapshot,
  ).toBe(entry.snapshot)
  expect(previewTasks(entry, [{ ...change(), taskId: 'missing' }])).toBe(entry)
  expect(previewTasks(entry, [{ ...change(), changes: { pinned: task.pinned } }])).toBe(entry)
  const withOther = {
    ...entry,
    snapshot: {
      ...entry.snapshot!,
      workspace: { ...entry.snapshot!.workspace, tasks: [task, { ...task, id: 'other' }] },
    },
  }
  expect(previewTasks(withOther, [change()]).snapshot?.workspace.tasks[1]).toBe(
    withOther.snapshot.workspace.tasks[1],
  )
})

it('updates before the server replies, rolls back a failure, and preserves another pending action', async () => {
  let pending: OptimisticTask[] = []
  const publish = (update: (items: OptimisticTask[]) => OptimisticTask[]) => {
    pending = update(pending)
  }
  await Effect.runPromise(
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const reply = yield* Deferred.make<void, Error>()
      const first = change()
      const second = { ...change(), changes: { snoozedUntil: '2026-09-25T10:00:00Z' } }
      const fiber = yield* Effect.fork(
        optimisticTaskEffect(
          first,
          publish,
          Deferred.succeed(started, undefined).pipe(Effect.zipRight(Deferred.await(reply))),
        ),
      )
      yield* Deferred.await(started)
      expect(previewTasks(entry, pending).snapshot?.workspace.tasks[0]?.pinned).toBe(true)
      publish((items) => [...items, second])
      yield* Deferred.fail(reply, new Error('Rejected'))
      const result = yield* Fiber.await(fiber)
      expect(result._tag).toBe('Failure')
      expect(pending).toEqual([second])
      expect(previewTasks(entry, pending).snapshot?.workspace.tasks[0]?.pinned).not.toBe(true)
    }),
  )
})

it('removes previews on success and cancellation', async () => {
  let pending: OptimisticTask[] = []
  const publish = (update: (items: OptimisticTask[]) => OptimisticTask[]) => {
    pending = update(pending)
  }
  await Effect.runPromise(optimisticTaskEffect(change(), publish, Effect.succeed('ok')))
  expect(pending).toEqual([])
  await Effect.runPromise(
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const fiber = yield* Effect.fork(
        optimisticTaskEffect(
          change(),
          publish,
          Deferred.succeed(started, undefined).pipe(Effect.zipRight(Effect.never)),
        ),
      )
      yield* Deferred.await(started)
      expect(pending).toHaveLength(1)
      yield* Fiber.interrupt(fiber)
      expect(pending).toEqual([])
    }),
  )
})
