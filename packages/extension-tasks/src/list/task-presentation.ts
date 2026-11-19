import {
  threadStatusTimestamp,
  formatThreadAge,
  formatTurnDuration,
  taskIsWorking,
} from '@dovo/protocol'
import { hasUnviewedTaskCompletion, type Task } from '@dovo/studio-core'
import { isSnoozed } from './task-priority'
export function taskPresentation(task: Task, needsInput: boolean, now: number) {
  const latest = task.turns?.at(-1)
  const started = latest?.startedAt ? Date.parse(latest.startedAt) : NaN
  const elapsed =
    task.status === 'running' && task.runPhase !== 'finalizing' && Number.isFinite(started)
  const working = taskIsWorking(task)
  const date = Date.parse(threadStatusTimestamp(task, latest) ?? '')
  const age = formatThreadAge(now - date)
  const time = !Number.isFinite(date)
    ? ''
    : elapsed
      ? formatTurnDuration(now - date)
      : age === 'now'
        ? 'just now'
        : `${age} ago`
  const state = task.archivedAt
    ? 'Archived'
    : task.archived
      ? 'Settled'
      : isSnoozed(task, now)
        ? 'Snoozed'
        : needsInput
          ? 'Needs input'
          : task.bot?.state === 'paused' && !working
            ? 'Paused'
            : working
              ? task.status === 'running' && task.runPhase === 'finalizing'
                ? 'Saving changes'
                : 'Working'
              : task.waitingForFeedback
                ? 'Waiting'
                : hasUnviewedTaskCompletion(task)
                  ? 'Done'
                  : {
                      draft: 'Draft',
                      running: task.runPhase === 'finalizing' ? 'Saving changes' : 'Working',
                      review: 'Review',
                      done: 'Finished',
                      failed: 'Failed',
                      cancelled: 'Stopped',
                    }[task.status]
  const tone: 'active' | 'attention' | 'success' | 'danger' | 'neutral' = [
    'Working',
    'Saving changes',
  ].includes(state)
    ? 'active'
    : ['Review', 'Needs input'].includes(state)
      ? 'attention'
      : ['Done', 'Finished', 'Settled'].includes(state)
        ? 'success'
        : state === 'Failed'
          ? 'danger'
          : 'neutral'
  const compactLabel =
    state === 'Working'
      ? `Working ${time}`.trim()
      : [
            'Needs input',
            'Failed',
            'Stopped',
            'Done',
            'Review',
            'Finished',
            'Archived',
            'Settled',
            'Waiting',
            'Snoozed',
            'Saving changes',
            'Paused',
          ].includes(state)
        ? state
        : time.replace(' ago', '') || state
  return {
    state,
    tone,
    age,
    time,
    compactLabel,
    label: [state, time].filter(Boolean).join(' · '),
  }
}
