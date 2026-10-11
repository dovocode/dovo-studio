import { expect, it } from 'vite-plus/test'
import { Effect, Deferred, Fiber } from 'effect'
import {
  decode,
  defaultTaskHarness,
  resolveTaskAgent,
  runtimeProfile,
  snapshotSchema,
  taskSchema,
  type RuntimeOverview,
} from '@dovo/protocol'
import {
  optimisticTaskEffect,
  optimisticTaskConfirmed,
  previewTasks,
  type OptimisticTask,
} from './optimistic-tasks'

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
      const reply = yield* Deferred.make<{ revision: number }, Error>()
      const first = change()
      const second = { ...change(), changes: { snoozedUntil: '2026-09-25T10:00:00Z' } }
      const fiber = yield* Effect.forkChild(
        optimisticTaskEffect(
          first,
          publish,
          Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(reply))),
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

it('retains successful previews until snapshot confirmation and removes cancellations', async () => {
  let pending: OptimisticTask[] = []
  const publish = (update: (items: OptimisticTask[]) => OptimisticTask[]) => {
    pending = update(pending)
  }
  await Effect.runPromise(optimisticTaskEffect(change(), publish, Effect.succeed({ revision: 2 })))
  expect(pending[0]?.acknowledged).toEqual({ revision: 2 })
  pending = []
  await Effect.runPromise(
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const fiber = yield* Effect.forkChild(
        optimisticTaskEffect(
          change(),
          publish,
          Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
        ),
      )
      yield* Deferred.await(started)
      expect(pending).toHaveLength(1)
      yield* Fiber.interrupt(fiber)
      expect(pending).toEqual([])
    }),
  )
})

it('keeps a committed edit visible until the confirming snapshot and preserves newer overlapping intent', () => {
  const first = change()
  const second: OptimisticTask = {
    ...change(),
    changes: { pinned: false },
    acknowledged: { revision: 2 },
  }
  const latest = { ...entry, snapshot: { ...entry.snapshot!, revision: 2 } }
  expect(optimisticTaskConfirmed(second, entry)).toBe(false)
  expect(optimisticTaskConfirmed(second, latest, [first, second])).toBe(false)
  expect(previewTasks(latest, [first, second]).snapshot?.workspace.tasks[0]?.pinned).toBe(false)
  expect(optimisticTaskConfirmed(second, latest, [second])).toBe(true)
  const restarted = {
    ...latest,
    snapshot: { ...latest.snapshot, revision: 0, runtimeInstanceId: 'new' },
  }
  expect(
    optimisticTaskConfirmed(
      {
        ...second,
        runtimeInstanceId: 'old',
        acknowledged: { revision: 2, runtimeInstanceId: 'old' },
      },
      restarted,
    ),
  ).toBe(true)
})

it('retains a custom-agent model switch through stale snapshots without changing the saved agent', async () => {
  const agent = {
    ...defaultTaskHarness('codex'),
    id: 'agent',
    name: 'Saved agent',
    model: 'old-model',
  }
  const original = {
    ...entry,
    snapshot: { ...entry.snapshot!, workspace: { ...entry.snapshot!.workspace, agents: [agent] } },
  }
  let pending: OptimisticTask[] = []
  const selected: OptimisticTask = {
    ...change(),
    changes: {
      agentId: agent.id,
      harness: { ...defaultTaskHarness('codex'), model: 'new-model', reasoning: 'high' },
      harnessCustomized: true,
      agentOverrides: { model: 'new-model', reasoning: 'high', permission: 'full-access' },
    },
  }
  await Effect.runPromise(
    optimisticTaskEffect(
      selected,
      (update) => {
        pending = update(pending)
      },
      Effect.succeed({ revision: 2 }),
    ),
  )
  const visible = previewTasks(original, pending).snapshot!.workspace.tasks[0]!
  expect(resolveTaskAgent(visible, [agent])?.model).toBe('new-model')
  expect(resolveTaskAgent(visible, [agent])?.reasoning).toBe('high')
  expect(visible.harnessCustomized).toBe(true)
  expect(optimisticTaskConfirmed(pending[0]!, original)).toBe(false)
  expect(resolveTaskAgent(original.snapshot.workspace.tasks[0]!, [agent])?.model).toBe('old-model')
  expect(agent.model).toBe('old-model')
  expect(
    previewTasks(
      {
        ...original,
        profile: { ...profile, connection: { ...profile.connection, token: 'different-pairing' } },
      },
      pending,
    ),
  ).toMatchObject({ snapshot: original.snapshot })
})

it('clears custom-agent overrides when optimistically switching to a built-in harness', () => {
  const original = {
    ...entry,
    snapshot: {
      ...entry.snapshot!,
      workspace: {
        ...entry.snapshot!.workspace,
        tasks: [{ ...task, agentOverrides: { model: 'stale-custom-model' } }],
      },
    },
  }
  const visible = previewTasks(original, [
    {
      ...change(),
      changes: {
        agentId: '',
        agentOverrides: undefined,
        harnessCustomized: true,
        harness: { ...defaultTaskHarness('codex'), model: 'selected-built-in-model' },
      },
    },
  ]).snapshot!.workspace.tasks[0]!
  expect(resolveTaskAgent(visible, [])?.model).toBe('selected-built-in-model')
  expect(original.snapshot.workspace.tasks[0]!.agentOverrides.model).toBe('stale-custom-model')
})
