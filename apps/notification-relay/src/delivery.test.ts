import { afterEach, expect, it, vi } from 'vite-plus/test'
import { decode, relayNotificationSchema } from '@dovo/protocol'
import { Apns } from '@dovo/push'
import { appleNotificationPayload, createDelivery } from './delivery'
afterEach(() => vi.restoreAllMocks())

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
