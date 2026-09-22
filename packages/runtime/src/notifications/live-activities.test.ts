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
  const task = taskSchema.parse({
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
  store.update((w) => ({ ...w, tasks: [task] }))
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
      'content-state': { name: 'DovoTask', props: expect.stringContaining('Needs input') },
    },
  })
  f.store.updateTask('task', (t) => ({ ...t, status: 'review' }))
  await f.service.flush()
  expect(f.send.mock.calls[2]?.[1]).toMatchObject({
    aps: { event: 'end', 'dismissal-date': expect.any(Number) },
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
  expect(() => f.service.register(f.device, { ...f.registration, turnId: 'old' })).toThrow(
    'no longer running',
  )
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
  expect(f.db.prepare('SELECT count(*) as count FROM live_activities').get()).toEqual({ count: 1 })
})
it('bounds push content and uses Unix seconds for stale and dismissal dates', () => {
  const f = setup()
  const props = liveTaskProps({ ...f.task, title: 'x'.repeat(1000) }, 'Mac', 'Project', false)
  expect(props.title).toHaveLength(100)
  const payload = activityPayload(props, false, 100_000)
  expect(payload.aps).toMatchObject({ timestamp: 100, 'stale-date': 220 })
  expect(payload.aps['content-state']).toEqual({ name: 'DovoTask', props: JSON.stringify(props) })
})
