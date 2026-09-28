import { useState } from 'react'
import { SearchCheck, Wrench } from 'lucide-react'
import { fixFindingsPrompt, reviewFindings, type ReviewFinding } from '@dovo/protocol'
import { responses, useWorkspace, type Task } from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'

/** The agent's own review, as a list: open a finding, or ask for fixes. */
export function ReviewFindings({
  task,
  onOpen,
  className = '',
}: {
  task: Task
  onOpen?: (finding: ReviewFinding) => void
  className?: string
}) {
  const { request, connected } = useWorkspace()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const findings = reviewFindings(task)
  if (!findings.length) return null
  const fix = (items: readonly ReviewFinding[]) => {
    if (busy) return
    setBusy(true)
    setError('')
    void request(
      '/api/tasks/message',
      { id: task.id, messageId: crypto.randomUUID(), text: fixFindingsPrompt(items) },
      responses.ok,
    )
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false))
  }
  return (
    <section
      aria-label="Review findings"
      className={`mx-auto w-full max-w-[var(--chat-max)] ${className}`}
    >
      <div className="rounded-lg border bg-card text-xs">
        <div className="flex items-center gap-2 px-3 py-2">
          <SearchCheck className="size-4 text-muted-foreground" aria-hidden />
          <span className="flex-1 font-medium">
            {findings.length} review {findings.length === 1 ? 'finding' : 'findings'}
          </span>
          <Button
            size="sm"
            className="h-7 gap-1"
            disabled={!connected || busy}
            onClick={() => fix(findings)}
          >
            <Wrench className="size-3.5" /> Fix all
          </Button>
        </div>
        <ul className="max-h-48 space-y-0.5 overflow-y-auto border-t px-1 py-1">
          {findings.map((finding, index) => (
            <li key={index} className="flex items-start gap-1 rounded px-2 py-1 hover:bg-muted/40">
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => onOpen?.(finding)}
              >
                <span className="font-mono text-[0.6875rem] text-muted-foreground">
                  {finding.path}:{finding.line}
                </span>
                <span className="block">{finding.text}</span>
              </button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 shrink-0 px-2 text-[0.625rem]"
                disabled={!connected || busy}
                onClick={() => fix([finding])}
              >
                Fix
              </Button>
            </li>
          ))}
        </ul>
        {error && (
          <p role="alert" className="border-t px-3 py-2 text-destructive">
            {error}
          </p>
        )}
      </div>
    </section>
  )
}
