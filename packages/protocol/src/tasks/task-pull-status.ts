import type { Task } from '../workspace.js'

export type CheckOutcome = 'passed' | 'failed' | 'pending' | 'neutral'

/** Forges report check status in different words and cases; group them for summaries. */
export function checkOutcome(status: string): CheckOutcome {
  const value = status.toLowerCase().replace(/[\s-]+/g, '_')
  if (['success', 'succeeded', 'successful', 'pass', 'passed'].includes(value)) return 'passed'
  if (
    [
      'failure',
      'failed',
      'error',
      'errored',
      'timed_out',
      'cancelled',
      'canceled',
      'action_required',
      'startup_failure',
      'stopped',
      'rejected',
    ].includes(value)
  )
    return 'failed'
  if (
    [
      'pending',
      'queued',
      'in_progress',
      'inprogress',
      'running',
      'waiting',
      'requested',
      'expected',
      'notstarted',
      'not_started',
    ].includes(value)
  )
    return 'pending'
  return 'neutral'
}

export type TaskPullStatus = NonNullable<Task['pullStatus']>

/** One line for the task: the pull request's state and its checks. */
export function pullStatusLabel(status: TaskPullStatus) {
  if (status.state === 'merged') return `PR #${status.number} merged`
  if (status.state === 'closed') return `PR #${status.number} closed`
  if (status.checks === 'failed')
    return `PR #${status.number} · ${status.failedChecks?.length ? `${status.failedChecks.length} failing` : 'checks failing'}`
  if (status.checks === 'pending') return `PR #${status.number} · checks running`
  if (status.checks === 'passed') return `PR #${status.number} · checks passed`
  return `PR #${status.number} open`
}

/** The follow-up that asks the agent to fix failing checks. */
export function fixChecksPrompt(status: TaskPullStatus) {
  const names = status.failedChecks?.length ? `: ${status.failedChecks.join(', ')}` : ''
  return `The checks on pull request #${status.number} are failing${names}. Investigate the failures, fix them, and push the fix.`
}
