import { runtimeComputerName, taskInputOwner } from '@dovo/protocol'
import type { InputPreviewBridge, InputPreviewItem } from '@dovo/protocol'
import { useEffect, useRef, useState } from 'react'
import { readAppPreferences, useAppPreferences, useWorkspace } from '@dovo/studio-core'

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
  inputIds?: readonly string[]
  failed: boolean
  /** Automation runs notify under their own setting; cancelled runs never notify. */
  automation?: boolean
  cancelled?: boolean
  /** The task's pull request checks: 'pending', 'passed' or 'failed'. */
  checks?: string
  pullNumber?: number
}

export function taskNotificationStates(entries: readonly RuntimeOverview[]) {
  const states = new Map<string, TaskState>()
  for (const entry of entries) {
    const snapshot = entry.snapshot
    if (!snapshot || !entry.connected) continue
    const waiting = new Map<string, string[]>()
    const addInput = (taskId: string, id: string) => {
      const owner = taskInputOwner(snapshot.workspace.tasks, taskId)
      const ids = waiting.get(owner) ?? []
      ids.push(id)
      waiting.set(owner, ids)
    }
    for (const approval of snapshot.approvals)
      addInput(approval.taskId, JSON.stringify(['approval', approval.id]))
    for (const question of snapshot.questions)
      if (question.routing !== 'parent')
        addInput(question.taskId, JSON.stringify(['question', question.id]))
    for (const task of snapshot.workspace.tasks)
      for (const watch of task.threadWatches ?? []) {
        if (
          !watch.delegated ||
          watch.status !== 'watching' ||
          watch.offline ||
          watch.paused ||
          watch.snapshot?.phase !== 'needs-input'
        )
          continue
        const inputs = watch.snapshot.humanInputs ?? []
        for (const input of inputs)
          addInput(
            task.id,
            JSON.stringify([
              'delegated',
              watch.runtimeId,
              watch.threadId,
              input.runtimeId,
              input.taskId,
              input.kind,
              input.id,
            ]),
          )
        // Older runtimes expose the waiting phase without individual human requests.
        if (!inputs.length && !watch.snapshot.questions?.length)
          addInput(task.id, JSON.stringify(['delegated', watch.runtimeId, watch.threadId]))
      }
    for (const task of snapshot.workspace.tasks) {
      const inputIds = waiting.get(task.id) ?? []
      states.set(JSON.stringify([entry.profile.id, task.id]), {
        title: task.title,
        target: { runtimeId: entry.profile.id, viewId: 'tasks', entityId: task.id },
        running: task.status === 'running',
        needsInput: inputIds.length > 0,
        inputIds,
        failed: task.status === 'failed',
        checks: task.pullStatus?.state === 'open' ? task.pullStatus.checks : undefined,
        pullNumber: task.pullStatus?.number,
      })
    }
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
    const previousInputs = new Set(before.inputIds ?? [])
    const newInputs = state.inputIds?.filter((id) => !previousInputs.has(id)) ?? []
    if (state.needsInput && (newInputs.length || !before.needsInput)) {
      for (const id of newInputs.length ? newInputs : [undefined])
        events.push({
          key: id === undefined ? key : JSON.stringify([key, 'input', id]),
          kind: 'input',
          title: state.title,
          automation,
          target: state.target,
        })
    } else if (before.running && !state.running && !state.cancelled)
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

export type TaskNotice = { title: string; target: NotificationTarget }

export function enqueueTaskNotices(
  pending: readonly TaskNotice[],
  events: ReturnType<typeof taskNotificationEvents>,
  activeTarget?: NotificationTarget,
): TaskNotice[] {
  const visible = (target: NotificationTarget) =>
    !activeTarget ||
    target.runtimeId !== activeTarget.runtimeId ||
    target.viewId !== activeTarget.viewId ||
    target.entityId !== activeTarget.entityId
  const labels = {
    input: 'Needs input',
    failed: 'Failed',
    done: 'Finished',
    'checks-passed': 'Checks passed',
    'checks-failed': 'Checks failed',
  }
  return [
    ...pending.filter((notice) => visible(notice.target)),
    ...events
      .filter((event) => visible(event.target))
      .map((event) => ({
        title: `${event.title} · ${labels[event.kind]}`,
        target: event.target,
      })),
  ].slice(-50)
}

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
    dismiss: () => setNotices((pending) => pending.slice(1)),
  }
}
