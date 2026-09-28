import type { Task } from '../workspace.js'

export type PreparationStepState = 'done' | 'active' | 'pending' | 'failed'
export type PreparationStep = {
  id: string
  label: string
  detail?: string
  state: PreparationStepState
}
export type TaskPreparation = {
  steps: PreparationStep[]
  /** 0–1: finished steps plus half of the active one, for a progress bar. */
  progress: number
  /** When the active step started, as reported by the runtime. */
  startedAt: string
  /** The run stopped on the active step; `error` says why and the task can be retried. */
  failed: boolean
  error?: string
}

const labels: Record<string, string> = {
  fetch: 'Fetch latest from origin',
  pull: 'Fetch the pull request',
  worktree: 'Create worktree',
  restore: 'Restore worktree',
  setup: 'Run setup command',
  agent: 'Start the agent',
}
// A newer runtime may report a step this client does not know; still show it readably.
const readable = (id: string) => {
  const words = id.replace(/[-_]+/g, ' ').trim()
  return words ? words[0].toUpperCase() + words.slice(1) : 'Prepare'
}
function detail(task: Task, id: string) {
  const preparation = task.preparation
  if ((id === 'worktree' || id === 'restore') && preparation?.branch) return preparation.branch
  if (id === 'pull' && task.pullRequest) return `#${task.pullRequest.number}`
  if (id === 'setup') {
    const command = task.setupCommand?.trim().split('\n')[0]?.trim()
    if (command) return command.length > 80 ? `${command.slice(0, 79)}…` : command
  }
  return undefined
}

/** The checkout steps of a run that is preparing, or that failed while preparing. Undefined
 * when there is nothing to show beyond the plain "Preparing" line (no worktree work, or an
 * older runtime). */
export function taskPreparation(task: Task): TaskPreparation | undefined {
  const preparation = task.preparation
  if (!preparation?.steps.length) return undefined
  const failed = !!preparation.failed && task.status === 'failed'
  if (!failed && (task.status !== 'running' || task.runPhase !== 'preparing')) return undefined
  const active = preparation.steps.indexOf(preparation.current)
  const state = (index: number): PreparationStepState =>
    active < 0 || index > active
      ? 'pending'
      : index < active
        ? 'done'
        : failed
          ? 'failed'
          : 'active'
  const steps = preparation.steps.map((id, index): PreparationStep => ({
    id,
    label: labels[id] ?? readable(id),
    detail: detail(task, id),
    state: state(index),
  }))
  return {
    steps,
    progress: active < 0 ? 0 : (active + 0.5) / steps.length,
    startedAt: preparation.startedAt,
    failed,
    ...(failed && task.error ? { error: task.error } : {}),
  }
}

/** Seconds spent on the active step, e.g. "12s" or "2m 05s"; empty for the first few
 * seconds or an unreadable time. Clock skew between devices never shows a negative time. */
export function preparationElapsed(startedAt: string, now = Date.now()) {
  const started = Date.parse(startedAt)
  if (!Number.isFinite(started)) return ''
  const seconds = Math.max(0, Math.floor((now - started) / 1000))
  if (seconds < 3) return ''
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
}
