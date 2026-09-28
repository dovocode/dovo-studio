import { describe, expect, it } from 'vitest'
import type { ForgeIssue } from './forge-work.js'
import { issueEditInput } from './issue-edit'

const issue: ForgeIssue = {
  id: 'TEAM-4',
  title: 'Keep formatting',
  body: 'Rich text preview',
  state: 'In Progress',
  type: 'Task',
  url: 'https://team.atlassian.net/browse/TEAM-4',
  author: 'Dominic',
  assignees: ['account-id'],
  labels: ['mobile', 'design'],
  updatedAt: '',
  revision: 'rev1',
  bodyFormat: 'markdown',
}
const fields = { title: issue.title, body: issue.body, state: issue.state }
describe('issue edits', () => {
  it('does not overwrite the original rich description when only a title changes', () => {
    expect(issueEditInput(issue, { ...fields, title: 'New title' })).toEqual({
      action: 'edit',
      id: issue.id,
      revision: issue.revision,
      title: 'New title',
    })
  })
  it('omits unchanged account IDs and reordered labels', () => {
    expect(
      issueEditInput(issue, { ...fields, assignees: ['account-id'], labels: ['design', 'mobile'] }),
    ).toEqual({ action: 'edit', id: issue.id, revision: issue.revision })
  })
  it('preserves intentional field clearing and status changes', () => {
    expect(
      issueEditInput(issue, { ...fields, body: '', assignees: [], labels: [], state: 'Done' }),
    ).toMatchObject({ body: '', assignees: [], labels: [], state: 'Done' })
  })
})
