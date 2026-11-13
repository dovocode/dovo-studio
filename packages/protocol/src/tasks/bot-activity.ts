import { latestTaskTurn, type Task } from '../workspace.js'
import { taskPromptTime } from './task-priority.js'

/** Settings edits and read receipts are not conversation activity. */
export function compareBotActivity(a: Task, b: Task) {
  const activity = (task: Task) => {
    const turn = latestTaskTurn(task)
    return (
      [taskPromptTime(task), turn?.finishedAt ?? '', turn?.startedAt ?? ''].sort().at(-1) ??
      task.createdAt
    )
  }
  return (
    Number(!!b.pinned) - Number(!!a.pinned) ||
    activity(b).localeCompare(activity(a)) ||
    a.id.localeCompare(b.id)
  )
}
