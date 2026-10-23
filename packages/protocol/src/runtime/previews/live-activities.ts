import { pushDeliveryTokenSchema } from '../push-notifications.js'
import { connectServiceOriginSchema } from '../../auth/service-urls.js'
import { mutableArray } from '../../shared/schema.js'
import { mutableStruct } from '../../shared/schema.js'
import { minValue, maxValue } from '../../shared/schema.js'
import { Schema } from 'effect'
import { taskPreparation } from '../../tasks/task-preparation.js'
import { latestTaskTurn, type Task } from '../../workspace.js'
import type { TaskSummary } from '../../tasks/task-summary.js'
export const liveActivityRegistrationSchema = mutableStruct({
  activityId: maxValue(minValue(Schema.String, 1), 200),
  taskId: maxValue(minValue(Schema.String, 1), 200),
  turnId: maxValue(minValue(Schema.String, 1), 200),
  runtimeId: Schema.optional(maxValue(minValue(Schema.String, 1), 200)),
  environment: Schema.optional(Schema.Literals(['sandbox', 'production'])),
  managedToken: Schema.optional(pushDeliveryTokenSchema),
  managedOrigin: Schema.optional(connectServiceOriginSchema),
  pushToken: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-fA-F0-9]{32,512}$/))),
})
export const liveActivityStatusSchema = mutableStruct({
  configured: Schema.Boolean,
  environment: Schema.Literals(['sandbox', 'production']),
  error: Schema.NullOr(Schema.String),
})
export const liveTaskPropsSchema = mutableStruct({
  title: maxValue(Schema.String, 100),
  project: maxValue(Schema.String, 60),
  device: maxValue(Schema.String, 60),
  status: Schema.Literals(['Working', 'Needs input', 'Done', 'Failed', 'Stopped']),
  startedAt: Schema.Number.pipe(Schema.check(Schema.isFinite())),
  activity: Schema.optional(maxValue(Schema.String, 140)),
  queued: Schema.optional(
    Schema.Number.pipe(
      Schema.check(Schema.isInt()),
      Schema.check(Schema.isGreaterThanOrEqualTo(0)),
    ),
  ),
  activeThreads: Schema.optional(
    Schema.Number.pipe(
      Schema.check(Schema.isInt()),
      Schema.check(Schema.isGreaterThanOrEqualTo(0)),
    ),
  ),
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
  task: Task | TaskSummary,
  device: string,
  project: string,
  needsInput: boolean,
  activeThreads = 1,
): LiveTaskProps {
  const turn = latestTaskTurn(task)
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

/** Refresh unchanged activities sparingly; keep enough stale-date headroom for delivery jitter. */
export const liveActivityRefreshMs = 3 * 60_000
export const liveActivityStaleMs = 5 * 60_000

const identity = maxValue(minValue(Schema.String, 1), 200)
export const managedLiveActivitySchema = mutableStruct({
  runtimeId: identity,
  activityId: identity,
  taskId: identity,
  turnId: identity,
  token: liveActivityRegistrationSchema.fields.pushToken,
  environment: Schema.Literals(['sandbox', 'production']),
})
export type ManagedLiveActivity = typeof managedLiveActivitySchema.Type
export const retainedLiveActivitiesSchema = mutableStruct({
  activities: mutableArray(mutableStruct({ runtimeId: identity, activityId: identity })).pipe(
    Schema.check(Schema.isMaxLength(8)),
  ),
})
export const relayLiveActivitySchema = mutableStruct({
  ...managedLiveActivitySchema.fields,
  kind: Schema.Literal('liveactivity'),
  platform: Schema.Literal('ios'),
  id: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-f0-9]{64}$/))),
  event: Schema.Literals(['update', 'end']),
  timestamp: Schema.Number.pipe(
    Schema.check(Schema.isInt()),
    Schema.check(Schema.isGreaterThanOrEqualTo(0)),
  ),
  props: liveTaskPropsSchema,
})
export type RelayLiveActivity = typeof relayLiveActivitySchema.Type
export function activityPayload(props: LiveTaskProps, ended: boolean, now: number) {
  const timestamp = Math.floor(now / 1000)
  return {
    aps: {
      timestamp,
      event: ended ? 'end' : 'update',
      'content-state': { name: 'DovoTask', props: JSON.stringify(props) },
      ...(ended
        ? { 'dismissal-date': timestamp + 300 }
        : { 'stale-date': timestamp + liveActivityStaleMs / 1000 }),
    },
  }
}
