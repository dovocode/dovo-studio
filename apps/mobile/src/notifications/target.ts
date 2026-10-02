import { decodeResult, maxValue, minValue, mutableStruct } from '@dovo/protocol'
import { Schema } from 'effect'
import { taskHref } from '../shell/task-route'
const identity = maxValue(minValue(Schema.String, 1), 200)
const targetSchema = mutableStruct({
  runtimeId: identity,
  taskId: identity,
  inputId: Schema.optional(identity),
  inputType: Schema.optional(Schema.Literal('question', 'approval')),
})
export function notificationTarget(data: unknown) {
  const result = decodeResult(targetSchema, data)
  return result.success ? result.data : null
}
export type NotificationTarget = NonNullable<ReturnType<typeof notificationTarget>>
export function notificationHref(target: NotificationTarget) {
  return taskHref(
    target.runtimeId,
    target.taskId,
    target.inputType === 'question' ? target.inputId : undefined,
  )
}
