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
  const seconds = Math.max(
    0,
    Math.round(
      ((turn.finishedAt ? Date.parse(turn.finishedAt) : now) - Date.parse(turn.startedAt)) / 1000,
    ),
  )
  return (
    <span className="text-xs text-muted-foreground">
      {turn.status === 'running'
        ? 'Working for'
        : turn.status === 'failed'
          ? 'Failed after'
          : turn.status === 'cancelled'
            ? 'Stopped after'
            : 'Worked for'}{' '}
      {seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`}
    </span>
  )
}
