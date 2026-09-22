import { beforeEach, expect, it, vi } from 'vite-plus/test'
import { runtimeProfile, snapshotSchema, taskSchema, type RuntimeOverview } from '@dovo/protocol'
import type { useRuntime } from '../runtime/provider'

const native = vi.hoisted(() => {
  const instance = {
    getId: () => 'activity',
    update: vi.fn<() => Promise<void>>(async () => {}),
    end: vi.fn<() => Promise<void>>(async () => {}),
    getPushToken: vi.fn<() => Promise<string | null>>(async () => null),
    addPushTokenListener: vi.fn<() => { remove(): void }>(() => ({ remove: vi.fn<() => void>() })),
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
  default: { start: native.start, getInstances: () => native.instances },
}))
import { createActivityController } from './controller'

beforeEach(() => {
  native.instances = []
  native.saved = null
  vi.clearAllMocks()
})
const read: ReturnType<typeof useRuntime>['readRuntime'] = async (
  _profile,
  _path,
  _input,
  schema,
) => schema.parse({ ok: true })
function source(): RuntimeOverview {
  const task = taskSchema.parse({
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
    snapshot: snapshotSchema.parse({
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
  const first = await createActivityController(vi.fn())
  await first.sync([overview], read, true)
  await first.sync([overview], read, true)
  first.dispose()
  const second = await createActivityController(vi.fn())
  await second.sync([overview], read, true)
  expect(native.start).toHaveBeenCalledTimes(1)
  second.dispose()
})
it('does not recreate a dismissed activity for the same turn', async () => {
  const overview = source()
  const controller = await createActivityController(vi.fn())
  await controller.sync([overview], read, true)
  native.instances = []
  await controller.sync([overview], read, true)
  expect(native.start).toHaveBeenCalledTimes(1)
  controller.dispose()
})
it('keeps the last state offline, then ends it on completion', async () => {
  const overview = source()
  const controller = await createActivityController(vi.fn())
  await controller.sync([overview], read, true)
  await controller.sync([{ ...overview, connected: false }], read, true)
  expect(native.instance.end).not.toHaveBeenCalled()
  overview.snapshot!.workspace.tasks[0].status = 'review'
  await controller.sync([overview], read, true)
  expect(native.instance.end).toHaveBeenCalledWith(
    'default',
    expect.objectContaining({ status: 'Done' }),
    expect.any(Date),
  )
  controller.dispose()
})
