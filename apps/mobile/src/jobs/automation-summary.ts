import type { JobRun, RuntimeSnapshot } from '@dovo/protocol'
export function automationRuns(automationId: string, runs: readonly JobRun[]) {
  const history = runs
    .filter((run) => run.automationId === automationId)
    .sort((a, b) => Date.parse(b.updatedAt ?? b.createdAt) - Date.parse(a.updatedAt ?? a.createdAt))
  const active = history.find((run) => run.status === 'running' || run.status === 'waiting')
  return {
    history,
    active,
    latest: active ?? history[0],
  }
}
export function automationRunSummary(run: JobRun, inputTasks: ReadonlySet<string>) {
  const steps = run.steps?.filter((step) => step.kind !== 'trigger')
  const current = steps?.find(
    (step) => step.nodeId === (run.currentNodeId ?? run.waitingNodeId ?? run.failedNodeId),
  )
  const needsInput = !!current?.taskId && inputTasks.has(current.taskId)
  const status = needsInput
    ? 'Needs input'
    : run.retryAt
      ? 'Waiting for provider'
      : current?.status === 'running' && current.queuedAt && !current.workStartedAt
        ? 'Waiting for worker'
        : run.status === 'waiting'
          ? 'Needs review'
          : run.status === 'running'
            ? 'Running'
            : run.status === 'completed'
              ? 'Completed'
              : run.status === 'cancelled'
                ? 'Cancelled'
                : run.interrupted
                  ? 'Interrupted'
                  : 'Failed'
  return {
    steps,
    current,
    needsInput,
    status,
    active: run.status === 'running' || run.status === 'waiting',
    progress: steps
      ? `${steps.filter((step) => step.status === 'completed').length} of ${steps.length} steps`
      : `${run.completedNodes.length} steps completed`,
  }
}

export function automationRowState(automationId: string, snapshot: RuntimeSnapshot) {
  const { latest } = automationRuns(automationId, snapshot.runs)
  const summary = latest
    ? automationRunSummary(
        latest,
        new Set([...snapshot.questions, ...snapshot.approvals].map((request) => request.taskId)),
      )
    : null
  return {
    latest,
    summary,
    needsAttention:
      !!summary?.needsInput || latest?.status === 'waiting' || latest?.status === 'failed',
  }
}
