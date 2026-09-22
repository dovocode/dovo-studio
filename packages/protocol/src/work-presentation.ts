import type { ForgeIssue, ForgePipeline } from './forge-work.js'

export type PipelineSignal = {
  label: string
  tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info'
  phase: 'active' | 'finished' | 'unknown'
}

function statusKey(status: string) {
  return status.toLowerCase().replace(/[\s_-]/g, '')
}

export function pipelineSignal(status: string): PipelineSignal {
  switch (statusKey(status)) {
    case 'success':
    case 'successful':
    case 'succeeded':
      return { label: 'Passed', tone: 'success', phase: 'finished' }
    case 'failure':
    case 'failed':
      return { label: 'Failed', tone: 'danger', phase: 'finished' }
    case 'error':
      return { label: 'Error', tone: 'danger', phase: 'finished' }
    case 'systemerror':
      return { label: 'System error', tone: 'danger', phase: 'finished' }
    case 'timedout':
      return { label: 'Timed out', tone: 'danger', phase: 'finished' }
    case 'partiallysucceeded':
      return { label: 'Partially succeeded', tone: 'warning', phase: 'finished' }
    case 'actionrequired':
      return { label: 'Action required', tone: 'warning', phase: 'finished' }
    case 'stale':
      return { label: 'Stale', tone: 'warning', phase: 'finished' }
    case 'expired':
      return { label: 'Expired', tone: 'warning', phase: 'finished' }
    case 'cancelled':
    case 'canceled':
      return { label: 'Cancelled', tone: 'neutral', phase: 'finished' }
    case 'stopped':
      return { label: 'Stopped', tone: 'neutral', phase: 'finished' }
    case 'skipped':
      return { label: 'Skipped', tone: 'neutral', phase: 'finished' }
    case 'notrun':
      return { label: 'Not run', tone: 'neutral', phase: 'finished' }
    case 'neutral':
      return { label: 'Neutral', tone: 'neutral', phase: 'finished' }
    case 'completed':
      return { label: 'Completed', tone: 'neutral', phase: 'finished' }
    case 'running':
    case 'inprogress':
      return { label: 'Running', tone: 'info', phase: 'active' }
    case 'queued':
    case 'notstarted':
    case 'ready':
      return { label: 'Queued', tone: 'info', phase: 'active' }
    case 'pending':
    case 'requested':
      return { label: 'Pending', tone: 'info', phase: 'active' }
    case 'waiting':
      return { label: 'Waiting', tone: 'warning', phase: 'active' }
    case 'postponed':
      return { label: 'Postponed', tone: 'warning', phase: 'active' }
    case 'blocked':
      return { label: 'Blocked', tone: 'warning', phase: 'active' }
    case 'paused':
      return { label: 'Paused', tone: 'warning', phase: 'active' }
    case 'cancelling':
    case 'canceling':
      return { label: 'Cancelling', tone: 'warning', phase: 'active' }
    default: {
      const label = status
        .trim()
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .toLowerCase()
      return {
        label: label ? label[0]!.toUpperCase() + label.slice(1) : 'Unknown',
        tone: 'neutral',
        phase: 'unknown',
      }
    }
  }
}

// Provider capabilities and workflow-definition availability are checked by the caller.
export function pipelineActionAllowed(
  action: 'rerun' | 'cancel' | 'enable' | 'disable',
  status: string,
): boolean {
  if (action === 'enable' || action === 'disable') return true
  const phase = pipelineSignal(status).phase
  if (action === 'rerun') return phase === 'finished'
  return phase === 'active' && !['cancelling', 'canceling'].includes(statusKey(status))
}

export function issueLabel(id: string): string {
  return /^\d+$/.test(id) ? `#${id}` : id
}

/** Active durations are elapsed so far; finished work needs a real completion time. */
export function pipelineDuration(
  timing: { status: string; startedAt?: string; completedAt?: string },
  now = Date.now(),
): string | undefined {
  if (!timing.startedAt) return undefined
  const start = Date.parse(timing.startedAt)
  const active = pipelineSignal(timing.status).phase === 'active'
  const end = timing.completedAt ? Date.parse(timing.completedAt) : active ? now : Number.NaN
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined
  const seconds = Math.floor((end - start) / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

export function matchesWorkItem(item: ForgeIssue | ForgePipeline, query: string): boolean {
  const metadata =
    'status' in item
      ? [
          item.ref,
          item.sha,
          item.actor,
          item.status,
          item.definition ?? '',
          item.number ?? '',
          item.workflow ?? '',
          item.event ?? '',
          item.commitMessage ?? '',
        ]
      : [
          item.author,
          item.state,
          item.type,
          ...item.assignees,
          ...(item.assigneeNames ?? []),
          ...item.labels,
        ]
  const text = [issueLabel(item.id), item.title, ...metadata].join(' ').toLowerCase()
  return query
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .every((part) => text.includes(part))
}
