import type { NotificationTarget, TaskState, taskNotificationEvents } from '@dovo/protocol'

export type InAppInputNotice = {
  key: string
  title: string
  target: NotificationTarget
  inputId?: string
  confirmed: boolean
}

export function sameNoticeThread(a: NotificationTarget, b?: NotificationTarget) {
  return !!b && a.runtimeId === b.runtimeId && a.viewId === b.viewId && a.entityId === b.entityId
}

/** Reconcile live requests, rather than leaving an answered approval in the banner queue. */
export function reconcileInputNotices(
  pending: readonly InAppInputNotice[],
  states: ReadonlyMap<string, TaskState>,
  events: ReturnType<typeof taskNotificationEvents>,
  active?: NotificationTarget,
) {
  const notices = new Map(pending.map((notice) => [notice.key, notice]))
  for (const event of events)
    if (event.kind === 'input' && event.target.viewId === 'tasks')
      notices.set(event.key, {
        key: event.key,
        title: event.title,
        target: event.target,
        inputId: event.inputId,
        confirmed: true,
      })
  return [...notices.values()]
    .flatMap((notice) => {
      if (sameNoticeThread(notice.target, active)) return []
      const state = states.get(JSON.stringify([notice.target.runtimeId, notice.target.entityId]))
      const waiting =
        state?.needsInput && (!notice.inputId || state.inputIds?.includes(notice.inputId))
      if (notice.confirmed && !waiting) return []
      return [waiting && !notice.confirmed ? { ...notice, confirmed: true } : notice]
    })
    .slice(-50)
}
