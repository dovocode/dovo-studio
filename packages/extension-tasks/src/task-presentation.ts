import { hasUnviewedTaskCompletion, type Task } from '@dovo/studio-core'
import { isSnoozed } from './task-priority'
export function taskPresentation(task: Task, needsInput: boolean, now: number) {
  const latest = task.turns?.at(-1)
  const finished = latest?.finishedAt ? Date.parse(latest.finishedAt) : NaN
  const started = latest?.startedAt ? Date.parse(latest.startedAt) : NaN
  const elapsed = task.status === 'running' && Number.isFinite(started)
  const date = elapsed ? started : finished
  const seconds = Math.max(0, Math.floor((now - date) / 1000))
  const time = !Number.isFinite(date)
    ? ''
    : elapsed
      ? seconds < 60
        ? `${seconds}s`
        : seconds < 3600
          ? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
          : `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
      : seconds < 60
        ? 'just now'
        : seconds < 3600
          ? `${Math.floor(seconds / 60)}m ago`
          : seconds < 86400
            ? `${Math.floor(seconds / 3600)}h ago`
            : `${Math.floor(seconds / 86400)}d ago`
  const state = task.archivedAt
    ? 'Archived'
    : task.archived
      ? 'Settled'
      : isSnoozed(task, now)
        ? 'Snoozed'
        : needsInput
          ? 'Needs input'
          : hasUnviewedTaskCompletion(task)
            ? 'Done'
            : {
                draft: 'Draft',
                running: 'Working',
                review: 'Review',
                done: 'Finished',
                failed: 'Failed',
                cancelled: 'Stopped',
              }[task.status]
  const compactLabel =
    state === 'Working'
      ? `Working ${time}`.trim()
      : ['Needs input', 'Failed', 'Stopped', 'Done', 'Archived', 'Settled', 'Snoozed'].includes(
            state,
          )
        ? state
        : time.replace(' ago', '') || state
  return {
    state,
    time,
    compactLabel,
    label: [state, time].filter(Boolean).join(' · '),
  }
}
