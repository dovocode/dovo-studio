import { expect, it } from 'vite-plus/test'
import { readFileSync } from 'node:fs'
import { conversationActivityEvents, retainActivityEvents, type activitySchema } from './activity'
import type { Schema } from 'effect'

type Event = Schema.Schema.Type<typeof activitySchema>['events'][number]
const event: Event = {
  id: '1',
  time: '2026-09-24',
  kind: 'task-activity',
  scope: 'task',
  summary: 'Running command',
  payload: '{"status":"running"}',
}

it('retains identical polled activity arrays, including empty results', () => {
  const previous = [event]
  expect(retainActivityEvents(previous, [{ ...event }])).toBe(previous)
  const empty: Event[] = []
  expect(retainActivityEvents(empty, [])).toBe(empty)
})

it('publishes same-ID changes to every event field, and changes in ordering or length', () => {
  const previous = [event]
  for (const key of ['id', 'time', 'kind', 'scope', 'summary', 'payload'] as const) {
    const next = [{ ...event, [key]: 'changed' }]
    expect(retainActivityEvents(previous, next)).toBe(next)
  }
  const second = { ...event, id: '2' }
  const reordered = [second, event]
  expect(retainActivityEvents([event, second], reordered)).toBe(reordered)
  expect(retainActivityEvents(previous, [])).toEqual([])
  const added = [event, second]
  expect(retainActivityEvents(previous, added)).toBe(added)
})

it('matches Lean’s cutoff for activity from an archived conversation', () => {
  const cases = readFileSync(
    new URL('../../../../verification/bot-workflows-cases.jsonl', import.meta.url),
    'utf8',
  )
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { kind: string; time: number; visible: boolean })
    .filter((entry) => entry.kind === 'archive')
  expect(cases).toHaveLength(9)
  const date = (ms: number) => new Date(ms).toISOString()
  for (const { time, visible } of cases) {
    const events = [{ ...event, time: date(time) }]
    expect(conversationActivityEvents(events, date(1))).toEqual(visible ? events : [])
    expect(conversationActivityEvents(events, undefined)).toBe(events)
  }
})
