import { runClientEffect } from '@dovo/client-runtime'
import { Effect } from 'effect'
import { decode } from '@dovo/protocol'
import { beforeEach, expect, it, vi } from 'vite-plus/test'
import { runtimeProfile, snapshotSchema, taskSchema, type RuntimeOverview } from '@dovo/protocol'
import type { useRuntime } from '../runtime/provider'
const native = vi.hoisted(() => {
  const instance = {
    getId: () => 'activity',
    update: vi.fn<() => Promise<void>>(async () => {}),
    end: vi.fn<() => Promise<void>>(async () => {}),
    getPushToken: vi.fn<() => Promise<string | null>>(async () => null),
    addPushTokenListener: vi.fn<
      (listener: (event: { pushToken: string }) => void) => {
        remove(): void
      }
    >(() => ({
      remove: vi.fn<() => void>(),
    })),
  }
  return {
    instance,
    instances: [] as (typeof instance)[],
    saved: null as string | null,
    start: vi.fn<() => typeof instance>(() => {
      native.instances = [instance]
      return instance
    }),
  }
})
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async () => native.saved,
    setItem: async (_key: string, value: string) => {
      native.saved = value
    },
  },
}))
vi.mock('./task-activity', () => ({
  default: {
    start: native.start,
    getInstances: () => native.instances,
  },
}))
import { createActivityController } from './controller'
beforeEach(() => {
  native.instances = []
  native.saved = null
  vi.clearAllMocks()
})
const read: ReturnType<typeof useRuntime>['readRuntimeEffect'] = (
  _profile,
  _path,
  _input,
  schema,
) =>
  Effect.sync(() =>
    decode(schema, {
      ok: true,
    }),
  )
function source(): RuntimeOverview {
  const task = decode(taskSchema, {
    id: 'task',
    title: 'Build',
    repositoryId: '',
    agentId: '',
    status: 'running',
    createdAt: '2026-09-23T00:00:00Z',
    messages: [],
    files: [],
    draft: '',
    example: false,
    turns: [
      {
        id: 'turn',
        assistantId: 'reply',
        agentId: '',
        provider: 'codex',
        model: '',
        status: 'running',
        startedAt: '2026-09-23T00:00:00Z',
      },
    ],
  })
  return {
    profile: runtimeProfile({
      address: 'http://computer.local:51464',
      token: 'test-device-credential',
    }),
    connected: true,
    error: null,
    lastSeen: null,
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
        repositories: [],
        tasks: [task],
      },
      approvals: [],
      questions: [],
      terminals: [],
      runs: [],
      devices: [],
      pendingDevices: [],
    }),
  }
}
it('restores activities across app restarts without duplicating a turn', async () => {
  const overview = source()
  const first = await runClientEffect(createActivityController(vi.fn()))
  await runClientEffect(first.sync([overview], read, true))
  await runClientEffect(first.sync([overview], read, true))
  await first.dispose()
  const second = await runClientEffect(createActivityController(vi.fn()))
  await runClientEffect(second.sync([overview], read, true))
  expect(native.start).toHaveBeenCalledTimes(1)
  await second.dispose()
})
it('does not recreate a dismissed activity for the same turn', async () => {
  const overview = source()
  const controller = await runClientEffect(createActivityController(vi.fn()))
  await runClientEffect(controller.sync([overview], read, true))
  native.instances = []
  await runClientEffect(controller.sync([overview], read, true))
  expect(native.start).toHaveBeenCalledTimes(1)
  await controller.dispose()
})
it('keeps the last state offline, then ends it on completion', async () => {
  const overview = source()
  const controller = await runClientEffect(createActivityController(vi.fn()))
  await runClientEffect(controller.sync([overview], read, true))
  await runClientEffect(
    controller.sync(
      [
        {
          ...overview,
          connected: false,
        },
      ],
      read,
      true,
    ),
  )
  expect(native.instance.end).not.toHaveBeenCalled()
  overview.snapshot!.workspace.tasks[0].status = 'review'
  await runClientEffect(controller.sync([overview], read, true))
  expect(native.instance.end).toHaveBeenCalledWith(
    'default',
    expect.objectContaining({
      status: 'Done',
    }),
    expect.any(Date),
  )
  await controller.dispose()
})

it('serializes overlapping syncs without creating duplicate activities', async () => {
  let release = () => {}
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  native.instance.update.mockImplementationOnce(() => pending)
  const controller = await runClientEffect(createActivityController(vi.fn()))
  const first = runClientEffect(controller.sync([source()], read, true))
  await vi.waitFor(() => expect(native.instance.update).toHaveBeenCalledOnce())
  const second = runClientEffect(controller.sync([source()], read, true))
  expect(native.start).toHaveBeenCalledOnce()
  release()
  await Promise.all([first, second])
  expect(native.start).toHaveBeenCalledOnce()
  await controller.dispose()
})

it('cancels push-token registration and releases its listener on disposal', async () => {
  let push = (_event: { pushToken: string }) => {}
  const remove = vi.fn<() => void>()
  native.instance.addPushTokenListener.mockImplementationOnce((listener) => {
    push = listener
    return { remove }
  })
  let started = false,
    interrupted = false
  const read: ReturnType<typeof useRuntime>['readRuntimeEffect'] = () =>
    Effect.sync(() => {
      started = true
    }).pipe(
      Effect.zipRight(Effect.never),
      Effect.onInterrupt(() =>
        Effect.sync(() => {
          interrupted = true
        }),
      ),
    )
  const onError = vi.fn<(message: string) => void>()
  const controller = await runClientEffect(createActivityController(onError))
  await runClientEffect(controller.sync([source()], read, true))
  push({ pushToken: 'token' })
  await vi.waitFor(() => expect(started).toBe(true))
  await controller.dispose()
  expect(interrupted).toBe(true)
  expect(remove).toHaveBeenCalledOnce()
  expect(onError).not.toHaveBeenCalled()
})
