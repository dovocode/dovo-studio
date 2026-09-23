import { mutableStruct } from '@dovo/protocol'
import { automationSchema, jobRunSchema, type JobRunStep, type Task } from '@dovo/protocol'
import { Schema } from 'effect'
export const storedRunSchema = mutableStruct({
  ...jobRunSchema.fields,
  ...{
    flow: automationSchema,
    triggerPayload: Schema.optional(Schema.Unknown),
    deliveryKey: Schema.optional(Schema.String),
  },
})
export type StoredRun = Schema.Schema.Type<typeof storedRunSchema>
export function runSteps(run: StoredRun): JobRunStep[] {
  // Before step metadata existed, tasks were appended in execution order. Completed
  // nodes preserve that order; at most one additional task could be in flight.
  const completedTasks = run.completedNodes.filter((id) =>
    run.flow.nodes.some((node) => node.id === id && node.data.kind === 'task'),
  )
  const pendingTask = run.flow.nodes.find(
    (node) =>
      node.data.kind === 'task' &&
      !run.completedNodes.includes(node.id) &&
      run.flow.edges
        .filter((edge) => edge.target === node.id)
        .every((edge) => run.completedNodes.includes(edge.source)),
  )
  const taskNodes = [...completedTasks, ...(pendingTask ? [pendingTask.id] : [])]
  return run.flow.nodes.map((node) => {
    const existing = run.steps?.find((step) => step.nodeId === node.id)
    if (existing) return existing
    const taskIndex = taskNodes.indexOf(node.id)
    const taskId = taskIndex < 0 ? undefined : run.taskIds[taskIndex]
    const completed = run.completedNodes.includes(node.id)
    const active = !completed && (run.currentNodeId === node.id || !!taskId)
    return {
      nodeId: node.id,
      label: node.data.label,
      kind: node.data.kind,
      taskId,
      status: completed
        ? 'completed'
        : run.waitingNodeId === node.id
          ? 'waiting'
          : active
            ? run.status === 'failed'
              ? 'failed'
              : run.status === 'cancelled'
                ? 'cancelled'
                : 'running'
            : 'pending',
      attempt: completed || active || run.waitingNodeId === node.id ? 1 : 0,
    }
  })
}
export function updateStep(
  run: StoredRun,
  nodeId: string,
  changes: Partial<JobRunStep>,
): StoredRun {
  return {
    ...run,
    steps: runSteps(run).map((step) =>
      step.nodeId === nodeId
        ? {
            ...step,
            ...changes,
          }
        : step,
    ),
  }
}
export function reconcileCompletedTasks(run: StoredRun, tasks: Task[]): StoredRun {
  const completedNodes = [...run.completedNodes]
  const steps = runSteps(run).map((step) => {
    if (completedNodes.includes(step.nodeId) || !step.taskId) return step
    const task = tasks.find((task) => task.id === step.taskId)
    if (!task || !['review', 'done'].includes(task.status)) return step
    completedNodes.push(step.nodeId)
    return {
      ...step,
      status: 'completed' as const,
      finishedAt: task.turns?.at(-1)?.finishedAt ?? task.updatedAt,
      error: undefined,
    }
  })
  return {
    ...run,
    completedNodes,
    steps,
  }
}
