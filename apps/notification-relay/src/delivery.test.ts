import { afterEach, expect, it, vi } from 'vite-plus/test'
import { decode, relayNotificationSchema } from '@dovo/protocol'
import { Apns } from '@dovo/push'
import { appleNotificationPayload, androidNotificationPayload, createDelivery } from './delivery'
afterEach(() => vi.restoreAllMocks())
it('delivers native question categories on Apple and data-only question actions on Android', () => {
  const message = decode(relayNotificationSchema, {
    platform: 'ios',
    environment: 'sandbox',
    token: 'a'.repeat(64),
    id: 'b'.repeat(64),
    title: 'Choose',
    body: 'Which branch?\n1. Main',
    data: {
      runtimeId: 'host',
      taskId: 'thread',
      kind: 'input',
      inputId: 'question',
      inputType: 'question',
      question: JSON.stringify({
        fieldId: 'branch',
        mode: 'choice',
        choices: [{ label: 'Main', value: 'main' }],
      }),
    },
  })
  expect(appleNotificationPayload(message).aps.category).toBe('dovo-question-choice-1')
  const android = androidNotificationPayload({ ...message, platform: 'android' })
  expect(android.notification).toBeUndefined()
  expect(android.android.notification).toBeUndefined()
  expect(android.data).toMatchObject({
    title: message.title,
    message: message.body,
    question: message.data.question,
    inputId: 'question',
    notificationId: message.id,
  })
  expect(android.android.priority).toBe('high')
  const text = {
    ...message,
    data: {
      ...message.data,
      question: JSON.stringify({ fieldId: 'branch', mode: 'text', choices: [] }),
    },
  }
  expect(appleNotificationPayload(text).aps.category).toBe('dovo-question-text')
  const legacy = { ...message, data: { ...message.data, question: undefined } }
  expect(appleNotificationPayload(legacy).aps.category).toBe('dovo-question')
  expect(androidNotificationPayload(legacy).notification).toEqual({
    title: message.title,
    body: message.body,
  })
})

it('does not use a production-only key for a sandbox notification', async () => {
  const send = vi.spyOn(Apns.prototype, 'sendAlert').mockResolvedValue({ status: 200 })
  const delivery = createDelivery({
    DOVO_APNS_TEAM_ID: 'team',
    DOVO_APNS_PRODUCTION_KEY_PATH: '/private/production.p8',
    DOVO_APNS_PRODUCTION_KEY_ID: 'production',
  })
  const value = decode(relayNotificationSchema, {
    platform: 'ios',
    environment: 'sandbox',
    token: 'a'.repeat(64),
    id: 'b'.repeat(64),
    title: 'Finished',
    body: 'Done',
    data: { runtimeId: 'computer', taskId: 'thread', kind: 'done' },
  })
  await expect(delivery.send(value)).rejects.toThrow('Apple sandbox push is not configured')
  expect(send).not.toHaveBeenCalled()
  expect(await delivery.send({ ...value, environment: 'production' })).toEqual({
    delivered: true,
    invalidToken: false,
  })
})

it('uses sandbox credentials for direct installs and production credentials for TestFlight', async () => {
  const send = vi.spyOn(Apns.prototype, 'sendAlert').mockResolvedValue({ status: 200 })
  const delivery = createDelivery({
    DOVO_APNS_TEAM_ID: 'team',
    DOVO_APNS_SANDBOX_KEY_PATH: '/private/sandbox.p8',
    DOVO_APNS_SANDBOX_KEY_ID: 'sandbox',
    DOVO_APNS_PRODUCTION_KEY_PATH: '/private/production.p8',
    DOVO_APNS_PRODUCTION_KEY_ID: 'production',
  })
  const value = decode(relayNotificationSchema, {
    platform: 'ios',
    environment: 'sandbox',
    token: 'a'.repeat(64),
    id: 'b'.repeat(64),
    title: 'Finished',
    body: 'Done',
    data: { runtimeId: 'computer', taskId: 'thread', kind: 'done' },
  })
  expect(await delivery.send(value)).toEqual({ delivered: true, invalidToken: false })
  expect(await delivery.send({ ...value, environment: 'production' })).toEqual({
    delivered: true,
    invalidToken: false,
  })
  expect(send.mock.contexts).toMatchObject([
    { config: { keyId: 'sandbox', keyPath: '/private/sandbox.p8', production: false } },
    { config: { keyId: 'production', keyPath: '/private/production.p8', production: true } },
  ])
  send.mockResolvedValueOnce({ status: 403, reason: 'BadEnvironmentKeyInToken' })
  await expect(delivery.send(value)).rejects.toThrow('Apple rejected')
})
it('includes the answer action, question identity, project, and owning thread in Apple delivery', () => {
  const message = decode(relayNotificationSchema, {
    platform: 'ios',
    environment: 'sandbox',
    token: 'a'.repeat(64),
    id: 'b'.repeat(64),
    title: 'Build · Needs your input',
    body: 'Which branch?',
    data: {
      runtimeId: 'computer',
      taskId: 'thread',
      kind: 'input',
      inputId: 'question',
      inputType: 'question',
      project: 'Studio',
    },
  })
  expect(appleNotificationPayload(message)).toMatchObject({
    aps: {
      alert: { subtitle: 'Studio', body: 'Which branch?' },
      category: 'dovo-question',
      'thread-id': 'computer:thread',
    },
    runtimeId: 'computer',
    taskId: 'thread',
    inputId: 'question',
    inputType: 'question',
  })
  expect(
    appleNotificationPayload({ ...message, data: { ...message.data, inputType: 'approval' } }).aps,
  ).not.toHaveProperty('category')
})

it('sends background activity updates and ends through the Live Activity topic without alerts', async () => {
  const send = vi.spyOn(Apns.prototype, 'sendLiveActivity').mockResolvedValue({ status: 200 })
  const alert = vi.spyOn(Apns.prototype, 'sendAlert')
  const delivery = createDelivery({
    DOVO_APNS_TEAM_ID: 'team',
    DOVO_APNS_KEY_PATH: '/private/key.p8',
    DOVO_APNS_KEY_ID: 'key',
  })
  const value = {
    kind: 'liveactivity' as const,
    platform: 'ios' as const,
    environment: 'production' as const,
    token: 'a'.repeat(64),
    id: 'b'.repeat(64),
    runtimeId: 'host',
    activityId: 'activity',
    taskId: 'task',
    turnId: 'turn',
    event: 'update' as const,
    timestamp: 100,
    props: {
      title: 'Build',
      project: 'Studio',
      device: 'PC',
      status: 'Working' as const,
      startedAt: 0,
    },
  }
  expect(await delivery.send(value)).toEqual({ delivered: true, invalidToken: false })
  expect(send).toHaveBeenCalledWith(
    value.token,
    {
      aps: {
        timestamp: 100,
        event: 'update',
        'stale-date': 400,
        'content-state': { name: 'DovoTask', props: JSON.stringify(value.props) },
      },
    },
    value.id,
  )
  expect(send.mock.contexts[0]).toMatchObject({ config: { production: true } })
  expect(alert).not.toHaveBeenCalled()
  await delivery.send({ ...value, event: 'end' })
  expect(send.mock.calls[1]?.[1]).toMatchObject({ aps: { event: 'end', 'dismissal-date': 400 } })
  send.mockResolvedValueOnce({ status: 410 })
  expect(await delivery.send(value)).toEqual({ delivered: false, invalidToken: true })
  send.mockResolvedValueOnce({ status: 403, reason: 'InvalidProviderToken' })
  await expect(delivery.send(value)).rejects.toThrow('Apple rejected')
})
