import { mutableStruct, taskFamilyWorking } from '@dovo/protocol'
import {
  automationSchema,
  jobRunSchema,
  attachmentSchema,
  type JobRunStep,
  type Task,
  type TaskSummary,
} from '@dovo/protocol'
import { Schema } from 'effect'
import { createHash } from 'node:crypto'
export const storedRunSchema = mutableStruct({
  retryTurnId: Schema.optional(Schema.String),
  outputs: Schema.optional(
    Schema.Record(
      Schema.String,
      mutableStruct({
        taskId: Schema.String,
        text: Schema.String,
        attachments: Schema.Array(attachmentSchema),
        longAnswer: Schema.optional(
          mutableStruct({ excerpt: Schema.String, digest: Schema.String }),
        ),
      }),
    ),
  ),
  ...jobRunSchema.fields,
  sourceHash: Schema.optional(Schema.String),
  sourceJsonPointer: Schema.optional(Schema.String),
  previousSourceText: Schema.optional(Schema.String),
  sourceUrl: Schema.optional(Schema.String),
  sourceText: Schema.optional(Schema.String),
  sourceChecked: Schema.optional(Schema.Boolean),
  ...{
    flow: automationSchema,
    triggerPayload: Schema.optional(Schema.Unknown),
    deliveryKey: Schema.optional(Schema.String),
  },
})
export type StoredRun = Schema.Schema.Type<typeof storedRunSchema>
type StepOutput = NonNullable<StoredRun['outputs']>[string]
const stepTextLimit = 32768
const truncationNote =
  '\n[Result truncated at 32768 characters. Read the preceding task for the rest.]'

/** Reuse the saved answer for the step, including files. Legacy recovery can read the
 * worker up to the saved step finish so a later manual turn cannot become its result. */
export function stepOutput(task: Task, finishedAt?: string): StepOutput {
  const turns = finishedAt ? task.turns?.filter((turn) => turn.startedAt <= finishedAt) : task.turns
  const turn = turns?.at(-1)
  const replies = task.messages.filter(
    (message) =>
      message.role === 'assistant' &&
      (!finishedAt || !message.createdAt || message.createdAt <= finishedAt) &&
      (!turn ||
        message.id === turn.assistantId ||
        message.turnId === turn.id ||
        (!message.turnId && !!message.createdAt && message.createdAt >= turn.startedAt)),
  )
  const text = replies
    .map((message) => message.text)
    .filter(Boolean)
    .join('\n\n')
  return {
    taskId: task.id,
    ...(text.length > stepTextLimit
      ? {
          text: `${text.slice(0, stepTextLimit)}${truncationNote}`,
          longAnswer: {
            excerpt: text.slice(-3000),
            digest: createHash('sha256').update(text).digest('hex'),
          },
        }
      : { text }),
    attachments: [
      ...new Map(
        replies.flatMap((message) => message.attachments ?? []).map((file) => [file.id, file]),
      ).values(),
    ],
  }
}

export function reportStepOutput(
  saved: StepOutput | undefined,
  readTask: () => Task | undefined,
  finishedAt?: string,
) {
  if (
    saved &&
    (saved.longAnswer ||
      saved.text.length !== stepTextLimit + truncationNote.length ||
      !saved.text.endsWith(truncationNote))
  )
    return saved
  // Older runs kept the beginning of a long answer. Recover the ending from its original turn.
  const task = readTask()
  return task ? stepOutput(task, finishedAt) : saved
}
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
export function reconcileCompletedTasks(
  run: StoredRun,
  tasks: TaskSummary[],
  readTask: (id: string) => Task,
): StoredRun {
  const completedNodes = [...run.completedNodes]
  let outputs = run.outputs
  const steps = runSteps(run).map((step) => {
    if (!step.taskId) return step
    // Bot steps share a long-lived thread; their own message decides completion.
    if (run.flow.nodes.find((node) => node.id === step.nodeId)?.data.botId === step.taskId)
      return step
    const task = tasks.find((task) => task.id === step.taskId)
    if (!task) return step
    if (completedNodes.includes(step.nodeId)) {
      if (!outputs?.[step.nodeId])
        outputs = { ...outputs, [step.nodeId]: stepOutput(readTask(task.id), step.finishedAt) }
      return step
    }
    if (!['review', 'done'].includes(task.status) || taskFamilyWorking(tasks, task.id)) return step
    if (!outputs?.[step.nodeId])
      outputs = { ...outputs, [step.nodeId]: stepOutput(readTask(task.id)) }
    completedNodes.push(step.nodeId)
    return {
      ...step,
      status: 'completed' as const,
      finishedAt: task.history.latestTurn?.finishedAt ?? task.updatedAt,
      error: undefined,
    }
  })
  return {
    ...run,
    completedNodes,
    outputs,
    steps,
  }
}
