import { isSnoozed, hasUnviewedTaskCompletion, type Task } from '@dovo/protocol'
function age(date: string, now: number) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(date)) / 60000))
  return minutes < 1
    ? 'now'
    : minutes < 60
      ? `${minutes}m`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)}h`
        : `${Math.floor(minutes / 1440)}d`
}

/** Input, snooze and failures take priority over an unread successful completion. */
export function showTaskDone(task: Task, needsInput: boolean, now: number) {
  return !needsInput && !isSnoozed(task, now) && hasUnviewedTaskCompletion(task)
}

/** Time supplements state without hiding warnings or unread results. */
export function taskRowStatus(task: Task, needsInput: boolean, online: boolean, now: number) {
  const turn = task.turns?.at(-1)
  const state = task.archivedAt
    ? 'Archived'
    : task.archived
      ? 'Settled'
      : needsInput
        ? 'Needs input'
        : isSnoozed(task, now)
          ? 'Snoozed'
          : task.status === 'running'
            ? online
              ? 'Working'
              : 'Was working'
            : task.status === 'failed'
              ? 'Failed'
              : showTaskDone(task, needsInput, now)
                ? 'Done'
                : task.status === 'review'
                  ? 'Review'
                  : task.status === 'done'
                    ? 'Finished'
                    : task.status === 'cancelled'
                      ? 'Stopped'
                      : 'Draft'
  const date = task.status === 'running' ? turn?.startedAt : turn?.finishedAt
  return date && !needsInput ? `${state} · ${age(date, now)}` : state
}
