import { expect, it } from 'vite-plus/test'
import { sharedMessage } from './shared-message'

it('prefills editable text and URLs without fetching or rewriting their content', () => {
  expect(
    sharedMessage([
      { shareType: 'text', value: 'Please review\nthis' },
      { shareType: 'url', value: 'http://example.test/a?b=1' },
      { shareType: 'url', value: 'http://example.test/a?b=1' },
    ]),
  ).toBe('Please review\nthis\n\nhttp://example.test/a?b=1')
})

it('ignores blank content and file URIs', () => {
  expect(
    sharedMessage([
      { shareType: 'text', value: '  ' },
      { shareType: 'file', value: 'file:///private/data' },
    ]),
  ).toBe('')
})

it('rejects oversized input without silently truncating it', () => {
  expect(() => sharedMessage([{ shareType: 'text', value: 'x'.repeat(12001) }])).toThrow('too long')
})
