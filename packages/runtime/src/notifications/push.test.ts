import { afterEach, expect, it, vi } from 'vite-plus/test'
import {
  decode,
  taskSchema,
  questionPromptSchema,
  type QuestionPrompt,
  type RelayNotification,
} from '@dovo/protocol'
import { PushNotifications, notificationRelay, managedNotification } from './push'
import { openDatabase } from '../storage/database'
import { WorkspaceStore } from '../storage/workspace'
import { Devices } from '../auth/devices'
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
function setup(managed = false) {
  const db = openDatabase(':memory:'),
    store = new WorkspaceStore(db),
    devices = new Devices(db, 'owner-token')
  const device = devices.add('Phone', 'phone-token')
  const send = vi
    .fn<
      (
        value: RelayNotification,
        token?: string,
        origin?: string,
      ) => Promise<{ delivered: boolean; invalidToken: boolean }>
    >()
    .mockResolvedValue({ delivered: true, invalidToken: false })
  let input:
    | { id: string; preview: string; type?: 'question' | 'approval'; prompt?: QuestionPrompt }
    | Array<{
        id: string
        preview: string
        type?: 'question' | 'approval'
        prompt?: QuestionPrompt
      }>
    | undefined
  const service = new PushNotifications(
    db,
    store,
    devices,
    () => input,
    managed ? {} : { send },
    send,
  )
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
    ...(managed ? { managedToken: 'm'.repeat(43) } : {}),
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
it('only sends direct actions to capable phones and keeps secret questions out of action data', async () => {
  const f = setup()
  await f.service.flush()
  const prompt = decode(questionPromptSchema, {
    title: 'Branch',
    questions: [
      {
        id: 'branch',
        header: 'Branch',
        question: 'Which branch?',
        options: [{ label: 'Main', value: 'main' }],
      },
    ],
  })
  f.input({ id: 'old-phone', preview: 'Which branch?', type: 'question', prompt })
  await f.service.flush()
  expect(f.send.mock.calls.at(-1)?.[0].data.question).toBeUndefined()
  f.service.register(f.device, { ...f.registration, questionActions: 1 })
  f.input({ id: 'new-phone', preview: 'Which branch?', type: 'question', prompt })
  await f.service.flush()
  expect(f.send.mock.calls.at(-1)?.[0]).toMatchObject({
    body: 'Branch\nWhich branch?\n1. Main',
    data: {
      question: JSON.stringify({
        fieldId: 'branch',
        mode: 'choice',
        choices: [{ label: 'Main', value: 'main' }],
      }),
    },
  })
  f.input({
    id: 'secret',
    preview: 'Answer in Dovo',
    type: 'question',
    prompt: { ...prompt, questions: [{ ...prompt.questions[0], secret: true }] },
  })
  await f.service.flush()
  expect(f.send.mock.calls.at(-1)?.[0].data.question).toBeUndefined()
})
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
  f.store.updateTaskHistory('task', (task) => ({
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
  f.store.updateTaskHistory('task', (task) => ({ ...task, turns: [turn] }))
  await f.service.flush()
  f.send.mockRejectedValueOnce(new Error('Relay offline'))
  f.input({ id: 'old-question', preview: 'Old run' })
  await f.service.flush()
  expect(f.send.mock.calls[0][0].data.turnId).toBe('old')
  f.store.updateTaskHistory('task', (task) => ({ ...task, turns: [turn, { ...turn, id: 'new' }] }))
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

it('delivers managed pushes without runtime relay configuration and keeps scoped credentials out of messages', async () => {
  const f = setup(true)
  await f.service.flush()
  expect(f.service.status(f.device)).toMatchObject({ configured: true, registered: true })
  f.input({ id: 'question', preview: 'Choose a branch' })
  await f.service.flush()
  expect(f.send).toHaveBeenCalledOnce()
  expect(f.send.mock.calls[0][1]).toBe('m'.repeat(43))
  expect(f.send.mock.calls[0][0]).not.toHaveProperty('managedToken')
  expect(JSON.stringify(f.store.get())).not.toContain('m'.repeat(43))
})
it('routes managed push grants only to their selected Connect origin', async () => {
  const f = setup(true)
  const origin = 'https://connect.example.com'
  f.service.register(f.device, { ...f.registration, managedOrigin: origin })
  await f.service.flush()
  f.input({ id: 'question', preview: 'Choose a branch' })
  await f.service.flush()
  expect(f.send).toHaveBeenCalledWith(expect.anything(), 'm'.repeat(43), origin)
  const send = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ delivered: true, invalidToken: false }))
  vi.stubGlobal('fetch', send)
  await managedNotification(f.send.mock.calls[0][0], 'm'.repeat(43), origin)
  expect(send).toHaveBeenCalledWith(
    origin + '/v1/push/send',
    expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer ' + 'm'.repeat(43) }),
      redirect: 'error',
    }),
  )
})
it('preserves pending messages across managed credential renewal and does not remove renewed grants on stale failures', async () => {
  const f = setup(true)
  await f.service.flush()
  let finish: (value: { delivered: boolean; invalidToken: boolean }) => void = () => {
    throw new Error('No pending delivery')
  }
  f.send.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  f.input({ id: 'question', preview: 'Needs attention' })
  const pending = f.service.flush()
  f.service.register(f.device, { ...f.registration, managedToken: 'n'.repeat(43) })
  expect(f.db.prepare('SELECT id FROM push_outbox').all()).toHaveLength(1)
  finish({ delivered: false, invalidToken: true })
  await pending
  expect(f.service.status(f.device).registered).toBe(true)
  f.input({ id: 'second-question', preview: 'Still subscribed' })
  await f.service.flush()
  expect(f.send.mock.calls.at(-1)?.[1]).toBe('n'.repeat(43))
})

it('keeps progress, cancellations and PR check results out of notification banners', async () => {
  const f = setup()
  f.service.register(f.device, f.registration)
  await f.service.flush()
  f.store.updateTask('task', (task) => ({
    ...task,
    activity: 'Editing files',
    pullStatus: {
      number: 1,
      url: 'https://github.com/example/repo/pull/1',
      state: 'open',
      checks: 'pending',
      checkedAt: '',
    },
  }))
  await f.service.flush()
  for (const checks of ['passed', 'pending', 'failed'] as const) {
    f.store.updateTask('task', (task) => ({
      ...task,
      pullStatus: task.pullStatus ? { ...task.pullStatus, checks } : undefined,
    }))
    await f.service.flush()
  }
  f.store.updateTaskHistory('task', (task) => ({
    ...task,
    status: 'cancelled',
    turns: [
      {
        id: 'turn',
        assistantId: 'reply',
        agentId: '',
        provider: 'codex',
        model: '',
        status: 'cancelled',
        startedAt: '',
      },
    ],
  }))
  await f.service.flush()
  expect(f.send).not.toHaveBeenCalled()
})

it.each([
  { status: 'failed', kinds: ['failed'] },
  { status: 'review', kinds: ['done'] },
  { status: 'done', kinds: ['done'] },
  { status: 'cancelled', kinds: [] },
  { status: 'draft', kinds: [] },
] as const)(
  'notifies only actual completion or failure when a running task becomes $status',
  async ({ status, kinds }) => {
    const f = setup()
    await f.service.flush()
    f.store.updateTask('task', (task) => ({ ...task, status }))
    await f.service.flush()
    await f.service.flush()
    expect(f.send.mock.calls.map(([message]) => message.data.kind)).toEqual(kinds)
  },
)

it('sends a test only to the requested registered device through its configured transport', async () => {
  for (const managed of [false, true]) {
    const f = setup(managed)
    await expect(f.service.test('unregistered')).rejects.toThrow('Enable notifications')
    await expect(f.service.test(f.device)).resolves.toEqual({ ok: true })
    expect(f.send).toHaveBeenCalledWith(
      expect.objectContaining({
        token: f.registration.token,
        title: 'Dovo test notification',
        data: {
          runtimeId: f.registration.runtimeId,
          taskId: 'dovo-notification-test',
          kind: 'done',
        },
      }),
      ...(managed ? ['m'.repeat(43), undefined] : []),
    )
  }
})
it('reports rejected tests and clears expired registrations', async () => {
  const f = setup()
  f.send.mockResolvedValueOnce({ delivered: false, invalidToken: false })
  await expect(f.service.test(f.device)).rejects.toThrow('did not accept')
  expect(f.service.status(f.device).registered).toBe(true)
  f.send.mockResolvedValueOnce({ delivered: false, invalidToken: true })
  await expect(f.service.test(f.device)).rejects.toThrow('push token expired')
  expect(f.service.status(f.device).registered).toBe(false)
})
