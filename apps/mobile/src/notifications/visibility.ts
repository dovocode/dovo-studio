import { notificationTestTaskId } from '@dovo/protocol'
import { notificationTarget } from './target'

export type AccessibleNotificationInput = {
  runtimeId: string
  taskId: string
  inputId: string
  inputType: 'question' | 'approval'
}

const accessibleInputs = new Set<AccessibleNotificationInput>()
const blockers = new Set<object>()

export function registerAccessibleNotificationInput(input: AccessibleNotificationInput) {
  accessibleInputs.add(input)
  return () => {
    accessibleInputs.delete(input)
  }
}

export function blockAccessibleNotificationInputs() {
  const blocker = {}
  blockers.add(blocker)
  return () => {
    blockers.delete(blocker)
  }
}

export function shouldAlertForNotification(data: unknown, active: boolean) {
  if (!data || typeof data !== 'object') return false
  if ('taskId' in data && data.taskId === notificationTestTaskId) return true
  if (!('kind' in data) || data.kind !== 'input') return false
  const target = notificationTarget(data)
  return !(
    active &&
    target?.inputId &&
    target.inputType &&
    blockers.size === 0 &&
    [...accessibleInputs].some(
      (input) =>
        input.runtimeId === target.runtimeId &&
        input.taskId === target.taskId &&
        input.inputId === target.inputId &&
        input.inputType === target.inputType,
    )
  )
}
