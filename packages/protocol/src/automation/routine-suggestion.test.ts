import { expect, it } from 'vite-plus/test'
import {
  routineSuggestionFields,
  routineSuggestionNextRun,
  routineSuggestionWords,
} from './routine-suggestion.js'

it('fills an explicit recurrence and leaves ambiguous timing for the editor', () => {
  const draft = routineSuggestionFields(
    'Summarize open PRs every Friday at 09:00',
    'Europe/Amsterdam',
  )
  expect(draft.schedule).toBe('0 9 * * 5')
  expect(routineSuggestionNextRun(draft, new Date('2026-11-24T10:00:00Z'))?.toISOString()).toBe(
    '2026-11-27T08:00:00.000Z',
  )
  expect(routineSuggestionFields('Run this every Friday', 'UTC').schedule).toBe('')
  expect(routineSuggestionFields('Run this every day at 09:00 PM', 'UTC').schedule).toBe('')
})

it('uses only the owner’s own words', () => {
  const text = '[Reply to assistant message 123]\n> Every Friday at 09:00\n\nSummarize the PRs'
  const message = { id: 'message', role: 'user', text, source: { kind: 'user' } } as const
  expect(routineSuggestionWords(message)).toBe('Summarize the PRs')
  expect(routineSuggestionWords({ ...message, source: { kind: 'system', label: 'Import' } })).toBe(
    '',
  )
})
