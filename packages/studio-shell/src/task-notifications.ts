import {
  runtimeComputerName,
  taskInputOwner,
  taskNotificationEvents,
  taskNotificationStates,
  enqueueTaskNotices,
  taskSectionIndicators,
  type TaskNotice,
  type TaskState,
  type NotificationTarget,
} from '@dovo/protocol'
import type { InputPreviewBridge, InputPreviewItem } from '@dovo/protocol'
import { useEffect, useRef, useState } from 'react'
import { readAppPreferences, useAppPreferences, useWorkspace } from '@dovo/studio-core'
export {
  taskNotificationEvents,
  taskNotificationStates,
  enqueueTaskNotices,
  taskSectionIndicators,
  type TaskNotice,
  type TaskState,
  type NotificationTarget,
} from '@dovo/protocol'

/** Settings → General → Notifications: tell the user while Dovo is in the background. */
export function useTaskNotifications(
  onOpen: (target: NotificationTarget) => void,
  preview?: InputPreviewBridge,
  activeTarget?: NotificationTarget,
  enabled = true,
  browserMode = false,
) {
  const [notices, setNotices] = useState<TaskNotice[]>([])
  const notice = notices[0]
  const { runtimes } = useWorkspace()
  const preferences = useAppPreferences()
  useEffect(() => {
    if (!enabled || !preview) return
    const items: InputPreviewItem[] = []
    for (const entry of runtimes) {
      const snapshot = entry.snapshot
      if (!snapshot) continue
      for (const request of [
        ...snapshot.questions
          .filter((question) => question.routing !== 'parent')
          .map((value) => ({ kind: 'question' as const, value })),
        ...snapshot.approvals.map((value) => ({ kind: 'approval' as const, value })),
      ])
        items.push({
          runtimeId: entry.profile.id,
          runtimeName: runtimeComputerName(entry),
          parentTaskId: taskInputOwner(snapshot.workspace.tasks, request.value.taskId),
          taskTitle:
            (taskInputOwner(snapshot.workspace.tasks, request.value.taskId) !== request.value.taskId
              ? 'Child thread · '
              : '') +
            (snapshot.workspace.tasks.find((task) => task.id === request.value.taskId)?.title ??
              'Task'),
          connection: entry.profile.connection,
          connected: entry.connected,
          request,
        })
    }
    void preview
      .sync({ enabled: preferences.inputPreview, showWhileFocused: browserMode, items })
      .catch((error: unknown) => console.error('Could not update input preview', error))
  }, [runtimes, preview, preferences.inputPreview, enabled, browserMode])
  useEffect(
    () => preview?.onOpenThread((target) => onOpen({ ...target, viewId: 'tasks' })),
    [preview, onOpen],
  )
  const previous = useRef<Map<string, TaskState> | null>(null)
  useEffect(() => {
    if (!enabled) {
      previous.current = null
      return
    }
    const current = taskNotificationStates(runtimes)
    const before = previous.current
    previous.current = current
    if (!before) return
    if (!document.hidden && document.hasFocus()) {
      if (readAppPreferences().inAppNotifications) {
        const events = taskNotificationEvents(before, current)
        if (events.length)
          setNotices((pending) => enqueueTaskNotices(pending, events, activeTarget))
      }
      return
    }
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    const { notifyInput, notifyDone, notifyAutomations, notifySound } = readAppPreferences()
    for (const event of taskNotificationEvents(before, current)) {
      if (
        event.automation ? !notifyAutomations : event.kind === 'input' ? !notifyInput : !notifyDone
      )
        continue
      const subject = event.automation ? 'Automation' : 'Task'
      const notification = new Notification(
        event.kind === 'checks-passed'
          ? 'Pull request checks passed'
          : event.kind === 'checks-failed'
            ? 'Pull request checks failed'
            : event.kind === 'input'
              ? event.automation
                ? 'Automation needs review'
                : 'Needs your input'
              : event.kind === 'failed'
                ? `${subject} failed`
                : `${subject} finished`,
        { body: event.title, tag: event.key, silent: !notifySound },
      )
      notification.onclick = () => {
        window.focus()
        notification.close()
        onOpen(event.target)
      }
    }
  }, [
    runtimes,
    onOpen,
    activeTarget?.runtimeId,
    activeTarget?.viewId,
    activeTarget?.entityId,
    enabled,
  ])
  useEffect(() => {
    setNotices((pending) =>
      enabled && preferences.inAppNotifications
        ? enqueueTaskNotices(pending, [], activeTarget)
        : [],
    )
  }, [
    enabled,
    preferences.inAppNotifications,
    activeTarget?.runtimeId,
    activeTarget?.viewId,
    activeTarget?.entityId,
  ])
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotices((pending) => pending.slice(1)), 8000)
    return () => clearTimeout(timer)
  }, [notice])
  return {
    notice,
    pendingCount: notices.length,
    sectionIndicators: taskSectionIndicators(runtimes, notices),
    dismiss: () => setNotices((pending) => pending.slice(1)),
  }
}
