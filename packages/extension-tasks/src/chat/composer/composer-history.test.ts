import { expect, it } from 'vite-plus/test'
import { createComposerHistory } from './composer-history'
const messages = [
  { role: 'user', text: 'First message' },
  { role: 'assistant', text: 'Reply' },
  { role: 'user', text: 'Second message' },
]
it('browses sent user messages in both directions and restores the original draft', () => {
  const history = createComposerHistory()
  expect(history.move('older', ' ', messages)).toBe('Second message')
  expect(history.move('older', 'Second message', messages)).toBe('First message')
  expect(history.move('older', 'First message', messages)).toBe('First message')
  expect(history.move('newer', 'First message', messages)).toBe('Second message')
  expect(history.move('newer', 'Second message', messages)).toBe(' ')
  expect(history.move('newer', ' ', messages)).toBeUndefined()
})
it('never overwrites typing and keeps a stable snapshot while messages arrive', () => {
  const history = createComposerHistory()
  expect(history.move('older', 'Draft', messages)).toBeUndefined()
  expect(history.move('older', '', messages)).toBe('Second message')
  expect(
    history.move('older', 'Second message', [...messages, { role: 'user', text: 'Third message' }]),
  ).toBe('First message')
  expect(history.move('older', 'Edited message', messages)).toBeUndefined()
  history.reset()
  expect(history.move('newer', '', messages)).toBeUndefined()
  expect(history.move('older', '', [])).toBeUndefined()
})
