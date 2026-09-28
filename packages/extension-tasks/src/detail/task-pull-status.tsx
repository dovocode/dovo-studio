import { useState } from 'react'
import { GitPullRequest, Wrench } from 'lucide-react'
import { fixChecksPrompt, pullStatusLabel } from '@dovo/protocol'
import { responses, useWorkspace, type Task } from '@dovo/studio-core'
import { Button, cn } from '@dovo/studio-ui'

/** The task's pull request at a glance, with a one-click fix request when checks fail. */
export function TaskPullStatus({ task }: { task: Task }) {
  const { request, connected } = useWorkspace()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const status = task.pullStatus
  if (!status) return null
  const failing = status.state === 'open' && status.checks === 'failed'
  const tone =
    status.state === 'merged'
      ? 'text-violet-400'
      : status.state === 'closed' || failing
        ? 'text-destructive'
        : status.checks === 'passed'
          ? 'text-emerald-400'
          : 'text-muted-foreground'
  const fix = () => {
    if (busy) return
    setBusy(true)
    setError('')
    void request(
      '/api/tasks/message',
      { id: task.id, messageId: crypto.randomUUID(), text: fixChecksPrompt(status) },
      responses.ok,
    )
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false))
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <a
        href={status.url}
        target="_blank"
        rel="noreferrer"
        title={
          status.failedChecks?.length ? `Failing: ${status.failedChecks.join(', ')}` : status.url
        }
        className={cn('inline-flex min-w-0 items-center gap-1 truncate hover:underline', tone)}
      >
        <GitPullRequest size={10} className="shrink-0" />
        <span className="truncate">{pullStatusLabel(status)}</span>
      </a>
      {failing && task.status !== 'running' && (
        <Button
          size="sm"
          variant="ghost"
          className="h-5 gap-1 px-1.5 text-[0.625rem]"
          disabled={!connected || busy}
          title={error || 'Ask the agent to fix the failing checks'}
          onClick={fix}
        >
          <Wrench className="size-3" />
          Fix
        </Button>
      )}
    </span>
  )
}
