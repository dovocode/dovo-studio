import { expect, it } from 'vite-plus/test'
import { browserTabBadge } from './browser-tab-badge'

it.each([
  ['(3) Microsoft Teams', 3],
  ['[12] Inbox', 12],
  ['(999+) Chat', 999],
  ['• New message', 'unread'],
  ['● Chat', 'unread'],
  ['(0) Inbox', undefined],
  ['Report (2026)', undefined],
  ['123 Main Street', undefined],
  ['Teams', undefined],
] as const)('reads website activity from %s', (title, expected) => {
  expect(browserTabBadge(title)).toBe(expected)
})
