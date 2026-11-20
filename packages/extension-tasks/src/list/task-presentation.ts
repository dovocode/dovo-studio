import {
  threadStatusTimestamp,
  formatThreadAge,
  formatTurnDuration,
  taskIsWorking,
} from '@dovo/protocol'
import { hasUnviewedTaskCompletion, type Task } from '@dovo/studio-core'
import { isSnoozed } from './task-priority'
export function taskPresentation(task: Task, needsInput: boolean, now: number, online = true) {
  const latest = task.turns?.at(-1)
  const started = latest?.startedAt ? Date.parse(latest.startedAt) : NaN
  const elapsed =
    task.status === 'running' && task.runPhase !== 'finalizing' && Number.isFinite(started)
  const working = taskIsWorking(task)
  const date = Date.parse(threadStatusTimestamp(task, latest) ?? '')
  const relativeAge = formatThreadAge(now - date)
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
                      review: '',
                      done: '',
                      failed: 'Failed',
                      cancelled: 'Stopped',
                    }[task.status]
  const showWorkingTime = elapsed && online && state === 'Working'
  const time = !Number.isFinite(date)
    ? ''
    : elapsed
      ? formatTurnDuration(now - date)
      : relativeAge === 'now'
        ? 'just now'
        : `${relativeAge} ago`
  const age = showWorkingTime ? time : relativeAge
  const tone: 'active' | 'attention' | 'success' | 'danger' | 'neutral' = [
    'Working',
    'Saving changes',
  ].includes(state)
    ? 'active'
    : state === 'Needs input'
      ? 'attention'
      : ['Done', 'Settled'].includes(state)
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
