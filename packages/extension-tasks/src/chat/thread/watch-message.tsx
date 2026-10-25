import { pipelineSignal, type WatchMessage } from '@dovo/protocol'
import { GitPullRequest, Workflow, ExternalLink } from 'lucide-react'

export function WatchMessageCard({ update }: { update: WatchMessage }) {
  const Icon = update.kind === 'pipeline' ? Workflow : GitPullRequest
  const tone = update.status ? pipelineSignal(update.status).tone : 'neutral'
  return (
    <section
      aria-label={update.label}
      className="w-full min-w-0 rounded-xl border bg-card p-3 text-sm"
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon size={14} aria-hidden="true" />
        <span
          className={
            tone === 'danger'
              ? 'text-destructive'
              : tone === 'warning'
                ? 'text-status-warning'
                : undefined
          }
        >
          {update.label}
        </span>
        <span className="ml-auto">{update.watching ? 'Watching' : 'Watch ended'}</span>
      </div>
      <a
        href={update.url}
        target="_blank"
        rel="noreferrer"
        className="mt-2 flex min-w-0 items-start gap-2 font-medium hover:underline"
      >
        <span className="min-w-0 break-words">{update.title}</span>
        <ExternalLink size={13} className="mt-1 shrink-0" aria-hidden="true" />
      </a>
      <p className="mt-1 font-mono text-xs text-muted-foreground">{update.commit.slice(0, 8)}</p>
      {!!update.highlights.length && (
        <ul className="mt-2 space-y-1 text-xs">
          {update.highlights.slice(0, 4).map((item, index) => (
            <li key={index} className="break-words">
              {item}
            </li>
          ))}
          {update.highlights.length > 4 && (
            <li className="text-muted-foreground">+{update.highlights.length - 4} more</li>
          )}
        </ul>
      )}
      {!!update.details && (
        <details className="mt-2 border-t pt-2">
          <summary className="cursor-pointer text-xs text-muted-foreground">
            View {update.kind === 'pipeline' ? 'job results' : 'feedback'}
          </summary>
          <div className="mt-2 max-h-96 space-y-3 overflow-y-auto text-xs">
            {update.details.split('\n\n').map((block, index) => (
              <p key={index} className="whitespace-pre-wrap break-words">
                {block}
              </p>
            ))}
          </div>
        </details>
      )}
    </section>
  )
}
