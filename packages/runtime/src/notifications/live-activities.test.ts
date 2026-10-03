import { decode, mutableStruct, liveTaskPropsSchema } from '@dovo/protocol'
import { Schema } from 'effect'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { activityPayload, LiveActivities } from './live-activities'
import { Apns } from './apns'
import { openDatabase } from '../storage/database'
import { WorkspaceStore } from '../storage/workspace'
import { Devices } from '../auth/devices'
import { taskSchema, liveTaskProps } from '@dovo/protocol'
const cleanups: Array<() => void> = []
afterEach(() => {
  for (const close of cleanups.splice(0)) close()
})
function setup() {
  const db = openDatabase(':memory:')
  cleanups.push(() => db.close())
  const store = new WorkspaceStore(db)
  const devices = new Devices(db, 'owner-secret')
  const device = devices.add('Phone', 'phone-secret')
  const task = decode(taskSchema, {
    id: 'task',
    example: false,
    draft: '',
    title: 'Implement updates',
    repositoryId: '',
    agentId: '',
    execution: 'main',
    status: 'running',
    createdAt: '2026-09-23T00:00:00Z',
    messages: [],
    files: [],
    turns: [
      {
        id: 'turn',
        assistantId: 'reply',
        agentId: '',
        provider: 'codex',
        model: '',
        reasoning: '',
        startedAt: '2026-09-23T00:00:00Z',
        status: 'running',
      },
    ],
  })
  store.update((w) => ({
    ...w,
    tasks: [task],
  }))
  const apns = new Apns({
    keyPath: '',
    keyId: '',
    teamId: '',
    bundleId: 'com.dovo.studio',
    production: false,
  })
  const send = vi.spyOn(apns, 'send').mockResolvedValue(200)
  let input = false
  const service = new LiveActivities(db, store, devices, () => input, apns)
  const registration = {
    activityId: 'activity',
    taskId: 'task',
    turnId: 'turn',
    pushToken: 'a'.repeat(64),
  }
  return {
    db,
    store,
    devices,
    device,
    task,
    service,
    send,
    registration,
    input: () => {
      input = true
    },
  }
}
it('sends Expo-compatible state changes and an end event, without duplicate snapshot pushes', async () => {
  const f = setup()
  f.service.register(f.device, f.registration)
  await f.service.flush()
  await f.service.flush()
  expect(f.send).toHaveBeenCalledTimes(1)
  f.input()
  await f.service.flush()
  expect(f.send.mock.calls[1]?.[1]).toMatchObject({
    aps: {
      event: 'update',
      'content-state': {
        name: 'DovoTask',
        props: expect.stringContaining('Needs input'),
      },
    },
  })
  f.store.updateTask('task', (t) => ({
    ...t,
    status: 'review',
  }))
  await f.service.flush()
  expect(f.send.mock.calls[2]?.[1]).toMatchObject({
    aps: {
      event: 'end',
      'dismissal-date': expect.any(Number),
    },
  })
  await f.service.flush()
  expect(f.send).toHaveBeenCalledTimes(3)
})
it('stops delivery after revocation and expires invalid push tokens', async () => {
  const f = setup()
  f.service.register(f.device, f.registration)
  f.devices.revoke(f.device)
  await f.service.flush()
  expect(f.send).not.toHaveBeenCalled()
  f.service.register('owner', f.registration)
  f.send.mockResolvedValue(410)
  await f.service.flush()
  await f.service.flush()
  expect(f.send).toHaveBeenCalledTimes(1)
})
it('rejects old turns and makes unregister scoped to the authenticated device', async () => {
  const f = setup()
  expect(() =>
    f.service.register(f.device, {
      ...f.registration,
      turnId: 'old',
    }),
  ).toThrow('no longer running')
  f.service.register(f.device, f.registration)
  f.service.remove('other-phone', 'activity')
  await f.service.flush()
  expect(f.send).toHaveBeenCalledOnce()
})
it('keeps a failed delivery for the next scheduled attempt and reports its status', async () => {
  const f = setup()
  f.service.register(f.device, f.registration)
  f.send.mockResolvedValue(503)
  await f.service.flush()
  await f.service.flush()
  expect(f.send).toHaveBeenCalledTimes(1)
  expect(f.service.status().error).toContain('APNs')
  expect(f.db.prepare('SELECT count(*) as count FROM live_activities').get()).toEqual({
    count: 1,
  })
})
it('bounds push content and uses Unix seconds for stale and dismissal dates', () => {
  const f = setup()
  const props = liveTaskProps(
    {
      ...f.task,
      title: 'x'.repeat(1000),
    },
    'Mac',
    'Project',
    false,
  )
  expect(props.title).toHaveLength(100)
  const payload = activityPayload(props, false, 100_000)
  expect(payload.aps).toMatchObject({
    timestamp: 100,
    'stale-date': 400,
  })
  expect(payload.aps['content-state']).toEqual({
    name: 'DovoTask',
    props: JSON.stringify(props),
  })
})

it('pushes the current action, queue size, and other active threads while backgrounded', async () => {
  const f = setup()
  f.store.update((workspace) => ({
    ...workspace,
    tasks: [
      {
        ...f.task,
        activity: 'Running formatting checks',
        queue: [{ id: 'queued', role: 'user', text: 'Next', createdAt: '2026-09-23T00:00:00Z' }],
      },
      { ...f.task, id: 'second' },
      { ...f.task, id: 'archived', archived: true },
    ],
  }))
  f.service.register(f.device, f.registration)
  await f.service.flush()
  const pushedProps = (payload: unknown) => {
    const content = decode(
      mutableStruct({
        aps: mutableStruct({
          'content-state': mutableStruct({ props: Schema.String }),
        }),
      }),
      payload,
    )
    return decode(liveTaskPropsSchema, JSON.parse(content.aps['content-state'].props))
  }
  expect(pushedProps(f.send.mock.calls[0]?.[1])).toMatchObject({
    activity: 'Running formatting checks',
    queued: 1,
    activeThreads: 2,
  })
  f.input()
  await f.service.flush()
  expect(pushedProps(f.send.mock.calls[1]?.[1])).toMatchObject({
    status: 'Needs input',
    activity: 'Waiting for your reply or approval',
  })
})
it('bounds activity details and prefers the current preparation step over stale provider activity', () => {
  const f = setup()
  expect(
    liveTaskProps({ ...f.task, activity: 'x'.repeat(500) }, 'Mac', '', false).activity,
  ).toHaveLength(140)
  expect(
    liveTaskProps({ ...f.task, activity: 'commandExecution' }, 'Mac', '', false).activity,
  ).toBe('Running a command')
  expect(liveTaskProps({ ...f.task, activity: 'Grep' }, 'Mac', '', false).activity).toBe(
    'Searching files',
  )
  const preparing = {
    ...f.task,
    runPhase: 'preparing' as const,
    activity: 'Previous action',
    preparation: { steps: ['fetch', 'worktree'], current: 'worktree', startedAt: f.task.createdAt },
  }
  expect(liveTaskProps(preparing, 'Mac', '', false).activity).toBe('Create worktree')
  expect(liveTaskProps({ ...f.task, status: 'review' }, 'Mac', '', false).activity).toBe(
    'Ready for review',
  )
})

it('refreshes unchanged background activities only after three minutes, with immediate input updates', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
  try {
    const f = setup()
    f.service.register(f.device, f.registration)
    await f.service.flush()
    expect(f.send).toHaveBeenCalledTimes(1)
    clock.mockReturnValue(1_060_000)
    await f.service.flush()
    expect(f.send).toHaveBeenCalledTimes(1)
    clock.mockReturnValue(1_180_000)
    await f.service.flush()
    expect(f.send).toHaveBeenCalledTimes(2)
    clock.mockReturnValue(1_181_000)
    f.input()
    await f.service.flush()
    expect(f.send).toHaveBeenCalledTimes(3)
    expect(f.send.mock.calls[2]?.[1]).toMatchObject({ aps: { 'stale-date': 1481 } })
  } finally {
    clock.mockRestore()
  }
})
