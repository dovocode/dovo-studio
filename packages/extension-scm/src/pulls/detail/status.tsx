import { Disclosure } from '@dovo/studio-ui'
import type { ReactNode } from 'react'
import { CircleCheck, CircleAlert, Clock3, CircleDashed } from 'lucide-react'
import { checkSignal, latestPullReviews, type PullDetail, type PullSignal } from '@dovo/studio-core'
import { ReviewBadge } from './review-badge'
import { MessageResponse } from '@dovo/studio-ui'
export function Signal({ signal, subtle = false }: { signal: PullSignal; subtle?: boolean }) {
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
      ? 'text-status-error'
      : signal.tone === 'positive'
        ? 'text-status-success'
        : signal.tone === 'warning'
          ? 'text-status-warning'
          : signal.tone === 'accent'
            ? 'text-status-done'
            : 'text-muted-foreground'
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs ${subtle ? 'text-muted-foreground' : color}`}
    >
      <Icon className={`size-3.5 shrink-0 ${color}`} aria-hidden />
      {signal.label}
    </span>
  )
}
export function PullStatusSources({
  sources,
}: {
  sources: { name: string; signal: PullSignal }[]
}) {
  return (
    <dl aria-label="Status sources" className="space-y-3 text-xs">
      {sources.map(({ name, signal }) => (
        <div key={name} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <dt className="text-muted-foreground">{name}</dt>
          <dd>
            <Signal signal={signal} subtle />
          </dd>
        </div>
      ))}
    </dl>
  )
}
export function PullStatus({
  detail,
  reviewsReady = true,
  checksReady = true,
  children,
}: {
  detail: PullDetail
  reviewsReady?: boolean
  checksReady?: boolean
  children?: ReactNode
}) {
  const reviews = latestPullReviews(detail.comments)
  const checks = [...detail.checks].sort((a, b) => {
    const priority = (status: string) =>
      ({ danger: 0, warning: 1, positive: 2, neutral: 3, accent: 3 })[checkSignal(status).tone]
    return priority(a.status) - priority(b.status)
  })
  return (
    <div className="grid items-start gap-4 @4xl/pr-detail:grid-cols-[minmax(0,1fr)_220px]">
      <div className="min-w-0">
        {children}
        {checksReady && (
          <section className="min-w-0 rounded-xl border">
            <h3 className="border-b px-4 py-3 text-sm font-medium">
              Check reports <span className="text-muted-foreground">{checks.length}</span>
            </h3>
            {!checks.length && (
              <p className="p-4 text-xs text-muted-foreground">
                No check reports returned. See any loading warnings above.
              </p>
            )}
            <div className="divide-y">
              {checks.map((check, i) => (
                <div key={`${check.name}-${i}`} className="min-w-0 space-y-3 px-4 py-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {check.url ? (
                      <a
                        className="min-w-0 [overflow-wrap:anywhere] font-medium hover:underline"
                        href={check.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {check.name} ↗
                      </a>
                    ) : (
                      <span className="min-w-0 [overflow-wrap:anywhere]">{check.name}</span>
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
                    <Disclosure
                      className="min-w-0"
                      title={
                        <>
                          Check output
                          {check.annotations?.length
                            ? ` · ${check.annotations.length} annotation${check.annotations.length === 1 ? '' : 's'}`
                            : ''}
                        </>
                      }
                    >
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
                            <p className="[overflow-wrap:anywhere] font-medium">
                              {annotation.title || annotation.level}
                            </p>
                            <p className="whitespace-pre-wrap [overflow-wrap:anywhere] text-muted-foreground">
                              {annotation.message}
                            </p>
                          </article>
                        ))}
                      </div>
                    </Disclosure>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
      <aside className="min-w-0 space-y-5 border-t pt-4 text-xs [overflow-wrap:anywhere] @4xl/pr-detail:border-l @4xl/pr-detail:border-t-0 @4xl/pr-detail:pl-5 @4xl/pr-detail:pt-0">
        <div>
          <h3 className="mb-2 font-medium">Review decisions</h3>
          {!reviewsReady ? (
            <p className="text-muted-foreground">Reviews have not loaded yet.</p>
          ) : reviews.length ? (
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
        {detail.pull.autoMergeEnabled && (
          <p className="text-muted-foreground">
            Auto-merge enabled · merges when GitHub’s requirements pass.
          </p>
        )}
      </aside>
    </div>
  )
}
