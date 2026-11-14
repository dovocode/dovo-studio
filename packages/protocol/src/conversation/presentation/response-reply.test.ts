import { expect, it } from 'vite-plus/test'
import { responseReply } from './response-reply.js'
it('references the original assistant ID and keeps its quote bounded', () => {
  const reply = responseReply({ id: 'message-1', text: 'First line\n' + 'x'.repeat(10000) })
  expect(reply).toContain('"message-1"')
  expect(reply).toContain('conversation_read')
  expect(reply).toContain('> First line\n> ')
  expect(reply.endsWith('\n> …\n\n')).toBe(true)
  expect(reply.length).toBeLessThan(700)
})
