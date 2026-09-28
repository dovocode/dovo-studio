import type { Task } from '../workspace.js'

/** Agent time and reported tokens across the task's turns. Unknown token counts stay unknown. */
export function taskBudgetUsage(task: Pick<Task, 'turns' | 'budget'>, now = Date.now()) {
  const turns = task.turns ?? []
  const knownTokens = turns.some((turn) => turn.tokens !== undefined)
  const tokens = turns.reduce((sum, turn) => sum + (turn.tokens ?? 0), 0)
  const milliseconds = turns.reduce((sum, turn) => {
    const start = Date.parse(turn.startedAt)
    const end = turn.finishedAt ? Date.parse(turn.finishedAt) : now
    return sum + (Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0)
  }, 0)
  const minutes = milliseconds / 60000
  return {
    tokens: knownTokens ? tokens : undefined,
    minutes,
    tokenExceeded: task.budget?.tokens !== undefined && knownTokens && tokens >= task.budget.tokens,
    timeExceeded: task.budget?.minutes !== undefined && minutes >= task.budget.minutes,
  }
}
