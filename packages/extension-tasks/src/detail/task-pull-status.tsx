import { useState } from 'react'
import { Layers, Wrench, CircleCheck, CircleX, CircleDashed, GitMerge } from 'lucide-react'
import {
  randomUUID,
  fixChecksPrompt,
  pullStatusLabel,
  pullStackLabel,
  taskPullStatusFor,
} from '@dovo/protocol'
import { responses, useWorkspace, type Task } from '@dovo/studio-core'
import { PullRequestIcon, pullRequestIconTone, Button, cn } from '@dovo/studio-ui'

/** The task's pull request at a glance, with a one-click fix request when checks fail. */
export function TaskPullStatus({
  task,
  onPullLink,
  panel = false,
  title,
  url,
}: {
  task: Task
  panel?: boolean
  title?: string
  url?: string
  onPullLink?: (url: string) => boolean
}) {
  const { request, connected } = useWorkspace()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const status = url ? taskPullStatusFor(task, url) : task.pullStatus
  if (!status) return null
  const failing = status.state === 'open' && status.checks === 'failed'
  const tone =
    status.state === 'merged'
      ? 'text-status-done'
      : status.state === 'closed' || failing
        ? 'text-destructive'
        : status.checks === 'passed'
          ? 'text-status-success'
          : 'text-muted-foreground'
  const fix = () => {
    if (busy) return
    setBusy(true)
    setError('')
    void request(
      '/api/tasks/message',
      { id: task.id, messageId: randomUUID(), text: fixChecksPrompt(status) },
      responses.ok,
    )
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false))
  }
  return (
    <span
      className={
        panel
          ? 'studio-project-pull flex min-w-0 flex-wrap items-start'
          : 'inline-flex min-w-0 flex-wrap items-center gap-1'
      }
    >
      <a
        href={status.url}
        onClick={(event) => {
          if (onPullLink?.(status.url)) event.preventDefault()
        }}
        target="_blank"
        rel="noreferrer"
        aria-label={
          title ? `Open PR #${status.number}: ${title}. ${pullStatusLabel(status)}` : undefined
        }
        title={[
          title,
          status.failedChecks?.length ? `Failing: ${status.failedChecks.join(', ')}` : status.url,
        ]
          .filter(Boolean)
          .join(' · ')}
        className={cn(
          panel
            ? 'studio-project-row min-w-0 flex-1 items-start'
            : 'inline-flex min-w-0 items-center gap-1 truncate hover:underline',
          pullRequestIconTone(status.state, status.draft),
        )}
      >
        {status.stack ? (
          <Layers
            size={panel ? 18 : 12}
            className={cn('shrink-0', pullRequestIconTone(status.state, status.draft))}
          />
        ) : (
          <PullRequestIcon size={panel ? 18 : 10} state={status.state} draft={status.draft} />
        )}
        {panel ? (
          <span className="min-w-0 flex-1" title={title}>
            <span className="block truncate">{title || `Pull request #${status.number}`}</span>
            <span
              className="mt-1.5 flex items-center gap-3 text-xs"
              aria-label={pullStatusLabel(status)}
            >
              #{status.number}
              {status.state === 'merged' ? (
                <GitMerge size={15} className={tone} />
              ) : status.checks === 'passed' ? (
                <CircleCheck size={15} className={tone} />
              ) : status.checks === 'failed' || status.state === 'closed' ? (
                <CircleX size={15} className={tone} />
              ) : status.checks === 'pending' ? (
                <CircleDashed size={15} className={tone} />
              ) : null}
              {status.stack && <span>{pullStackLabel(status.stack)}</span>}
            </span>
          </span>
        ) : (
          <span className="truncate">
            {pullStatusLabel(status)}
            {status.stack ? ` · ${pullStackLabel(status.stack)}` : ''}
          </span>
        )}
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
      {error && (
        <span role="alert" className="basis-full whitespace-normal text-xs text-destructive">
          {error}
        </span>
      )}
    </span>
  )
}
