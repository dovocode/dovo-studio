import { expect, it } from 'vite-plus/test'
import { decode } from '../../shared/schema'
import { forgeIssueSchema, combineIssueSections, matchingIssueSection } from './forge-work'
const overview = {
  destination: 'destination',
  issue: decode(forgeIssueSchema, {
    id: 'TEAM-1',
    title: 'Issue',
    body: 'Description',
    state: 'Open',
    url: 'https://team.atlassian.net/browse/TEAM-1',
    author: '',
    assignees: [],
    labels: [],
    updatedAt: '',
    revision: 'v1',
  }),
  comments: [],
}
const comment = {
  id: '1',
  author: 'Dominic',
  createdAt: '',
  body: 'Context',
  bodyFormat: 'markdown' as const,
}
it('keeps overview freshness independent from discussion failures', () => {
  expect(combineIssueSections(overview, undefined)).toEqual(overview)
  expect(
    combineIssueSections(overview, {
      ...overview,
      comments: [comment],
      stale: true,
      refreshError: 'Unavailable',
    }),
  ).toEqual({ ...overview, comments: [comment] })
})
it.each([
  { ...overview, destination: 'other' },
  { ...overview, issue: { ...overview.issue, revision: 'v2' } },
  { ...overview, issue: { ...overview.issue, id: 'TEAM-2' } },
  { ...overview, issue: { ...overview.issue, url: 'https://other.atlassian.net/browse/TEAM-1' } },
])('excludes comments and pagination from another issue snapshot or account', (value) => {
  const discussion = { ...value, comments: [comment], next: '30' }
  expect(matchingIssueSection(overview, discussion)).toBe(false)
  expect(combineIssueSections(overview, discussion)).toEqual(overview)
})
