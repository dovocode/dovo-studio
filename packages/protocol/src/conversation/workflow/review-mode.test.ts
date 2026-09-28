import { expect, it } from 'vitest'
import { commandSuggestions } from '../presentation/resource-mentions.js'
import { fixFindingsPrompt, parseReviewFindings, reviewFindings } from './review-mode.js'

it('parses review findings in the requested format and common variants', () => {
  expect(
    parseReviewFindings(
      [
        'Found two problems:',
        '- src/auth.ts:12 — token is never refreshed',
        '* `lib/db.ts:40-44`: missing await',
        '1. app.tsx:3 - unused import',
        'Not a finding: see docs',
      ].join('\n'),
    ),
  ).toEqual([
    { path: 'src/auth.ts', line: 12, text: 'token is never refreshed' },
    { path: 'lib/db.ts', line: 40, text: 'missing await' },
    { path: 'app.tsx', line: 3, text: 'unused import' },
  ])
})

it('shows findings only for the newest finished review', () => {
  const request = { id: 'r', role: 'user' as const, text: 'Review', review: true }
  const reply = { id: 'a', role: 'assistant' as const, text: '- a.ts:1 — bad' }
  expect(reviewFindings({ status: 'review', messages: [request, reply] })).toHaveLength(1)
  expect(reviewFindings({ status: 'running', messages: [request, reply] })).toEqual([])
  expect(
    reviewFindings({
      status: 'review',
      messages: [request, reply, { id: 'u', role: 'user', text: 'Fix it' }],
    }),
  ).toEqual([])
  expect(fixFindingsPrompt([{ path: 'a.ts', line: 1, text: 'bad' }])).toBe(
    'Fix these review findings:\n- a.ts:1 — bad',
  )
  expect(commandSuggestions('re').map((command) => command.id)).toEqual(['review'])
})
