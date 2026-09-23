import type { Automation, JobRun, RuntimeSnapshot } from '@dovo/studio-core'
export type RunStep = NonNullable<JobRun['steps']>[number]
export const stepLabels = {
  pending: 'Queued',
  running: 'Working',
  waiting: 'Needs review',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
} satisfies Record<RunStep['status'], string>
export const runLabels = {
  running: 'Working',
  waiting: 'Needs review',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
} satisfies Record<JobRun['status'], string>
export function runSteps(run: JobRun, flow: Automation): RunStep[] {
  // New runs carry their own step snapshot, so editing the graph cannot rewrite run history.
  if (run.steps) return run.steps
  return flow.nodes.map((node) => ({
    nodeId: node.id,
    label: node.data.label,
    kind: node.data.kind,
    attempt: 1,
    status: run.completedNodes.includes(node.id)
      ? 'completed'
      : run.waitingNodeId === node.id
        ? 'waiting'
        : run.failedNodeId === node.id
          ? 'failed'
          : run.currentNodeId === node.id
            ? 'running'
            : 'pending',
  }))
}
export function elapsed(
  start: string | undefined,
  end: string | undefined,
  now: number,
): string | null {
  if (!start) return null
  const milliseconds = (end ? Date.parse(end) : now) - Date.parse(start)
  if (!Number.isFinite(milliseconds)) return null
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds / 60) % 60}m`
}
export const liveRun = (run: JobRun) => run.status === 'running' || run.status === 'waiting'
export function pendingTaskInput(snapshot: RuntimeSnapshot | null, taskId?: string) {
  if (!taskId) return null
  return (
    snapshot?.approvals.find((item) => item.taskId === taskId)?.title ??
    snapshot?.questions.find((item) => item.taskId === taskId)?.prompt.title ??
    null
  )
}
