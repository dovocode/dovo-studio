import { mutableStruct } from './schema.js'
import { minValue, maxValue } from './schema.js'
import { Schema } from 'effect'
import type { Task } from './workspace.js'
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
})
export type LiveTaskProps = Schema.Schema.Type<typeof liveTaskPropsSchema>
export function liveTaskProps(
  task: Task,
  device: string,
  project: string,
  needsInput: boolean,
): LiveTaskProps {
  const turn = task.turns?.at(-1)
  return {
    title: task.title.slice(0, 100),
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
