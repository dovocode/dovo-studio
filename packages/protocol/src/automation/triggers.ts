import { Schema } from 'effect'
import { mutableStruct } from '../shared/schema.js'

export const githubEventChoices = [
  { id: 'issue.created', name: 'Issue · Created' },
  { id: 'issue.comment', name: 'Issue · Comment' },
  { id: 'issue.assigned', name: 'Issue · Assigned' },
  { id: 'issue.labeled', name: 'Issue · Labeled' },
  { id: 'pull_request.assigned', name: 'Pull request · Assigned' },
  { id: 'pull_request.labeled', name: 'Pull request · Labeled' },
  { id: 'pull_request.merged', name: 'Pull request · Merged' },
  { id: 'pull_request.opened', name: 'Pull request · Opened' },
  { id: 'pull_request.ready_for_review', name: 'Pull request · Ready for review' },
  { id: 'pull_request.review_requested', name: 'Pull request · Review requested' },
  { id: 'pull_request.review_submitted', name: 'Pull request · Review submitted' },
  { id: 'pull_request.synchronized', name: 'Pull request · Synchronized' },
  { id: 'pull_request.review_comment', name: 'Pull request · Review comment' },
  { id: 'pull_request.comment', name: 'Pull request · Timeline comment' },
  { id: 'discussion.comment', name: 'Discussion · Comment' },
  { id: 'discussion.opened', name: 'Discussion · Opened' },
  { id: 'discussion.updated', name: 'Discussion · Updated' },
  { id: 'sub_issue.added', name: 'Sub issue · Added' },
] as const
export const githubEventSchema = Schema.Literals([...githubEventChoices.map((item) => item.id)])
export const githubTriggerSchema = mutableStruct({
  host: Schema.String,
  repository: Schema.String,
  event: githubEventSchema,
  label: Schema.String,
  actor: Schema.String,
  requireWriteAccess: Schema.Boolean,
})
export type GithubTrigger = Schema.Schema.Type<typeof githubTriggerSchema>
export type GithubEvent = GithubTrigger['event']
export const defaultGithubTrigger: GithubTrigger = {
  host: 'github.com',
  repository: '',
  event: 'issue.created',
  label: '',
  actor: '',
  requireWriteAccess: false,
}
export const automationScheduleChoices = [
  { id: '0 * * * *', name: 'Hourly' },
  { id: '0 9 * * *', name: 'Daily at 09:00' },
  { id: '0 9 * * 1', name: 'Weekly on Monday at 09:00' },
  { id: '0 9 * * 1-5', name: 'Weekdays at 09:00' },
  { id: 'custom', name: 'Custom cron' },
]
