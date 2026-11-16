import { expect, it } from 'vite-plus/test'
import type { Automation } from '../workspace'
import {
  routineChangeForRun,
  routineChangeSummary,
  routineCitedQuoteValid,
  routineFieldChangeText,
  routineSourceQuote,
  routineSourceText,
  type RoutineChange,
} from './routine-provenance'

const base = {
  label: 'Check',
  trigger: 'schedule' as const,
  schedule: '0 9 * * 1',
  timezone: 'UTC',
  objective: 'Read the release notes',
  agentId: 'agent',
  repositoryId: 'repo',
}
const flow: Automation = {
  id: 'routine',
  name: 'Release check',
  nodes: [
    { id: 't', type: 'automation', position: { x: 0, y: 0 }, data: { ...base, kind: 'trigger' } },
    { id: 's', type: 'automation', position: { x: 1, y: 0 }, data: { ...base, kind: 'task' } },
  ],
  edges: [{ id: 'e', source: 't', target: 's' }],
}

it('summarizes what changed and ignores layout moves and dormant step trigger fields', () => {
  expect(routineChangeSummary(undefined, flow)).toEqual([
    { label: 'Name', after: 'Release check' },
    { label: 'Trigger', after: 'Schedule 0 9 * * 1 · UTC' },
    { label: 'Added step · Check', after: 'Read the release notes' },
  ])
  const moved = structuredClone(flow)
  moved.nodes[1].position = { x: 5, y: 5 }
  moved.nodes[1].data.schedule = '* * * * *'
  expect(routineChangeSummary(flow, moved)).toEqual([])
  const edited = structuredClone(flow)
  edited.enabled = true
  edited.nodes[1].data.objective = 'Read the changelog'
  edited.nodes[1].data.agentId = 'other'
  edited.policy = { minutes: 5 }
  expect(routineChangeSummary(flow, edited).map(routineFieldChangeText)).toEqual([
    'Triggers: Paused → Enabled',
    'Limits and quiet hours: None → 5 min',
    'Instructions · Check: Read the release notes → Read the changelog',
    'Step settings · Check',
  ])
  const removed = { ...flow, nodes: [flow.nodes[0]], edges: [] }
  expect(routineChangeSummary(flow, removed).map(routineFieldChangeText)).toEqual([
    'Removed step · Check',
    'Step order',
  ])
})

it('bounds long values and the number of listed changes', () => {
  const many = structuredClone(flow)
  many.nodes = [
    flow.nodes[0],
    ...Array.from({ length: 25 }, (_, index) => ({
      ...flow.nodes[1],
      id: `s${index}`,
      data: { ...flow.nodes[1].data, label: `Step ${index}`, objective: 'x'.repeat(400) },
    })),
  ]
  const changes = routineChangeSummary(flow, many)
  expect(changes).toHaveLength(21)
  expect(changes.at(-1)).toEqual({ label: '6 more changes' })
  expect(changes[1].after?.length).toBeLessThanOrEqual(300)
})

it('quotes only the owner words and bounds them like a Reply quote', () => {
  const reply =
    '[Reply to assistant message "a". Use conversation_read with this messageId for more context.]\n> Run hourly.\n>\n> More.\n\nRun it weekly.'
  expect(routineSourceQuote(reply)).toEqual({ quote: 'Run it weekly.' })
  expect(routineSourceQuote('y'.repeat(600))).toEqual({ quote: 'y'.repeat(500), truncated: true })
})

it('selects the change that applied when a run started and labels each source', () => {
  const change = (id: string, at: string): RoutineChange => ({
    id,
    automationId: 'routine',
    at,
    action: 'updated',
    source: { kind: 'person' },
    changes: [],
  })
  const changes = [
    change('late', '2026-11-16T12:00:00.000Z'),
    change('early', '2026-11-16T10:00:00.000Z'),
  ]
  expect(routineChangeForRun(changes, '2026-11-16T11:00:00.000Z')?.id).toBe('early')
  expect(routineChangeForRun(changes, '2026-11-16T12:00:00.000Z')?.id).toBe('late')
  expect(routineChangeForRun(changes, '2026-11-16T09:00:00.000Z')).toBeUndefined()
  expect(
    routineSourceText({
      kind: 'owner',
      taskId: 't',
      messageId: 'm',
      quote: 'Check releases',
      truncated: true,
    }),
  ).toBe('During your request: "Check releases…"')
  expect(
    routineSourceText({
      kind: 'owner',
      taskId: 't',
      messageId: 'm',
      quote: 'Check releases',
      cited: true,
    }),
  ).toBe('Because you said: "Check releases"')
  expect(routineSourceText({ kind: 'person', deviceName: 'iPhone' })).toBe(
    'Changed by you in the editor on iPhone',
  )
  expect(routineSourceText({ kind: 'agent' })).toBe('Changed by an agent without an owner message')
})

it('accepts a cited quote of 12 or more characters, or a whole line or sentence', () => {
  const words = 'Make a weekly check. Turn it on!\nYes\nKeep it short.'
  for (const quote of ['Make a weekly', 'Turn it on!', 'Yes', ' Yes ', 'Keep it short.'])
    expect({ quote, valid: routineCitedQuoteValid(words, quote) }).toEqual({ quote, valid: true })
  for (const quote of ['on', 'Yes\nKeep', 'weekly', 'it short', '', 'Not in the message at all'])
    expect({ quote, valid: routineCitedQuoteValid(words, quote) }).toEqual({ quote, valid: false })
})
