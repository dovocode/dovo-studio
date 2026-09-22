import type { ForgeIssue, ForgeIssueAction } from './forge-work.js'

export function issueEditInput(
  issue: ForgeIssue,
  fields: {
    title: string
    body: string
    state: string
    assignees?: string[]
    labels?: string[]
  },
): Extract<ForgeIssueAction, { action: 'edit' }> {
  return {
    action: 'edit',
    id: issue.id,
    revision: issue.revision,
    ...(fields.title.trim() !== issue.title ? { title: fields.title } : {}),
    ...(fields.body !== issue.body ? { body: fields.body } : {}),
    ...(fields.state !== issue.state ? { state: fields.state } : {}),
    ...(fields.assignees && !sameValues(fields.assignees, issue.assignees)
      ? { assignees: fields.assignees }
      : {}),
    ...(fields.labels && !sameValues(fields.labels, issue.labels) ? { labels: fields.labels } : {}),
  }
}

function sameValues(a: string[], b: string[]) {
  return a.length === b.length && a.every((value) => b.includes(value))
}
