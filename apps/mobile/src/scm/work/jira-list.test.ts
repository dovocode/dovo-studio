import { expect, it } from 'vite-plus/test'
import { decode, forgeIssueSchema } from '@dovo/protocol'
import { startsStatusGroup } from './jira-list'
const issue = (state: string) =>
  decode(forgeIssueSchema, {
    id: state,
    title: 'Issue',
    body: '',
    state,
    url: 'https://jira.example/browse/APP-1',
    author: '',
    assignees: [],
    labels: [],
    updatedAt: '2026-10-10T00:00:00Z',
    revision: '1',
  })
it('groups actual workflow statuses without inventing categories', () => {
  expect(startsStatusGroup(issue('Awaiting approval'))).toBe(true)
  expect(startsStatusGroup(issue('Awaiting approval'), issue('Awaiting approval'))).toBe(false)
  expect(startsStatusGroup(issue('Released'), issue('Awaiting approval'))).toBe(true)
})
