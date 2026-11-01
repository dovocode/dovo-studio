import { expect, it } from 'vite-plus/test'
import { decode, ValidationError } from '../shared/schema.js'
import { taskMessageSchema } from './task-message.js'

it('validates the same submission before local admission and on the runtime', () => {
  const message = { id: 'task', messageId: 'message', text: '  Hello  ' }
  expect(decode(taskMessageSchema, message)).toMatchObject({ text: 'Hello', attachmentIds: [] })
  for (const input of [
    { ...message, text: ' ' },
    { ...message, messageId: '' },
    { ...message, text: 'x'.repeat(120001) },
    { ...message, initialTitle: { before: 'New', after: '' } },
    { ...message, attachmentIds: ['invalid-id'] },
  ])
    expect(() => decode(taskMessageSchema, input)).toThrow(ValidationError)
  expect(
    decode(taskMessageSchema, {
      ...message,
      text: '',
      attachmentIds: ['3e222e4e-63dc-40d0-b0cb-6d1bc3b9ead4'],
    }).attachmentIds,
  ).toHaveLength(1)
})
