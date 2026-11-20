import { notificationTestTaskId } from '@dovo/protocol'
import { notificationTarget, type RemoteHumanInput } from './target'

export type AccessibleNotificationInput = {
  runtimeId: string
  /** The thread that asked. */
  taskId: string
  /** Runtimes notify a delegated child's input on its owning ancestor thread. */
  ownerTaskId?: string
  /** The computer's own ID. A parent on another computer notifies with `identity:inputId`. */
  runtimeIdentity?: string
  inputId: string
  inputType: 'question' | 'approval'
}

const accessibleInputs = new Set<AccessibleNotificationInput>()
const blockers = new Set<object>()
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((listener) => listener())

export function registerAccessibleNotificationInput(input: AccessibleNotificationInput) {
  accessibleInputs.add(input)
  changed()
  return () => {
    if (accessibleInputs.delete(input)) changed()
  }
}

export function blockAccessibleNotificationInputs() {
  const blocker = {}
  blockers.add(blocker)
  changed()
  return () => {
    if (blockers.delete(blocker)) changed()
  }
}

/** Calls `listener` when a request card becomes visible or hidden. */
export function subscribeAccessibleNotificationInputs(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** A request the user can see now. Without an `ownerRuntimeIdentity`, it is a request on
 * `runtimeId`. With one, it is a delegated child's request, which the child's computer can show. */
export type NotificationInputMatch = {
  runtimeId: string
  taskId?: string
  inputId: string
  inputType: 'question' | 'approval'
  ownerRuntimeIdentity?: string
}

/** True only while the exact request card is on screen and no sheet covers it. */
export function notificationInputAccessible(match: NotificationInputMatch) {
  if (blockers.size) return false
  return [...accessibleInputs].some((input) =>
    match.ownerRuntimeIdentity === undefined
      ? input.runtimeId === match.runtimeId &&
        (match.taskId === undefined ||
          input.taskId === match.taskId ||
          input.ownerTaskId === match.taskId) &&
        input.inputId === match.inputId &&
        input.inputType === match.inputType
      : !!input.runtimeIdentity &&
        input.runtimeIdentity === match.ownerRuntimeIdentity &&
        input.inputId === match.inputId &&
        input.inputType === match.inputType,
  )
}

/**
 * `remote` is the delegated child's request that a parent push names, when this client can see
 * the parent. The child's own computer shows that form, so it can be visible here.
 */
export function shouldAlertForNotification(
  data: unknown,
  active: boolean,
  remote?: Pick<RemoteHumanInput, 'ownerRuntimeIdentity' | 'id' | 'kind'>,
) {
  if (!data || typeof data !== 'object') return false
  if ('taskId' in data && data.taskId === notificationTestTaskId) return true
  if (!('kind' in data) || data.kind !== 'input') return false
  const target = notificationTarget(data)
  if (!active || !target?.inputId || !target.inputType) return true
  const visible =
    notificationInputAccessible({
      runtimeId: target.runtimeId,
      taskId: target.taskId,
      inputId: target.inputId,
      inputType: target.inputType,
    }) ||
    (!!remote &&
      notificationInputAccessible({
        runtimeId: target.runtimeId,
        ownerRuntimeIdentity: remote.ownerRuntimeIdentity,
        inputId: remote.id,
        inputType: remote.kind,
      }))
  return !visible
}

/**
 * Disabled push or a disabled computer can still receive pushes until a runtime unregisters it.
 * Keep those out of the native foreground presentation; in-app notices follow their own setting.
 */
export function foregroundNotificationPresentation(
  data: unknown,
  options: {
    active: boolean
    delivered: boolean
    pushEnabled: boolean
    disabledServers: readonly string[]
    remote?: Pick<RemoteHumanInput, 'ownerRuntimeIdentity' | 'id' | 'kind'>
  },
) {
  const runtimeId =
    data && typeof data === 'object' && 'runtimeId' in data && typeof data.runtimeId === 'string'
      ? data.runtimeId
      : undefined
  const allowed = options.pushEnabled && !(runtimeId && options.disabledServers.includes(runtimeId))
  const alert =
    allowed &&
    !options.delivered &&
    shouldAlertForNotification(data, options.active, options.remote)
  return {
    shouldPlaySound: alert,
    shouldSetBadge: false,
    shouldShowBanner: alert,
    shouldShowList: allowed,
  }
}
