import { useState } from 'react'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { formatSpendUsd } from '@dovo/protocol'
import { responses, useWorkspace, type Task } from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'

/** New unattended work in this thread waits at the computer's spend limit. */
export function SpendPauseNotice({ task }: { task: Task }) {
  const uiText = useInterfaceText()
  const { request, connected } = useWorkspace()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pause = task.spendPause
  if (!pause) return null
  const unpriced =
    pause.unpricedTurns === 1
      ? uiText('1 turn has no price, so the total is unknown.')
      : pause.unpricedTurns
        ? uiText('{value0} turns have no price, so the total is unknown.', {
            value0: pause.unpricedTurns,
          })
        : ''
  return (
    <div
      role="status"
      className="mx-auto flex w-full max-w-[var(--chat-max)] flex-wrap items-center gap-2 px-5 py-2 text-xs text-muted-foreground"
    >
      <span className="min-w-0 flex-1">
        {[
          uiText(
            'Paused: spend limit. {value0} estimated since your last message (limit {value1}).',
            {
              value0: formatSpendUsd(pause.spentUsd),
              value1: formatSpendUsd(pause.limitUsd),
            },
          ),
          unpriced,
          uiText('Costs are estimates. Continue starts the held work.'),
        ]
          .filter(Boolean)
          .join(' ')}
      </span>
      <Button
        size="sm"
        variant="outline"
        disabled={!connected || busy}
        onClick={() => {
          setBusy(true)
          setError('')
          void request('/api/tasks/spend-limit/continue', { id: task.id }, responses.ok)
            .catch((cause: unknown) =>
              setError(cause instanceof Error ? cause.message : String(cause)),
            )
            .finally(() => setBusy(false))
        }}
      >
        {uiText('Continue')}
      </Button>
      {error && <span role="alert">{error}</span>}
    </div>
  )
}
