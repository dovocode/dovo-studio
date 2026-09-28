import { useEffect, useState } from 'react'
import { Check, GitFork, LoaderCircle, RotateCcw, X } from 'lucide-react'
import { preparationElapsed, type TaskPreparation } from '@dovo/protocol'
import { Button } from '@dovo/studio-ui'

/** Step-by-step progress while the runtime creates a task's worktree and runs its setup. */
export function PreparationProgress({
  preparation,
  onRetry,
  retrying = false,
  retryError = '',
}: {
  preparation: TaskPreparation
  /** Offered when setup failed; starts the run again from the failed step. */
  onRetry?: () => void
  retrying?: boolean
  retryError?: string
}) {
  const [now, setNow] = useState(() => Date.now())
  const { failed } = preparation
  useEffect(() => {
    if (failed) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [failed])
  const active = preparation.steps.find(
    (step) => step.state === 'active' || step.state === 'failed',
  )
  const elapsed = failed ? '' : preparationElapsed(preparation.startedAt, now)
  return (
    <section
      aria-label="Worktree setup progress"
      className="mx-auto w-full max-w-[var(--chat-max)] px-5 py-2 motion-safe:animate-[dovo-fade-in_200ms_ease-out]"
    >
      <div
        className={`overflow-hidden rounded-lg border bg-card ${failed ? 'border-destructive/40' : ''}`}
      >
        <div className="flex items-center gap-2 px-3 pt-3 text-xs">
          <GitFork className="size-4 text-muted-foreground" aria-hidden />
          <span className="flex-1 font-medium">
            {failed ? 'Worktree setup stopped' : 'Setting up the worktree'}
          </span>
          {elapsed && (
            <span className="tabular-nums text-muted-foreground" aria-hidden>
              {elapsed}
            </span>
          )}
        </div>
        <ol className="space-y-1.5 px-3 py-3">
          {preparation.steps.map((step) => (
            <li
              key={step.id}
              aria-current={step.state === 'active' ? 'step' : undefined}
              className="flex min-w-0 items-center gap-2.5 text-xs"
            >
              <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden>
                {step.state === 'done' ? (
                  <span className="flex size-4 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
                    <Check className="size-3" strokeWidth={3} />
                  </span>
                ) : step.state === 'failed' ? (
                  <span className="flex size-4 items-center justify-center rounded-full bg-destructive/15 text-destructive">
                    <X className="size-3" strokeWidth={3} />
                  </span>
                ) : step.state === 'active' ? (
                  <LoaderCircle className="size-4 text-primary motion-safe:animate-spin" />
                ) : (
                  <span className="size-2 rounded-full border border-muted-foreground/50" />
                )}
              </span>
              <span
                className={
                  step.state === 'pending'
                    ? 'text-muted-foreground'
                    : step.state === 'failed'
                      ? 'font-medium text-destructive'
                      : step.state === 'active'
                        ? 'font-medium text-foreground'
                        : 'text-muted-foreground line-through decoration-muted-foreground/40'
                }
              >
                {step.label}
              </span>
              {step.detail && (
                <code
                  title={step.detail}
                  className="min-w-0 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[0.6875rem] text-muted-foreground"
                >
                  {step.detail}
                </code>
              )}
            </li>
          ))}
        </ol>
        {failed && (
          <div className="space-y-2 border-t px-3 py-3">
            {preparation.error && (
              <p
                role="alert"
                className="max-h-24 overflow-auto whitespace-pre-wrap break-words text-[0.6875rem] text-destructive"
              >
                {preparation.error}
              </p>
            )}
            {onRetry && (
              <div className="flex items-center gap-2">
                <Button size="sm" className="gap-1.5" disabled={retrying} onClick={onRetry}>
                  {retrying ? (
                    <LoaderCircle className="size-3.5 motion-safe:animate-spin" />
                  ) : (
                    <RotateCcw className="size-3.5" />
                  )}
                  Retry
                </Button>
                <span className="text-[0.6875rem] text-muted-foreground">
                  {retryError || 'Your message stays queued until the run starts.'}
                </span>
              </div>
            )}
          </div>
        )}
        <div
          hidden={failed}
          role="progressbar"
          aria-label={active ? `${active.label}` : 'Preparing'}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(preparation.progress * 100)}
          className="relative h-1 bg-muted"
        >
          <div
            className="absolute inset-y-0 left-0 bg-primary transition-[width] duration-500 ease-out motion-reduce:transition-none"
            style={{ width: `${Math.max(4, preparation.progress * 100)}%` }}
          />
          {/* A soft sweep keeps a long setup command visibly alive between step changes. */}
          <div className="absolute inset-y-0 w-1/4 bg-gradient-to-r from-transparent via-primary/60 to-transparent motion-safe:animate-[dovo-sweep_1.6s_ease-in-out_infinite] motion-reduce:hidden" />
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {active ? `${active.label}${active.detail ? `: ${active.detail}` : ''}` : ''}
      </p>
    </section>
  )
}
