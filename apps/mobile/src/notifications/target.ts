import {
  notificationTestTaskId,
  decodeResult,
  maxValue,
  minValue,
  mutableStruct,
  resolveThreadRuntime,
  taskRemoteHumanInputs,
  type TaskMetadata,
} from '@dovo/protocol'
import { Schema } from 'effect'
import { taskHref } from '../shell/task-route'
const identity = maxValue(minValue(Schema.String, 1), 200)
const targetSchema = mutableStruct({
  runtimeId: identity,
  taskId: identity,
  inputId: Schema.optional(identity),
  inputType: Schema.optional(Schema.Literals(['question', 'approval'])),
})
export function notificationTarget(data: unknown) {
  const result = decodeResult(targetSchema, data)
  if (
    !result.success ||
    result.data.taskId === notificationTestTaskId ||
    (result.data.inputType === 'question' && !result.data.inputId)
  )
    return null
  return result.data
}
export type NotificationTarget = NonNullable<ReturnType<typeof notificationTarget>>

type Profile = { id: string; connection: { runtimeId?: string } }
type Overview = {
  profile: { id: string }
  snapshot: {
    runtimeId?: string
    questions: readonly { id: string; taskId: string }[]
    workspace: { tasks: readonly Pick<TaskMetadata, 'id' | 'threadWatches'>[] }
  } | null
}
export type RemoteHumanInput = ReturnType<typeof taskRemoteHumanInputs>[number]

/** The runtime identifies a delegated child's request on its parent as `identity:id`. */
export function remoteNotificationInputId(input: RemoteHumanInput) {
  return `${input.runtimeIdentity}:${input.id}`
}

/** Opens the owning computer when paired, otherwise the directly paired child thread. */
export function remoteInputHref(
  input: RemoteHumanInput,
  profiles: readonly Profile[],
  overviews: readonly Overview[],
) {
  const owner = resolveThreadRuntime(
    { runtimeId: input.runtimeId, runtimeIdentity: input.ownerRuntimeIdentity },
    profiles,
    overviews,
  )
  // Keep the exact ID even when the owner's snapshot has not loaded it yet or holds another request.
  // The owner's question and approval cards show that request, or its closed status, by exact ID.
  return taskHref(
    owner?.id ?? input.runtimeId,
    owner ? input.ownerTaskId : input.taskId,
    owner && input.kind === 'question' ? input.id : undefined,
    undefined,
    owner ? input.ownerRuntimeIdentity : input.runtimeIdentity,
    undefined,
    owner && input.kind === 'approval' ? input.id : undefined,
  )
}

/** The delegated child's request behind a parent push, while the parent still watches it. */
export function notificationRemoteInput(
  target: Pick<NotificationTarget, 'runtimeId' | 'taskId' | 'inputId'>,
  overviews: readonly Overview[],
) {
  if (!target.inputId) return undefined
  const task = overviews
    .find((entry) => entry.profile.id === target.runtimeId)
    ?.snapshot?.workspace.tasks.find((task) => task.id === target.taskId)
  return task
    ? taskRemoteHumanInputs(task).find(
        (input) => remoteNotificationInputId(input) === target.inputId,
      )
    : undefined
}

export function notificationHref(
  target: NotificationTarget,
  sources?: { profiles: readonly Profile[]; overviews: readonly Overview[] },
) {
  const remote = sources && notificationRemoteInput(target, sources.overviews)
  if (remote && sources) return remoteInputHref(remote, sources.profiles, sources.overviews)
  // Carry the request kind and ID, so the thread opens that exact card or its closed status.
  return taskHref(
    target.runtimeId,
    target.taskId,
    target.inputType === 'question' ? target.inputId : undefined,
    undefined,
    undefined,
    undefined,
    target.inputType === 'approval' ? target.inputId : undefined,
  )
}
