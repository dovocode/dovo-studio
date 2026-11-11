import type { ReactNode } from 'react'
import type { PullReadiness, PullReadinessMetric, PullTone } from '@dovo/protocol'
import { ArrowUpRight, Check, CircleDashed, Clock3, GitMerge, X } from 'lucide-react'

const colors: Record<PullTone, string> = {
  positive: 'bg-status-success',
  danger: 'bg-status-error',
  warning: 'bg-status-warning',
  accent: 'bg-status-done',
  neutral: 'bg-muted-foreground/40',
}
const tones: Record<PullTone, string> = {
  positive: 'bg-status-success/10 text-status-success',
  danger: 'bg-status-error/10 text-status-error',
  warning: 'bg-status-warning/10 text-status-warning',
  accent: 'bg-status-done/10 text-status-done',
  neutral: 'bg-muted text-muted-foreground',
}
export function PullReadinessPanel({
  summary,
  onOpen,
  children,
}: {
  summary: PullReadiness
  onOpen: (section: PullReadinessMetric['id']) => void
  children?: ReactNode
}) {
  const Icon =
    summary.headline.tone === 'positive'
      ? Check
      : summary.headline.tone === 'danger'
        ? X
        : summary.headline.tone === 'warning'
          ? Clock3
          : summary.headline.tone === 'accent'
            ? GitMerge
            : CircleDashed
  return (
    <section
      aria-label="Pull request status"
      className="@container/pr-readiness mb-4 overflow-hidden rounded-xl border bg-background/60"
    >
      <div className="flex flex-wrap items-center gap-3 p-4">
        <span
          aria-hidden
          className={`flex size-10 shrink-0 items-center justify-center rounded-full ${tones[summary.headline.tone]}`}
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1 basis-48">
          <h3 className="text-sm font-semibold [overflow-wrap:anywhere]">
            {summary.headline.label}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
            {summary.description}
          </p>
        </div>
        {children && <div className="flex max-w-full flex-wrap items-center gap-2">{children}</div>}
      </div>
      <div className="grid grid-cols-1 divide-y border-t bg-muted/20 @sm/pr-readiness:grid-cols-3 @sm/pr-readiness:divide-x @sm/pr-readiness:divide-y-0">
        {summary.metrics.map((metric) => (
          <button
            key={metric.id}
            type="button"
            aria-label={`View pull request ${metric.id}`}
            aria-description={`${metric.signal.label}. ${metric.description}`}
            title={`${metric.signal.label}. ${metric.description}`}
            onClick={() => onOpen(metric.id)}
            className="group flex min-w-0 flex-col gap-2 p-3 text-left hover:bg-accent/50 focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring @sm/pr-readiness:p-4"
          >
            <span className="flex items-center gap-2">
              <span className="text-xs font-semibold">{metric.title}</span>
              <ArrowUpRight
                aria-hidden
                className="ml-auto size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground"
              />
            </span>
            <span className="block text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
              {metric.signal.label}
            </span>
            <span
              aria-hidden
              className={`mt-auto flex h-1.5 w-full shrink-0 overflow-hidden rounded-full bg-muted ${!metric.segments.length ? 'bg-[repeating-linear-gradient(135deg,transparent,transparent_3px,var(--border)_3px,var(--border)_5px)]' : ''}`}
            >
              {metric.segments.map((segment, index) => (
                <span
                  key={index}
                  className={colors[segment.tone]}
                  style={{ flex: segment.count }}
                />
              ))}
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}
