import type { NotificationTarget, TaskNotice } from './task-notifications'

export function TaskNotificationNotice({
  notice,
  pendingCount,
  onOpen,
  onDismiss,
}: {
  notice: TaskNotice | undefined
  pendingCount: number
  onOpen: (target: NotificationTarget) => void
  onDismiss: () => void
}) {
  if (!notice) return null
  return (
    <div
      role="status"
      className="fixed bottom-5 right-5 z-50 flex max-w-sm items-center gap-3 rounded-lg border bg-card p-3 text-sm shadow-lg"
    >
      <button
        type="button"
        aria-label={`Open ${notice.title}`}
        className="text-left"
        onClick={() => {
          onOpen(notice.target)
          onDismiss()
        }}
      >
        {notice.title}
        {pendingCount > 1 && (
          <span className="block text-xs text-muted-foreground">
            {pendingCount - 1} more notifications
          </span>
        )}
      </button>
      <button type="button" aria-label="Dismiss notification" onClick={onDismiss}>
        ×
      </button>
    </div>
  )
}
