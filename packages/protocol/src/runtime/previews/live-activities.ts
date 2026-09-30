import { mutableStruct } from '../../shared/schema.js'
import { minValue, maxValue } from '../../shared/schema.js'
import { Schema } from 'effect'
import { taskPreparation } from '../../tasks/task-preparation.js'
import type { Task } from '../../workspace.js'
export const liveActivityRegistrationSchema = mutableStruct({
  activityId: maxValue(minValue(Schema.String, 1), 200),
  taskId: maxValue(minValue(Schema.String, 1), 200),
  turnId: maxValue(minValue(Schema.String, 1), 200),
  pushToken: Schema.String.pipe(Schema.pattern(/^[a-fA-F0-9]{32,512}$/)),
})
export const liveActivityStatusSchema = mutableStruct({
  configured: Schema.Boolean,
  environment: Schema.Literal('sandbox', 'production'),
  error: Schema.NullOr(Schema.String),
})
export const liveTaskPropsSchema = mutableStruct({
  title: Schema.String,
  project: Schema.String,
  device: Schema.String,
  status: Schema.Literal('Working', 'Needs input', 'Done', 'Failed', 'Stopped'),
  startedAt: Schema.Number.pipe(Schema.finite()),
  activity: Schema.optional(Schema.String),
  queued: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
  activeThreads: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
})
export type LiveTaskProps = Schema.Schema.Type<typeof liveTaskPropsSchema>
const activityLabels: Record<string, string> = {
  commandexecution: 'Running a command',
  bash: 'Running a command',
  filechange: 'Editing files',
  edit: 'Editing files',
  multiedit: 'Editing files',
  write: 'Writing files',
  read: 'Reading files',
  grep: 'Searching files',
  glob: 'Finding files',
  reasoning: 'Thinking through the task',
  agentmessage: 'Writing a response',
  mcptoolcall: 'Using a connected tool',
  websearch: 'Searching the web',
  webfetch: 'Reading a webpage',
  todolist: 'Planning next steps',
  todowrite: 'Planning next steps',
}
export function liveTaskProps(
  task: Task,
  device: string,
  project: string,
  needsInput: boolean,
  activeThreads = 1,
): LiveTaskProps {
  const turn = task.turns?.at(-1)
  const reported = task.activity?.trim()
  const current = reported
    ? (activityLabels[reported.toLowerCase().replace(/[_ -]/g, '')] ?? reported)
    : ''
  const preparing = taskPreparation(task)?.steps.find((step) => step.state === 'active')
  const activity =
    task.status === 'running'
      ? needsInput
        ? 'Waiting for your reply or approval'
        : (preparing?.label ?? (current || 'Agent is working'))
      : task.status === 'failed'
        ? task.error || 'The agent encountered an error'
        : task.status === 'cancelled' || task.status === 'draft'
          ? 'Thread stopped'
          : 'Ready for review'
  return {
    title: task.title.slice(0, 100),
    activity: activity.replace(/\s+/g, ' ').slice(0, 140),
    queued: task.queue?.length ?? 0,
    activeThreads,
    project: project.slice(0, 60),
    device: device.slice(0, 60),
    status:
      task.status === 'running'
        ? needsInput
          ? 'Needs input'
          : 'Working'
        : task.status === 'failed'
          ? 'Failed'
          : task.status === 'cancelled' || task.status === 'draft'
            ? 'Stopped'
            : 'Done',
    startedAt: Date.parse(turn?.startedAt ?? task.createdAt) || 0,
  }
}
