import { expect, it } from 'vite-plus/test'
import { decode, decodeResult } from '../../shared/schema.js'
import { jiraIssueFiltersSchema } from './jira.js'
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
