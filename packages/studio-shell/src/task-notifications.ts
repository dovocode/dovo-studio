import { useEffect, useRef } from 'react'
import { readAppPreferences, useWorkspace } from '@dovo/studio-core'

type RuntimeOverview = ReturnType<typeof useWorkspace>['runtimes'][number]

export type NotificationTarget = {
  runtimeId: string
  viewId: 'tasks' | 'jobs'
  entityId: string
}

export type TaskState = {
  target: NotificationTarget
  title: string
  running: boolean
  needsInput: boolean
  failed: boolean
  /** Automation runs notify under their own setting; cancelled runs never notify. */
  automation?: boolean
  cancelled?: boolean
  /** The task's pull request checks: 'pending', 'passed' or 'failed'. */
  checks?: string
  pullNumber?: number
}

export function taskStates(entries: readonly RuntimeOverview[]) {
  const states = new Map<string, TaskState>()
  for (const entry of entries) {
    const snapshot = entry.snapshot
    if (!snapshot || !entry.connected) continue
    const waiting = new Set(
      [...snapshot.approvals, ...snapshot.questions].map((item) => item.taskId),
    )
    for (const task of snapshot.workspace.tasks)
      states.set(JSON.stringify([entry.profile.id, task.id]), {
        title: task.title,
        target: { runtimeId: entry.profile.id, viewId: 'tasks', entityId: task.id },
        running: task.status === 'running',
        needsInput: waiting.has(task.id),
        failed: task.status === 'failed',
        checks: task.pullStatus?.state === 'open' ? task.pullStatus.checks : undefined,
        pullNumber: task.pullStatus?.number,
      })
    const names = new Map(snapshot.workspace.automations.map((item) => [item.id, item.name]))
    for (const run of snapshot.runs)
      states.set(JSON.stringify([entry.profile.id, 'run', run.id]), {
        title: names.get(run.automationId) ?? 'Automation',
        target: { runtimeId: entry.profile.id, viewId: 'jobs', entityId: run.id },
        running: run.status === 'running' || run.status === 'waiting',
        // A review step waits for a person to approve the run.
        needsInput: run.status === 'waiting',
        failed: run.status === 'failed',
        automation: true,
        cancelled: run.status === 'cancelled',
      })
  }
  return states
}

/** What changed since the last snapshot. Tasks seen for the first time never notify, so opening
 * the app or reconnecting doesn't replay old events. */
export function taskNotificationEvents(
  previous: ReadonlyMap<string, TaskState>,
  current: ReadonlyMap<string, TaskState>,
) {
  const events: {
    key: string
    kind: 'input' | 'done' | 'failed' | 'checks-passed' | 'checks-failed'
    title: string
    automation: boolean
    target: NotificationTarget
  }[] = []
  for (const [key, state] of current) {
    const before = previous.get(key)
    if (!before) continue
    const automation = !!state.automation
    if (state.needsInput && !before.needsInput)
      events.push({ key, kind: 'input', title: state.title, automation, target: state.target })
    else if (before.running && !state.running && !state.cancelled)
      events.push({
        key,
        kind: state.failed ? 'failed' : 'done',
        title: state.title,
        automation,
        target: state.target,
      })
    // Checks that were running on the task's pull request have finished.
    if (
      before.checks === 'pending' &&
      (state.checks === 'passed' || state.checks === 'failed') &&
      before.pullNumber === state.pullNumber
    )
      events.push({
        key: `${key}:checks`,
        kind: state.checks === 'passed' ? 'checks-passed' : 'checks-failed',
        title: state.title,
        automation,
        target: state.target,
      })
  }
  return events
}

/** Settings → General → Notifications: tell the user while Dovo is in the background. */
export function useTaskNotifications(onOpen: (target: NotificationTarget) => void) {
  const { runtimes } = useWorkspace()
  const previous = useRef<Map<string, TaskState> | null>(null)
  useEffect(() => {
    const current = taskStates(runtimes)
    const before = previous.current
    previous.current = current
    if (!before || typeof Notification === 'undefined') return
    if (Notification.permission !== 'granted' || (!document.hidden && document.hasFocus())) return
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
  }, [runtimes, onOpen])
}
