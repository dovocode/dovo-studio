import { PullPatch } from './patch'
import type { PullComment } from '@dovo/studio-core'
import { MessageResponse } from '@dovo/studio-ui'
import { ReviewBadge } from './review-badge'
import { PullCommentActions, type PullActionContext } from './actions'
import { forgeLabels } from '@dovo/studio-core'
export function PullComments({
  comments,
  fileBaseURL,
  actionContext,
}: {
  comments: PullComment[]
  fileBaseURL?: string
  actionContext?: PullActionContext
}) {
  return (
    <div className="min-w-0 space-y-4">
      {!comments.length && <p className="text-xs text-muted-foreground">No comments or reviews.</p>}
      {comments.map((comment) => (
        <article
          key={comment.id}
          id={comment.id}
          data-comment-kind={comment.kind}
          aria-label={`${comment.author} ${comment.kind}`}
          className={`min-w-0 overflow-hidden ${comment.kind === 'comment' ? 'border-b' : 'rounded-lg border'} ${comment.kind === 'review' && comment.state === 'APPROVED' ? 'border-emerald-400/20' : comment.kind === 'review' && comment.state === 'CHANGES_REQUESTED' ? 'border-red-400/25' : ''}`}
        >
          <header
            className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-xs ${comment.kind === 'comment' ? '' : 'border-b bg-muted/20'}`}
          >
            <strong className="min-w-0 break-words font-medium">{comment.author}</strong>
            <ReviewBadge comment={comment} />
            {comment.resolved !== undefined && (
              <span className="text-muted-foreground">
                {comment.resolved ? 'Resolved' : 'Unresolved'}
              </span>
            )}
            {comment.outdated && <span className="text-muted-foreground">Outdated</span>}
            <a
              href={comment.url}
              target="_blank"
              rel="noreferrer"
              aria-label={`View ${comment.author}'s ${comment.kind} on ${forgeLabels[actionContext?.detail.pull.provider ?? 'github']}`}
              className="ml-auto shrink-0 py-1 text-[11px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {comment.date ? (
                <time dateTime={comment.date}>{new Date(comment.date).toLocaleString()}</time>
              ) : (
                'View original'
              )}
            </a>
          </header>
          {(comment.body || comment.path || comment.diff || comment.replyTo) && (
            <div className="min-w-0 space-y-3 p-4 text-sm">
              {comment.path && (
                <p className="break-all rounded-md bg-muted px-2 py-1.5 font-mono text-xs text-muted-foreground">
                  {comment.path}
                  {comment.line ? `:${comment.line}` : ''}
                </p>
              )}
              {comment.replyTo && (
                <a
                  className="block text-xs text-muted-foreground underline underline-offset-4"
                  href={`#${comment.replyTo}`}
                >
                  Reply to earlier inline comment
                </a>
              )}
              {comment.body && (
                <MessageResponse baseURL={comment.url} fileBaseURL={fileBaseURL}>
                  {comment.body}
                </MessageResponse>
              )}
              {comment.diff && (
                <details className="text-xs">
                  <summary className="cursor-pointer py-1 text-muted-foreground">
                    Diff context
                  </summary>
                  <PullPatch
                    reviewContext
                    file={{
                      path: comment.path ?? 'Review context',
                      status: 'modified',
                      patch: comment.diff,
                      additions: 0,
                      deletions: 0,
                    }}
                    split={false}
                  />
                </details>
              )}
            </div>
          )}
          {actionContext && <PullCommentActions {...actionContext} comment={comment} />}
        </article>
      ))}
    </div>
  )
}
