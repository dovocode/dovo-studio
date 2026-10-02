import { afterEach, expect, it, vi } from 'vitest'
import { decode, taskSchema, type RelayNotification } from '@dovo/protocol'
import { PushNotifications, notificationRelay } from './push'
import { openDatabase } from '../storage/database'
import { WorkspaceStore } from '../storage/workspace'
import { Devices } from '../auth/devices'
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
  vi.restoreAllMocks()
})
function setup() {
  const db = openDatabase(':memory:'),
    store = new WorkspaceStore(db),
    devices = new Devices(db, 'owner-token')
  const device = devices.add('Phone', 'phone-token')
  const send = vi
    .fn<(value: RelayNotification) => Promise<{ delivered: boolean; invalidToken: boolean }>>()
    .mockResolvedValue({ delivered: true, invalidToken: false })
  let input:
    | { id: string; preview: string; type?: 'question' | 'approval' }
    | Array<{ id: string; preview: string; type?: 'question' | 'approval' }>
    | undefined
  const service = new PushNotifications(db, store, devices, () => input, { send })
  cleanups.push(async () => {
    await service.dispose()
    db.close()
  })
  store.update((workspace) => ({
    ...workspace,
    tasks: [
      decode(taskSchema, {
        id: 'task',
        title: 'Ship changes',
        repositoryId: '',
        agentId: '',
        execution: 'main',
        status: 'running',
        createdAt: '',
        messages: [],
        files: [],
        draft: '',
        example: false,
      }),
    ],
  }))
  const registration = {
    runtimeId: 'phone-runtime-id',
    platform: 'ios',
    token: 'a'.repeat(64),
    environment: 'sandbox',
  }
  service.register(device, registration)
  return {
    db,
    store,
    devices,
    device,
    send,
    service,
    registration,
    input: (value: typeof input) => {
      input = value
    },
  }
}
it('sends task titles, previews and the phone’s runtime identity for input and completion, without replaying the baseline', async () => {
  const f = setup()
  await f.service.flush()
  expect(f.send).not.toHaveBeenCalled()
  f.input({ id: 'question', preview: 'Which worktree should be used?' })
  await f.service.flush()
  await f.service.flush()
  expect(f.send).toHaveBeenCalledTimes(1)
  expect(f.send.mock.calls[0][0]).toMatchObject({
    title: 'Ship changes · Needs your input',
    body: 'Which worktree should be used?',
    data: { runtimeId: 'phone-runtime-id', taskId: 'task', kind: 'input' },
  })
  f.input(undefined)
  f.store.updateTask('task', (task) => ({
    ...task,
    status: 'review',
    messages: [{ id: 'reply', role: 'assistant', text: 'Changes verified.', createdAt: '' }],
  }))
  await f.service.flush()
  expect(f.send).toHaveBeenCalledTimes(2)
  expect(f.send.mock.calls[1][0]).toMatchObject({
    body: 'Changes verified.',
    data: { kind: 'done' },
  })
  expect(JSON.stringify(f.store.get())).not.toContain(f.registration.token)
})
it('persists retry records across restart without replaying successful deliveries', async () => {
  const f = setup()
  await f.service.flush()
  f.send.mockRejectedValueOnce(new Error('Offline relay'))
  f.input({ id: 'question', preview: 'Needs attention' })
  await f.service.flush()
  expect(f.service.status(f.device).error).toContain('Push delivery failed')
  const reopened = new PushNotifications(
    f.db,
    f.store,
    f.devices,
    () => ({ id: 'question', preview: 'Needs attention' }),
    { send: f.send },
  )
  f.db.prepare('UPDATE push_outbox SET next=0').run()
  await reopened.flush()
  await reopened.flush()
  expect(f.send).toHaveBeenCalledTimes(2)
  expect(f.send.mock.calls[0][0].id).toBe(f.send.mock.calls[1][0].id)
  await reopened.dispose()
})
it('stops delivery after device revocation and removes invalid tokens', async () => {
  const f = setup()
  await f.service.flush()
  f.devices.revoke(f.device)
  f.input({ id: 'question', preview: 'No push to a revoked device' })
  await f.service.flush()
  expect(f.send).not.toHaveBeenCalled()
  expect(f.service.status(f.device).registered).toBe(false)
  const next = f.devices.add('New phone', 'new-phone-token')
  f.service.register(next, f.registration)
  f.send.mockResolvedValue({ delivered: false, invalidToken: true })
  f.input({ id: 'second-question', preview: 'Token expired' })
  await f.service.flush()
  expect(f.service.status(next).registered).toBe(false)
})
it('does not delete a newly rotated registration when an old in-flight token is rejected', async () => {
  const f = setup()
  await f.service.flush()
  let finish: (value: { delivered: boolean; invalidToken: boolean }) => void = () => {
    throw new Error('No delivery started')
  }
  f.send.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  f.input({ id: 'question', preview: 'Rotate token' })
  const pending = f.service.flush()
  f.service.register(f.device, { ...f.registration, token: 'b'.repeat(64) })
  finish({ delivered: false, invalidToken: true })
  await pending
  expect(f.service.status(f.device).registered).toBe(true)
})
it('keeps missing or invalid relay configuration isolated and preserves LAN HTTP support', async () => {
  expect(notificationRelay({})).toEqual({})
  expect(
    notificationRelay({
      DOVO_NOTIFICATION_RELAY_URL: 'invalid',
      DOVO_NOTIFICATION_RELAY_TOKEN: 'a'.repeat(32),
    }).error,
  ).toBeDefined()
  expect(
    notificationRelay({
      DOVO_NOTIFICATION_RELAY_URL: 'http://relay.lan:8080',
      DOVO_NOTIFICATION_RELAY_TOKEN: 'a'.repeat(32),
    }).send,
  ).toBeTypeOf('function')
})

it('does not deliver an input preview after the question was answered during a relay outage', async () => {
  const f = setup()
  await f.service.flush()
  f.send.mockRejectedValueOnce(new Error('Offline relay'))
  f.input({ id: 'question', preview: 'Old question' })
  await f.service.flush()
  f.input(undefined)
  const reopened = new PushNotifications(f.db, f.store, f.devices, () => undefined, {
    send: f.send,
  })
  f.db.prepare('UPDATE push_outbox SET next=0').run()
  await reopened.flush()
  expect(f.send).toHaveBeenCalledTimes(1)
  expect(f.db.prepare('SELECT id FROM push_outbox').all()).toEqual([])
  await reopened.dispose()
})

it('notifies each concurrent request with its exact identity and drops replaced requests on retry', async () => {
  const f = setup()
  await f.service.flush()
  f.input([
    { id: 'first', preview: 'First', type: 'question' },
    { id: 'second', preview: 'Second', type: 'question' },
  ])
  await f.service.flush()
  expect(f.send.mock.calls.map(([message]) => message.data.inputId)).toEqual(['first', 'second'])
  expect(f.send.mock.calls[1][0].data.inputType).toBe('question')
  f.send.mockRejectedValueOnce(new Error('Offline relay'))
  f.input([
    { id: 'second', preview: 'Second', type: 'question' },
    { id: 'old', preview: 'Old', type: 'question' },
  ])
  await f.service.flush()
  f.input([
    { id: 'second', preview: 'Second', type: 'question' },
    { id: 'new', preview: 'New', type: 'question' },
  ])
  const reopened = new PushNotifications(
    f.db,
    f.store,
    f.devices,
    () => [
      { id: 'second', preview: 'Second', type: 'question' },
      { id: 'new', preview: 'New', type: 'question' },
    ],
    { send: f.send },
  )
  f.db.prepare('UPDATE push_outbox SET next=0').run()
  await reopened.flush()
  expect(f.send.mock.calls.map(([message]) => message.data.inputId)).toEqual([
    'first',
    'second',
    'old',
    'new',
  ])
  expect(f.db.prepare('SELECT id FROM push_outbox').all()).toEqual([])
  await reopened.dispose()
})

it('delivers questions already pending on the first capture without replaying them later', async () => {
  const f = setup()
  f.input({ id: 'first-question', preview: 'Choose', type: 'question' })
  await f.service.flush()
  await f.service.flush()
  expect(f.send).toHaveBeenCalledOnce()
  expect(f.send.mock.calls[0][0].data).toMatchObject({
    inputId: 'first-question',
    inputType: 'question',
  })
})

it('discards notifications for archived threads and completion notifications superseded by another run', async () => {
  const f = setup()
  await f.service.flush()
  f.send.mockRejectedValueOnce(new Error('Relay offline'))
  f.input({ id: 'question', preview: 'Needs input' })
  await f.service.flush()
  f.store.updateTask('task', (task) => ({ ...task, archived: true }))
  const reopened = new PushNotifications(
    f.db,
    f.store,
    f.devices,
    () => ({ id: 'question', preview: 'Needs input' }),
    { send: f.send },
  )
  f.db.prepare('UPDATE push_outbox SET next=0').run()
  await reopened.flush()
  expect(f.send).toHaveBeenCalledOnce()
  expect(f.db.prepare('SELECT id FROM push_outbox').all()).toEqual([])
  await reopened.dispose()
  f.store.updateTask('task', (task) => ({ ...task, archived: false, status: 'review' }))
  f.input(undefined)
  const completion = new PushNotifications(f.db, f.store, f.devices, () => undefined, {
    send: f.send,
  })
  f.send.mockRejectedValueOnce(new Error('Relay offline'))
  await completion.flush()
  f.store.updateTask('task', (task) => ({ ...task, status: 'running' }))
  const latest = new PushNotifications(f.db, f.store, f.devices, () => undefined, { send: f.send })
  f.db.prepare('UPDATE push_outbox SET next=0').run()
  await latest.flush()
  expect(f.send).toHaveBeenCalledTimes(2)
  expect(f.db.prepare('SELECT id FROM push_outbox').all()).toEqual([])
  await latest.dispose()
  await completion.dispose()
})

it('discards an old-turn input even if its question has not been cleared yet', async () => {
  const f = setup()
  const turn = {
    id: 'old',
    assistantId: 'reply',
    agentId: '',
    provider: 'codex' as const,
    model: '',
    status: 'running' as const,
    startedAt: '',
  }
  f.store.updateTask('task', (task) => ({ ...task, turns: [turn] }))
  await f.service.flush()
  f.send.mockRejectedValueOnce(new Error('Relay offline'))
  f.input({ id: 'old-question', preview: 'Old run' })
  await f.service.flush()
  expect(f.send.mock.calls[0][0].data.turnId).toBe('old')
  f.store.updateTask('task', (task) => ({ ...task, turns: [turn, { ...turn, id: 'new' }] }))
  const reopened = new PushNotifications(
    f.db,
    f.store,
    f.devices,
    () => ({ id: 'old-question', preview: 'Old run' }),
    { send: f.send },
  )
  f.db.prepare('UPDATE push_outbox SET next=0').run()
  await reopened.flush()
  expect(f.send).toHaveBeenCalledOnce()
  expect(f.db.prepare('SELECT id FROM push_outbox').all()).toEqual([])
  await reopened.dispose()
})
