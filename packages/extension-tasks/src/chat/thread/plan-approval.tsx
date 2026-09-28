import { useState } from 'react'
import { ClipboardCheck } from 'lucide-react'
import { IMPLEMENT_PLAN_PROMPT, planAwaitingApproval } from '@dovo/protocol'
import { responses, useWorkspace, type Task } from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'

/** After a plan-mode reply: approve with one click, or type changes in the composer. */
export function PlanApproval({ task }: { task: Task }) {
  const { request, connected } = useWorkspace()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!planAwaitingApproval(task)) return null
  const implement = () => {
    if (busy) return
    setBusy(true)
    setError('')
    void request(
      '/api/tasks/message',
      { id: task.id, messageId: crypto.randomUUID(), text: IMPLEMENT_PLAN_PROMPT },
      responses.ok,
    )
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false))
  }
  return (
    <section aria-label="Plan ready" className="mx-auto w-full max-w-[var(--chat-max)] px-5 pb-2">
      <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
        <ClipboardCheck className="size-4 text-primary" aria-hidden />
        <span className="flex-1">
          {error || 'The agent proposed a plan. Implement it, or reply with changes.'}
        </span>
        <Button size="sm" className="h-7" disabled={!connected || busy} onClick={implement}>
          Implement plan
        </Button>
      </div>
    </section>
  )
}
