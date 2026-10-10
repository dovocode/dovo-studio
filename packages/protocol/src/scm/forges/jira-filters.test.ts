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
