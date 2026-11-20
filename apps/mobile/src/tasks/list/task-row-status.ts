import {
  formatThreadAge,
  formatTurnDuration,
  threadStatusTimestamp,
  taskIsWorking,
  isSnoozed,
  hasUnviewedTaskCompletion,
  type Task,
} from '@dovo/protocol'

export function workingThreadAge(task: Task, state: string, now: number) {
  if (state !== 'Working' || task.status !== 'running') return ''
  const date = threadStatusTimestamp(task, task.turns?.at(-1))
  return formatTurnDuration(now - Date.parse(date ?? ''))
}

/** Input, snooze and failures take priority over an unread successful completion. */
export function showTaskDone(task: Task, needsInput: boolean, now: number) {
  return (
    !task.archived &&
    !task.archivedAt &&
    !task.waitingForFeedback &&
    !needsInput &&
    !isSnoozed(task, now) &&
    hasUnviewedTaskCompletion(task)
  )
}

/** Keep the status and age separate so read completions can show the age alone. */
export function taskRowPresentation(task: Task, needsInput: boolean, online: boolean, now: number) {
  const turn = task.turns?.at(-1)
  const working = taskIsWorking(task)
  const state = task.archivedAt
    ? 'Archived'
    : task.archived
      ? 'Settled'
      : needsInput
        ? 'Needs input'
        : isSnoozed(task, now)
          ? 'Snoozed'
          : working
            ? online
              ? task.status === 'running' && task.runPhase === 'finalizing'
                ? 'Saving changes'
                : 'Working'
              : 'Was working'
            : task.status === 'failed'
              ? 'Failed'
              : task.waitingForFeedback
                ? 'Waiting'
                : showTaskDone(task, needsInput, now)
                  ? 'Done'
                  : task.status === 'cancelled'
                    ? 'Stopped'
                    : task.status === 'draft'
                      ? 'Draft'
                      : ''
  const date = threadStatusTimestamp(task, turn)
  const age =
    workingThreadAge(task, state, now) || (date ? formatThreadAge(now - Date.parse(date)) : '')
  return { state, age, label: [state, age].filter(Boolean).join(' · ') }
}

export function taskRowStatus(task: Task, needsInput: boolean, online: boolean, now: number) {
  return taskRowPresentation(task, needsInput, online, now).label
}
