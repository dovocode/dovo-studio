import { notificationTarget, type NotificationTarget } from './target'

const receivers = new Set<(target: NotificationTarget) => boolean>()

export function registerInAppNotification(receiver: (target: NotificationTarget) => boolean) {
  receivers.add(receiver)
  return () => {
    receivers.delete(receiver)
  }
}

/** Native push remains the fallback when the foreground banner cannot handle this request. */
export function deliverInAppNotification(data: unknown, active: boolean) {
  if (!active || !data || typeof data !== 'object' || !('kind' in data) || data.kind !== 'input')
    return false
  const target = notificationTarget(data)
  if (!target?.inputId || !target.inputType) return false
  return [...receivers].some((receive) => receive(target))
}
