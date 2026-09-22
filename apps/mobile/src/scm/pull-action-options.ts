import type { PullAction, PullDetail } from '@dovo/protocol'

const labels = {
  comment: 'Comment',
  review: 'Review',
  edit: 'Edit PR',
  reviewers: 'Request reviewers',
  merge: 'Merge',
  close: 'Close PR',
  reopen: 'Reopen PR',
} satisfies Partial<Record<PullAction['action'], string>>

export type PullActionOption = { action: keyof typeof labels; label: string }

export function pullActionOptions(detail: PullDetail) {
  const actions = (detail.capabilities?.actions ?? [])
    .filter((value): value is PullActionOption['action'] => value in labels)
    .filter((value) => value !== 'merge' || !!detail.capabilities?.mergeMethods.length)
    .filter((value) => value !== 'review' || !!detail.capabilities?.reviewDecisions.length)
    .filter((value) =>
      detail.pull.state === 'open'
        ? value !== 'reopen'
        : value === 'comment' || (value === 'reopen' && detail.pull.state === 'closed'),
    )
    .map((action) => ({ action, label: labels[action] }))
  const primary =
    actions.find(({ action }) => action === 'review') ??
    actions.find(({ action }) => action === 'comment')
  return { primary, secondary: actions.filter((option) => option !== primary) }
}
