import { expect, it } from 'vite-plus/test'
import { formatCodeReference } from './code-reference'

it('captures exact lines and keeps code fences valid', () => {
  expect(
    formatCodeReference('src/a.ts', 2, 3, 'zero\nconst text = "```"\nthree\nfour', 'old'),
  ).toBe('src/a.ts:L2-L3 (old)\n````\nconst text = "```"\nthree\n````')
  expect(formatCodeReference('src/a.ts', 1, 1, 'one')).toBe('src/a.ts:L1\n```\none\n```')
})
