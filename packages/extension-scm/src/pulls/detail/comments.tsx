import { useEffect, useState } from 'react'
import { pullDiscussionGroups } from '@dovo/protocol'
import { PullPatch } from './patch'
import type { PullComment } from '@dovo/studio-core'
import { MessageResponse } from '@dovo/studio-ui'
import { ReviewBadge } from './review-badge'
import { PullCommentActions, type PullActionContext } from '../list/actions'
import { forgeLabels, formatDateTime } from '@dovo/studio-core'
export function PullComments({
  comments,
  fileBaseURL,
  actionContext,
  expanded = false,
}: {
  expanded?: boolean
  comments: PullComment[]
  fileBaseURL?: string
  actionContext?: PullActionContext
}) {
  if (!expanded && comments.length)
    return (
      <div className="min-w-0 space-y-4">
        {pullDiscussionGroups(comments).map((group) =>
          group.resolved ? (
            <ResolvedDiscussion
              key={group.key}
              comments={group.comments}
              fileBaseURL={fileBaseURL}
              actionContext={actionContext}
            />
          ) : (
            <PullComments
              key={group.key}
              expanded
              comments={group.comments}
              fileBaseURL={fileBaseURL}
              actionContext={actionContext}
            />
          ),
        )}
      </div>
    )
  return (
    <div className="min-w-0 space-y-4">
      {!comments.length && <p className="text-xs text-muted-foreground">No comments or reviews.</p>}
      {comments.map((comment) => (
        <article
          key={comment.id}
          id={comment.id}
          data-comment-fragment={
            comment.url.includes('#') ? `#${comment.url.split('#')[1]}` : undefined
          }
          data-comment-kind={comment.kind}
          aria-label={`${comment.author} ${comment.kind}`}
          className={`min-w-0 overflow-hidden rounded-xl border ${comment.kind === 'review' && comment.state === 'APPROVED' ? 'border-status-success/20' : comment.kind === 'review' && comment.state === 'CHANGES_REQUESTED' ? 'border-status-error/25' : ''}`}
        >
          <header
            className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-xs border-b bg-muted/20`}
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
              data-dovo-external="true"
              href={comment.url}
              target="_blank"
              rel="noreferrer"
              aria-label={`View ${comment.author}'s ${comment.kind} on ${forgeLabels[actionContext?.detail.pull.provider ?? 'github']}`}
              className="ml-auto shrink-0 py-1 text-[0.6875rem] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {comment.date ? (
                <time dateTime={comment.date}>{formatDateTime(comment.date)}</time>
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

function ResolvedDiscussion(props: {
  comments: PullComment[]
  fileBaseURL?: string
  actionContext?: PullActionContext
}) {
  const matches = () =>
    props.comments.some((comment) => {
      const hash = window.location.hash
      return (
        !!hash &&
        (hash === `#${comment.id}` ||
          (comment.url.includes('#') && hash === `#${comment.url.split('#')[1]}`))
      )
    })
  const [open, setOpen] = useState(matches)
  useEffect(() => {
    const reveal = () => {
      if (matches()) setOpen(true)
    }
    window.addEventListener('hashchange', reveal)
    return () => window.removeEventListener('hashchange', reveal)
  }, [props.comments])
  const authors = [...new Set(props.comments.map((comment) => comment.author))]
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="rounded-xl border bg-muted/10"
      aria-label="Resolved discussion"
    >
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
        <span className="flex -space-x-1" aria-label={authors.join(', ')}>
          {authors.slice(0, 5).map((author) => (
            <span
              key={author}
              title={author}
              className="flex size-6 items-center justify-center rounded-full border bg-secondary text-[10px] font-medium text-foreground"
            >
              {author.slice(0, 2).toUpperCase()}
            </span>
          ))}
        </span>
        <span className="min-w-0 flex-1 truncate">
          Resolved · {props.comments[0]?.path ?? 'Discussion'} · {props.comments.length}{' '}
          {props.comments.length === 1 ? 'comment' : 'comments'}
        </span>
        <span>{open ? 'Hide' : 'Show'}</span>
      </summary>
      {open && (
        <div className="p-2">
          <PullComments {...props} expanded />
        </div>
      )}
    </details>
  )
}
