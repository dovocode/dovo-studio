import { runClientEffect } from '@dovo/client-runtime'
import { Effect, Schema } from 'effect'
import { decode, mutableStruct } from '@dovo/protocol'
import { beforeEach, expect, it, vi } from 'vite-plus/test'
import { runtimeProfile, snapshotSchema, taskSchema, type RuntimeOverview } from '@dovo/protocol'
import type { useRuntime } from '../runtime/connection/provider'
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
it('retires a native activity created before its ownership record was persisted', async () => {
  native.instances = [native.instance]
  const controller = await runClientEffect(createActivityController(vi.fn()))
  await runClientEffect(controller.sync([], read, false))
  expect(native.instance.end).toHaveBeenCalledWith('immediate')
  await controller.dispose()
})
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
      Effect.andThen(Effect.never),
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

it('updates a live thread when its current action or queued work changes', async () => {
  const overview = source()
  const controller = await runClientEffect(createActivityController(vi.fn()))
  await runClientEffect(controller.sync([overview], read, true))
  overview.snapshot!.workspace.tasks[0].activity = 'Running tests'
  overview.snapshot!.workspace.tasks[0].queue = [
    { id: 'queued', role: 'user', text: 'Next', createdAt: '2026-09-23T00:00:00Z' },
  ]
  await runClientEffect(controller.sync([overview], read, true))
  expect(native.instance.update).toHaveBeenLastCalledWith(
    expect.objectContaining({
      title: 'Build',
      activity: 'Running tests',
      queued: 1,
      activeThreads: 1,
    }),
    expect.any(Date),
  )
  expect(native.start).toHaveBeenCalledOnce()
  overview.snapshot!.workspace.tasks[0].archived = true
  await runClientEffect(controller.sync([overview], read, true))
  expect(native.instance.end).toHaveBeenLastCalledWith(
    'default',
    expect.objectContaining({ status: 'Stopped', activity: 'Thread stopped' }),
    expect.any(Date),
  )
  await controller.dispose()
})

it('keeps updating and ending locally when the background registration fails', async () => {
  const onError = vi.fn<(message: string) => void>()
  const failedRead: ReturnType<typeof useRuntime>['readRuntimeEffect'] = () =>
    Effect.fail(new Error('Offline'))
  native.instance.getPushToken.mockResolvedValueOnce('token')
  const overview = source()
  const controller = await runClientEffect(createActivityController(onError))
  await runClientEffect(controller.sync([overview], failedRead, true))
  await vi.waitFor(() => expect(onError).toHaveBeenCalled())
  overview.snapshot!.workspace.tasks[0].activity = 'New action'
  await runClientEffect(controller.sync([overview], failedRead, true))
  expect(native.instance.update).toHaveBeenLastCalledWith(
    expect.objectContaining({ activity: 'New action' }),
    expect.any(Date),
  )
  overview.snapshot!.workspace.tasks[0].status = 'review'
  await runClientEffect(controller.sync([overview], failedRead, true))
  expect(native.instance.end).toHaveBeenCalledOnce()
  await controller.dispose()
})

it('retries registration when the computer is not configured yet', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(1000)
  native.instance.getPushToken.mockResolvedValue('token')
  const read = vi.fn<() => void>()
  const reader: ReturnType<typeof useRuntime>['readRuntimeEffect'] = (
    _profile,
    _path,
    _input,
    schema,
  ) =>
    Effect.sync(() => {
      read()
      return decode(schema, { configured: false, environment: 'sandbox', error: null })
    })
  const controller = await runClientEffect(createActivityController(vi.fn()))
  await runClientEffect(controller.sync([source()], reader, true))
  await vi.waitFor(() => expect(read).toHaveBeenCalledOnce())
  vi.spyOn(Date, 'now').mockReturnValue(62000)
  await runClientEffect(controller.sync([source()], reader, true))
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2))
  await controller.dispose()
  native.instance.getPushToken.mockResolvedValue(null)
  vi.restoreAllMocks()
})

it('does not block foreground progress behind a slow token registration', async () => {
  native.instance.getPushToken.mockResolvedValueOnce('token')
  const reader: ReturnType<typeof useRuntime>['readRuntimeEffect'] = () => Effect.never
  const controller = await runClientEffect(createActivityController(vi.fn()))
  const overview = source()
  await runClientEffect(controller.sync([overview], reader, true))
  overview.snapshot!.workspace.tasks[0].activity = 'Still updating'
  await runClientEffect(controller.sync([overview], reader, true))
  expect(native.instance.update).toHaveBeenLastCalledWith(
    expect.objectContaining({ activity: 'Still updating' }),
    expect.any(Date),
  )
  await controller.dispose()
})

it('uses the current connection and reader after a token listener survives reconnecting', async () => {
  let push = (_event: { pushToken: string }) => {}
  native.instance.addPushTokenListener.mockImplementationOnce((listener) => {
    push = listener
    return { remove() {} }
  })
  const controller = await runClientEffect(createActivityController(vi.fn()))
  const overview = source()
  await runClientEffect(controller.sync([overview], read, true))
  const fresh = {
    ...overview,
    profile: {
      ...overview.profile,
      connection: {
        ...overview.profile.connection,
        address: 'http://new-host:51464',
        token: 'new-device-token',
      },
    },
  }
  const calls = vi.fn<(address: string, token: string) => void>()
  const reader: ReturnType<typeof useRuntime>['readRuntimeEffect'] = (
    profile,
    _path,
    _input,
    schema,
  ) =>
    Effect.sync(() => {
      calls(profile.connection.address, profile.connection.token)
      return decode(schema, { configured: true, environment: 'sandbox', error: null })
    })
  await runClientEffect(controller.sync([fresh], reader, true))
  push({ pushToken: 'rotated' })
  await vi.waitFor(() =>
    expect(calls).toHaveBeenCalledWith('http://new-host:51464', 'new-device-token'),
  )
  await controller.dispose()
})
it('does not rewrite unchanged activity persistence on every foreground update', async () => {
  const overview = source()
  const controller = await runClientEffect(createActivityController(vi.fn()))
  await runClientEffect(controller.sync([overview], read, true))
  const storage = await import('@react-native-async-storage/async-storage')
  const writes = vi.spyOn(storage.default, 'setItem')
  overview.snapshot!.workspace.tasks[0].activity = 'Another action'
  await runClientEffect(controller.sync([overview], read, true))
  expect(writes).not.toHaveBeenCalled()
  writes.mockRestore()
  await controller.dispose()
})

it('allows re-enabling activities for the same running turn after disabling them explicitly', async () => {
  const controller = await runClientEffect(createActivityController(vi.fn()))
  const overview = source()
  await runClientEffect(controller.sync([overview], read, true))
  await runClientEffect(controller.sync([overview], read, false))
  await runClientEffect(controller.sync([overview], read, true))
  expect(native.start).toHaveBeenCalledTimes(2)
  await controller.dispose()
})

it('orders token rotation and removal behind in-flight registration without blocking local updates', async () => {
  let push = (_event: { pushToken: string }) => {}
  native.instance.addPushTokenListener.mockImplementationOnce((listener) => {
    push = listener
    return { remove() {} }
  })
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const calls: string[] = []
  const reader: ReturnType<typeof useRuntime>['readRuntimeEffect'] = (
    _profile,
    path,
    input,
    schema,
  ) =>
    Effect.gen(function* () {
      const token = path.endsWith('/remove')
        ? 'remove'
        : decode(mutableStruct({ pushToken: Schema.String }), input).pushToken
      calls.push(token)
      if (token === 'old') yield* Effect.promise(() => gate)
      return decode(schema, { configured: true, environment: 'sandbox', error: null, ok: true })
    })
  const controller = await runClientEffect(createActivityController(vi.fn()))
  const overview = source()
  await runClientEffect(controller.sync([overview], reader, true))
  push({ pushToken: 'old' })
  await vi.waitFor(() => expect(calls).toEqual(['old']))
  push({ pushToken: 'new' })
  overview.snapshot!.workspace.tasks[0].activity = 'Progress while registering'
  await runClientEffect(controller.sync([overview], reader, true))
  expect(calls).toEqual(['old'])
  release()
  await vi.waitFor(() => expect(calls).toEqual(['old', 'new']))
  await runClientEffect(controller.sync([overview], reader, false))
  await vi.waitFor(() => expect(calls).toEqual(['old', 'new', 'remove']))
  await controller.dispose()
})

it('coalesces unchanged native activity updates while immediately showing changed state', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
  const controller = await runClientEffect(createActivityController(vi.fn()))
  try {
    const overview = source()
    await runClientEffect(controller.sync([overview], read, true))
    expect(native.instance.update).toHaveBeenCalledTimes(1)
    clock.mockReturnValue(1_060_000)
    await runClientEffect(controller.sync([overview], read, true))
    expect(native.instance.update).toHaveBeenCalledTimes(1)
    clock.mockReturnValue(1_180_000)
    await runClientEffect(controller.sync([overview], read, true))
    expect(native.instance.update).toHaveBeenCalledTimes(2)
    overview.snapshot!.workspace.tasks[0].title = 'New title'
    clock.mockReturnValue(1_181_000)
    await runClientEffect(controller.sync([overview], read, true))
    expect(native.instance.update).toHaveBeenCalledTimes(3)
    expect(native.instance.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'New title' }),
      new Date(1_481_000),
    )
  } finally {
    await controller.dispose()
    clock.mockRestore()
  }
})
