import { CircleDot, ExternalLink } from 'lucide-react'
import {
  issueLabel,
  forgeLabels,
  type ForgeIssueDetail,
  type ForgeWorkOptions,
} from '@dovo/studio-core'
import { Button, MessageResponse } from '@dovo/studio-ui'
import { WorkTaskLinks } from '../work-task-links'
import { formatDate } from './format-date'

export function IssueDetail({
  detail,
  provider,
  repositoryId,
  jiraSourceId,
  connected,
  busy,
  stale,
  notice,
  onEdit,
  onTransition,
  onComment,
  onMore,
}: {
  detail: ForgeIssueDetail
  provider?: ForgeWorkOptions['provider']
  repositoryId?: string
  jiraSourceId?: string
  connected: boolean
  busy: boolean
  stale: boolean
  notice?: string
  onEdit: () => void
  onTransition: () => void
  onComment: () => void
  onMore: () => void
}) {
  const { issue, comments, next, discussionNotice } = detail
  return (
    <article className="mx-auto max-w-4xl space-y-5" aria-label="Issue details">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-foreground">
            <CircleDot className="size-3.5" />
            {issue.state}
          </span>
          <span>{[issueLabel(issue.id), issue.author].filter(Boolean).join(' · ')}</span>
          <a
            href={issue.url}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex items-center gap-1.5 hover:text-foreground"
          >
            Open on {provider ? (provider === 'jira' ? 'Jira' : forgeLabels[provider]) : 'server'}{' '}
            <ExternalLink className="size-3.5" />
          </a>
        </div>
        <h2 className="break-words text-xl font-semibold leading-snug">{issue.title}</h2>
        <dl className="grid grid-cols-2 gap-3 rounded-md border bg-card p-3 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">Assigned to</dt>
            <dd className="mt-1 break-words">
              {(issue.assigneeNames ?? issue.assignees).join(', ') || 'Unassigned'}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Type</dt>
            <dd className="mt-1">{issue.type}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Updated</dt>
            <dd className="mt-1">{formatDate(issue.updatedAt)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Discussion</dt>
            <dd className="mt-1">
              {comments.length}
              {next ? '+' : ''} comments loaded
            </dd>
          </div>
        </dl>
        {issue.priority && (
          <p className="text-xs">
            <span className="text-muted-foreground">Priority</span>{' '}
            <span className="ml-2 font-medium">{issue.priority}</span>
          </p>
        )}
        {!!issue.labels.length && (
          <div className="flex flex-wrap gap-1" aria-label="Labels">
            {issue.labels.map((label) => (
              <span
                key={label}
                className="max-w-full break-words rounded bg-muted px-2 py-1 text-xs"
              >
                {label}
              </span>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!connected || busy || stale}
            onClick={provider === 'jira' ? onTransition : onEdit}
          >
            {provider === 'jira' ? 'Change status' : 'Edit issue'}
          </Button>
          {provider === 'jira' && (
            <Button
              size="sm"
              variant="ghost"
              disabled={!connected || busy || stale}
              onClick={onEdit}
            >
              Edit details
            </Button>
          )}
        </div>
        <WorkTaskLinks
          key={JSON.stringify([jiraSourceId, repositoryId, issue.url])}
          repositoryId={repositoryId}
          jiraSourceId={jiraSourceId}
          source={issue}
          disabled={busy || stale}
        />
      </header>
      {notice && (
        <p role="status" className="text-xs text-muted-foreground">
          {notice}
        </p>
      )}
      {issue.bodyNotice && (
        <p role="status" className="text-xs text-muted-foreground">
          {issue.bodyNotice}
        </p>
      )}
      <section
        aria-label="Issue description"
        className="min-w-0 max-w-prose border-t pt-5 text-sm leading-7"
      >
        <h3 className="mb-3 font-medium">Description</h3>
        <MessageResponse baseURL={issue.url}>
          {(issue.preview ?? issue.body) || 'No description provided.'}
        </MessageResponse>
      </section>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">
          Discussion{comments.length ? ` · ${comments.length}${next ? '+' : ''}` : ''}
        </h3>
        <Button
          size="sm"
          variant="outline"
          disabled={!connected || busy || stale}
          onClick={onComment}
        >
          Comment
        </Button>
      </div>
      {discussionNotice && (
        <p role="status" className="text-xs text-muted-foreground">
          {discussionNotice}
        </p>
      )}
      {!comments.length && (
        <p className="text-sm text-muted-foreground">
          No comments yet. Add context or start a linked task.
        </p>
      )}
      <div className="divide-y">
        {comments.map((comment) => (
          <section key={comment.id} className="py-4">
            <p className="mb-2 text-xs text-muted-foreground">
              {comment.author} · {formatDate(comment.createdAt)}
            </p>
            <MessageResponse baseURL={comment.url ?? issue.url}>{comment.body}</MessageResponse>
          </section>
        ))}
      </div>
      {next && (
        <Button disabled={busy || !connected} onClick={onMore}>
          More comments
        </Button>
      )}
    </article>
  )
}
