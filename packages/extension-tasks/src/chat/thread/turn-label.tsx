import { formatTurnDuration } from '@dovo/protocol'
import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect } from 'react'
import type { TaskTurn } from '@dovo/studio-core'
export function TurnLabel({ turn }: { turn: TaskTurn }) {
  const [now, setNow] = useApplicationState(Date.now())
  useEffect(() => {
    if (turn.finishedAt || turn.status !== 'running') return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [turn.finishedAt, turn.status])
  const startedAt = Date.parse(turn.startedAt)
  const elapsed = turn.finishedAt
    ? Math.round((Date.parse(turn.finishedAt) - startedAt) / 1000) * 1000
    : now - startedAt
  return (
    <span className="text-xs text-muted-foreground">
      {turn.status === 'running'
        ? 'Working for'
        : turn.status === 'failed'
          ? 'Failed after'
          : turn.status === 'cancelled'
            ? 'Stopped after'
            : 'Worked for'}{' '}
      {formatTurnDuration(elapsed)}
    </span>
  )
}
