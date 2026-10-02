import { expect, it } from 'vite-plus/test'
import { decode, relayNotificationSchema } from '@dovo/protocol'
import { appleNotificationPayload } from './delivery'
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
