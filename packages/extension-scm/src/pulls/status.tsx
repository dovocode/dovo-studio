import { CircleCheck, CircleAlert, Clock3, CircleDashed } from 'lucide-react'
import {
  checkSignal,
  latestPullReviews,
  pullMergeability,
  type PullDetail,
  type PullSignal,
} from '@dovo/studio-core'
import { ReviewBadge } from './review-badge'
import { MessageResponse } from '@dovo/studio-ui'
export function Signal({ signal }: { signal: PullSignal }) {
  const Icon =
    signal.tone === 'danger'
      ? CircleAlert
      : signal.tone === 'positive'
        ? CircleCheck
        : signal.tone === 'warning'
          ? Clock3
          : CircleDashed
  const color =
    signal.tone === 'danger'
      ? 'text-red-400'
      : signal.tone === 'positive'
        ? 'text-emerald-400'
        : signal.tone === 'warning'
          ? 'text-amber-400'
          : signal.tone === 'accent'
            ? 'text-violet-400'
            : 'text-muted-foreground'
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${color}`}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {signal.label}
    </span>
  )
}
export function PullStatus({ detail }: { detail: PullDetail }) {
  const reviews = latestPullReviews(detail.comments)
  const checks = [...detail.checks].sort((a, b) => {
    const priority = (status: string) =>
      ({ danger: 0, warning: 1, positive: 2, neutral: 3, accent: 3 })[checkSignal(status).tone]
    return priority(a.status) - priority(b.status)
  })
  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
      <section className="rounded-xl border">
        <h3 className="border-b px-4 py-3 text-sm font-medium">
          Checks <span className="text-muted-foreground">{checks.length}</span>
        </h3>
        {!checks.length && (
          <p className="p-4 text-xs text-muted-foreground">
            No checks returned. See any loading warnings above.
          </p>
        )}
        <div className="divide-y">
          {checks.map((check, i) => (
            <div key={`${check.name}-${i}`} className="min-w-0 space-y-3 px-4 py-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                {check.url ? (
                  <a
                    className="min-w-0 break-words font-medium hover:underline"
                    href={check.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {check.name} ↗
                  </a>
                ) : (
                  <span>{check.name}</span>
                )}
                <Signal signal={checkSignal(check.status)} />
              </div>
              {check.summary && (
                <MessageResponse
                  baseURL={check.url ?? detail.pull.url}
                  fileBaseURL={detail.fileBaseUrl}
                >
                  {check.summary}
                </MessageResponse>
              )}
              {(check.details || check.annotations?.length) && (
                <details className="min-w-0">
                  <summary className="cursor-pointer py-1 text-muted-foreground">
                    Check output
                    {check.annotations?.length
                      ? ` · ${check.annotations.length} annotation${check.annotations.length === 1 ? '' : 's'}`
                      : ''}
                  </summary>
                  <div className="min-w-0 space-y-3 pt-2">
                    {check.details && (
                      <MessageResponse
                        baseURL={check.url ?? detail.pull.url}
                        fileBaseURL={detail.fileBaseUrl}
                      >
                        {check.details}
                      </MessageResponse>
                    )}
                    {check.annotations?.map((annotation, index) => (
                      <article
                        key={`${annotation.path}:${annotation.startLine}:${index}`}
                        className="space-y-1 border-l-2 border-border pl-3"
                      >
                        <p className="break-all font-mono text-[0.6875rem]">
                          {annotation.path}:{annotation.startLine}
                          {annotation.endLine !== annotation.startLine
                            ? `–${annotation.endLine}`
                            : ''}
                        </p>
                        <p className="font-medium">{annotation.title || annotation.level}</p>
                        <p className="whitespace-pre-wrap break-words text-muted-foreground">
                          {annotation.message}
                        </p>
                      </article>
                    ))}
                  </div>
                </details>
              )}
            </div>
          ))}
        </div>
      </section>
      <aside className="space-y-4 rounded-xl border p-4 text-xs">
        <div>
          <h3 className="mb-2 font-medium">Latest reviews</h3>
          {reviews.length ? (
            reviews.map((review) => (
              <div key={review.author} className="mt-3 flex flex-wrap items-center gap-2">
                <span className="min-w-0 break-words">{review.author}</span>
                <ReviewBadge comment={review} />
              </div>
            ))
          ) : (
            <p className="text-muted-foreground">No review decision yet</p>
          )}
        </div>
        <div>
          <h3 className="mb-2 font-medium">Requested reviewers</h3>
          <p className="text-muted-foreground">{detail.pull.reviewers.join(', ') || 'None'}</p>
        </div>
        <div>
          <h3 className="mb-2 font-medium">Mergeability</h3>
          <Signal signal={pullMergeability(detail.pull)} />
        </div>
      </aside>
    </div>
  )
}
