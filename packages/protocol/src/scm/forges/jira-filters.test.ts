import { expect, it } from 'vite-plus/test'
import { decode, decodeResult } from '../../shared/schema.js'
import {
  jiraIssueFiltersSchema,
  jiraIssueFilterKey,
  jiraIssueOrder,
  jiraWorkflowStatuses,
} from './jira.js'
import { forgeWorkQuerySchema } from './forge-work.js'

it('decodes optional Jira filters and trims literal values', () => {
  expect(decode(forgeWorkQuerySchema, {}).jiraFilters).toBeUndefined()
  expect(
    decode(jiraIssueFiltersSchema, {
      assignee: 'mine',
      priority: ' High ',
      type: ' Task ',
      label: ' release ',
      statusCategory: 'in-progress',
    }),
  ).toEqual({
    assignee: 'mine',
    priority: 'High',
    type: 'Task',
    label: 'release',
    statusCategory: 'in-progress',
  })
})
it.each([
  { assignee: 'someone' },
  { statusCategory: 'open' },
  { priority: '' },
  { type: ' '.repeat(5) },
  { label: 'x'.repeat(101) },
  { label: 'x\ny' },
])('rejects invalid or unbounded structured filters: %j', (filters) => {
  expect(decodeResult(jiraIssueFiltersSchema, filters).success).toBe(false)
})

it('separates sprint, board, team, component and release caches while preserving legacy keys', async () => {
  const { jiraIssueFilterKey } = await import('./jira.js')
  expect(jiraIssueFilterKey({ priority: 'High' })).toHaveLength(5)
  const filters = { board: '104', sprint: '176', team: 'team-id', component: 'API', release: 'v2' }
  expect(decode(jiraIssueFiltersSchema, filters)).toEqual(filters)
  const key = JSON.stringify(jiraIssueFilterKey(filters))
  for (const field of ['board', 'sprint', 'team', 'component', 'release'] as const)
    expect(JSON.stringify(jiraIssueFilterKey({ ...filters, [field]: undefined }))).not.toBe(key)
})
it.each([
  { board: '0' },
  { board: '-1' },
  { sprint: '1 OR project = OTHER' },
  { sprint: '0' },
  { team: 'x\ny' },
])('rejects unsafe browse filters: %j', (filters) => {
  expect(decodeResult(jiraIssueFiltersSchema, filters).success).toBe(false)
})

it('keeps board, recent and title orders in separate cache entries', () => {
  const keys = [undefined, 'rank', 'updated', 'title'].map((orderBy) =>
    JSON.stringify(jiraIssueFilterKey(decode(jiraIssueFiltersSchema, { board: '104', orderBy }))),
  )
  expect(new Set(keys).size).toBe(4)
  expect(decodeResult(jiraIssueFiltersSchema, { orderBy: 'Rank DESC' }).success).toBe(false)
})
it('defaults boards to rank and lists to recent updates while retaining explicit sorts', () => {
  expect(jiraIssueOrder('board', 'updated')).toBe('rank')
  expect(jiraIssueOrder('board', 'project')).toBe('rank')
  expect(jiraIssueOrder('list', 'updated')).toBe('updated')
  expect(jiraIssueOrder('list', 'rank')).toBe('rank')
  expect(jiraIssueOrder('board', 'recent')).toBe('updated')
  expect(jiraIssueOrder('board', 'title')).toBe('title')
})
it('orders custom workflow statuses by Jira category and puts missing metadata last', () => {
  expect(
    jiraWorkflowStatuses([
      { state: 'Archived', statusCategory: 'done' },
      { state: 'Building', statusCategory: 'in-progress' },
      { state: 'Queued', statusCategory: 'todo' },
      { state: 'In progress' },
      { state: 'Awaiting review', statusCategory: 'in-progress' },
      { state: 'Queued', statusCategory: 'todo' },
    ]),
  ).toEqual(['Queued', 'Awaiting review', 'Building', 'Archived', 'In progress'])
  expect(jiraWorkflowStatuses([])).toEqual([])
  expect(
    jiraWorkflowStatuses([
      { state: 'Review' },
      { state: 'Review', statusCategory: 'in-progress' },
      { state: 'Done', statusCategory: 'done' },
    ]),
  ).toEqual(['Review', 'Done'])
})
