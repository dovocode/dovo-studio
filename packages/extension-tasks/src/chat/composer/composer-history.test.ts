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

it('extends the oldest boundary with earlier pages without shifting the current selection', () => {
  const history = createComposerHistory()
  expect(history.move('older', '', messages)).toBe('Second message')
  expect(history.atOldest).toBe(false)
  expect(history.move('older', 'Second message', messages)).toBe('First message')
  expect(history.atOldest).toBe(true)
  history.appendOlder([
    { role: 'user', text: 'Oldest' },
    { role: 'assistant', text: 'Reply' },
    { role: 'user', text: 'Earlier' },
  ])
  expect(history.atOldest).toBe(false)
  expect(history.move('older', 'First message', messages)).toBe('Earlier')
  expect(history.move('older', 'Earlier', messages)).toBe('Oldest')
  expect(history.move('newer', 'Oldest', messages)).toBe('Earlier')
  expect(history.move('newer', 'Earlier', messages)).toBe('First message')
})

it('can begin recall when the live window and an older page contain no user messages', () => {
  const history = createComposerHistory()
  expect(history.move('older', '', [{ role: 'assistant', text: 'Long reply' }])).toBeUndefined()
  expect(history.atOldest).toBe(true)
  history.appendOlder([{ role: 'assistant', text: 'Earlier reply' }])
  expect(history.atOldest).toBe(true)
  history.appendOlder([{ role: 'user', text: 'Original question' }])
  expect(history.move('older', '', [])).toBe('Original question')
  const generation = history.generation
  history.reset()
  expect(history.generation).not.toBe(generation)
  history.appendOlder([{ role: 'user', text: 'Delayed response' }])
  expect(history.active).toBe(false)
})

it('bounds composer recall to the latest 50 user messages', () => {
  const history = createComposerHistory()
  const messages = Array.from({ length: 65 }, (_, i) => ({ role: 'user', text: `Sent ${i}` }))
  let text = history.move('older', '', messages)!
  for (let i = 0; i < 70; i++) text = history.move('older', text, messages)!
  expect(text).toBe('Sent 15')
})
