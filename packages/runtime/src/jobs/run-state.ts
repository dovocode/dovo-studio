import { mutableStruct, taskFamilyWorking } from '@dovo/protocol'
import {
  automationSchema,
  jobRunSchema,
  attachmentSchema,
  type JobRunStep,
  type JobRunFailure,
  type Task,
  type TaskSummary,
} from '@dovo/protocol'
import { Schema } from 'effect'
import { createHash } from 'node:crypto'
import { botStepTurn } from './bot-step.js'
import { readStepResult } from './step-result.js'
import { redact } from '../storage/activity.js'
export const storedRunSchema = mutableStruct({
  readyToAdvance: Schema.optional(Schema.Literal(true)),
  pausedDurationMs: Schema.optional(Schema.Number),
  stepAdmission: Schema.optional(
    mutableStruct({
      nodeId: Schema.String,
      order: Schema.Int,
      phase: Schema.Literals(['queued', 'reserved', 'executing']),
    }),
  ),
  resumeAfterPipelineWait: Schema.optional(Schema.Literal(true)),
  retryTurnId: Schema.optional(Schema.String),
  outputs: Schema.optional(
    Schema.Record(
      Schema.String,
      mutableStruct({
        taskId: Schema.String,
        text: Schema.String,
        attachments: Schema.Array(attachmentSchema),
        result: Schema.optional(Schema.Json),
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

export function runFailures(run: StoredRun): JobRunFailure[] | undefined {
  const attempt = run.attempt ?? 1
  if (run.status !== 'failed' || run.failures?.some((failure) => failure.attempt === attempt))
    return run.failures
  const step = runSteps(run).find((step) => step.nodeId === run.failedNodeId)
  const raw = step?.error ?? run.error
  const failure = {
    attempt,
    failedAt: run.finishedAt ?? run.updatedAt ?? run.createdAt,
    nodeId: step?.nodeId,
    stepAttempt: step?.attempt,
    taskId: step?.taskId,
    turnId: step?.turnId,
    error: raw
      ? String((redact({ error: raw }) as { error: unknown }).error).slice(0, 1000)
      : undefined,
  }
  return [...(run.failures ?? []), failure].slice(-20)
}
type StepOutput = NonNullable<StoredRun['outputs']>[string]
export function runReadyToFinish(run: StoredRun) {
  return (
    run.outcome === 'unchanged' ||
    run.flow.nodes.every((node) => run.completedNodes.includes(node.id))
  )
}
const stepTextLimit = 32768
const truncationNote =
  '\n[Result truncated at 32768 characters. Read the preceding task for the rest.]'

/** Reuse the saved answer for the step, including files. Legacy recovery can read the
 * worker up to the saved step finish so a later manual turn cannot become its result. */
export function stepOutput(task: Task, finishedAt?: string, turnId?: string): StepOutput {
  const turns = turnId
    ? task.turns?.filter((turn) => turn.id === turnId)
    : finishedAt
      ? task.turns?.filter((turn) => turn.startedAt <= finishedAt)
      : task.turns
  const turn = turns?.at(-1)
  const replies = task.messages.filter(
    (message) =>
      message.role === 'assistant' &&
      (!turnId || !!turn) &&
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

export function stepWorkerTurn(task: Task, runId: string, step: JobRunStep) {
  if (step.turnId) return task.turns?.find((turn) => turn.id === step.turnId)
  const objective = task.messages.find(
    (message) =>
      message.role === 'user' &&
      message.source?.kind === 'automation' &&
      message.source.runId === runId,
  )
  return objective ? botStepTurn(task, objective.id) : undefined
}

export function reportStepOutput(
  saved: StepOutput | undefined,
  readTask: () => Task | undefined,
  finishedAt?: string,
  turnId?: string,
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
  return task ? stepOutput(task, finishedAt, turnId) : saved
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
      waitsForCi: node.data.pipelineWait ? true : undefined,
      reviewPrompt: node.data.reviewPrompt,
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
    const node = run.flow.nodes.find((node) => node.id === step.nodeId)
    if (node?.data.botId === step.taskId) return step
    const task = tasks.find((task) => task.id === step.taskId)
    if (!task) return step
    if (completedNodes.includes(step.nodeId)) {
      if (!outputs?.[step.nodeId])
        outputs = {
          ...outputs,
          [step.nodeId]: stepOutput(readTask(task.id), step.finishedAt, step.turnId),
        }
      return step
    }
    if (!['review', 'done'].includes(task.status) || taskFamilyWorking(tasks, task.id)) return step
    const history = readTask(task.id)
    const turn = stepWorkerTurn(history, run.id, step)
    const schema = node?.data.resultSchema
    if (
      turn?.status !== 'completed' ||
      (schema === undefined && task.history.latestTurn?.id !== turn.id)
    )
      return step
    if (!outputs?.[step.nodeId]) {
      try {
        outputs = {
          ...outputs,
          [step.nodeId]: {
            ...stepOutput(history, undefined, turn.id),
            ...(schema !== undefined ? { result: readStepResult(schema, history, turn) } : {}),
          },
        }
      } catch {
        // The worker completed without a valid result. A retry must start another attempt.
        return step
      }
    }
    completedNodes.push(step.nodeId)
    return {
      ...step,
      status: 'completed' as const,
      turnId: turn.id,
      finishedAt: turn.finishedAt ?? task.updatedAt,
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
