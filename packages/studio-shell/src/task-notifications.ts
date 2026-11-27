import {
  runtimeComputerName,
  taskInputOwner,
  taskNotificationEvents,
  taskNotificationStates,
  enqueueTaskNotices,
  taskSectionIndicators,
  taskNoticeInput,
  taskNoticeStillWaiting,
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
  const background = useRef(
    new Map<string, { notification: Notification; input: NonNullable<TaskNotice['input']> }>(),
  )
  useEffect(
    () => () => {
      for (const { notification } of background.current.values()) notification.close()
      background.current.clear()
    },
    [],
  )
  useEffect(() => {
    if (!enabled) {
      previous.current = null
      setNotices([])
      for (const { notification } of background.current.values()) notification.close()
      background.current.clear()
      return
    }
    const current = taskNotificationStates(runtimes)
    const before = previous.current
    previous.current = current
    for (const [key, { notification, input }] of background.current) {
      if (taskNoticeStillWaiting(current, input)) continue
      background.current.delete(key)
      notification.close()
    }
    const focused = !document.hidden && document.hasFocus()
    const events = before ? taskNotificationEvents(before, current) : []
    const appPreferences = readAppPreferences()
    setNotices((pending) => {
      if (!appPreferences.inAppNotifications) return pending.length ? [] : pending
      const next = enqueueTaskNotices(pending, focused ? events : [], activeTarget, current)
      return next.length === pending.length && next.every((item, index) => item === pending[index])
        ? pending
        : next
    })
    if (!before || focused) return
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    const { notifyInput, notifyDone, notifyAutomations, notifySound } = appPreferences
    for (const event of events) {
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
      const input = taskNoticeInput(event)
      if (input) background.current.set(event.key, { notification, input })
      notification.onclose = () => {
        if (background.current.get(event.key)?.notification === notification)
          background.current.delete(event.key)
      }
      notification.onclick = () => {
        const current = previous.current
        if (input && (!current || !taskNoticeStillWaiting(current, input))) return
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
    preferences.inAppNotifications,
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
