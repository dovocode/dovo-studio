import { hasUnviewedTaskCompletion } from '../workspace.js'
import { taskInputOwner } from './delegation.js'
import type { RuntimeOverview } from '../runtime/connection/runtime-fleet.js'
import { automationRunNeedsReview } from '../runtime/connection/runtime.js'
import type { SideThreadRequest } from './side-thread-attention.js'

export type NotificationTarget = {
  runtimeId: string
  viewId: 'tasks' | 'jobs'
  entityId: string
  threadRequest?: SideThreadRequest
}

export type TaskState = {
  target: NotificationTarget
  title: string
  running: boolean
  needsInput: boolean
  inputIds?: readonly string[]
  inputRequests?: ReadonlyMap<string, SideThreadRequest>
  failed: boolean
  /** Delegated agents report successful completion to their parent conversation. */
  delegated?: boolean
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
    const inputRequests = new Map<string, SideThreadRequest>()
    const addInput = (taskId: string, id: string) => {
      const owner = taskInputOwner(snapshot.workspace.tasks, taskId)
      const ids = waiting.get(owner) ?? []
      ids.push(id)
      waiting.set(owner, ids)
    }
    const addRequest = (taskId: string, requestId: string, kind: 'approval' | 'question') => {
      const id = JSON.stringify([kind, requestId])
      addInput(taskId, id)
      inputRequests.set(id, {
        id: taskInputOwner(snapshot.workspace.tasks, taskId),
        kind: kind === 'question' ? 'input' : 'approval',
        requestId,
      })
    }
    for (const approval of snapshot.approvals) addRequest(approval.taskId, approval.id, 'approval')
    for (const input of snapshot.secureInputs ?? [])
      addInput(input.taskId, JSON.stringify(['secure-input', input.id]))
    for (const question of snapshot.questions)
      if (question.routing !== 'parent') addRequest(question.taskId, question.id, 'question')
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
        inputRequests,
        failed: task.status === 'failed',
        cancelled: task.status === 'cancelled',
        delegated: !!(task.delegation || task.spawnParent),
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
        needsInput: automationRunNeedsReview(run),
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
    inputId?: string
  }[] = []
  for (const [key, state] of current) {
    const before = previous.get(key)
    if (!before) continue
    const automation = !!state.automation
    const previousInputs = new Set(before.inputIds ?? [])
    const newInputs = state.inputIds?.filter((id) => !previousInputs.has(id)) ?? []
    if (state.needsInput && (newInputs.length || !before.needsInput)) {
      for (const id of newInputs.length ? newInputs : [undefined]) {
        const request = id === undefined ? undefined : state.inputRequests?.get(id)
        events.push({
          key: id === undefined ? key : JSON.stringify([key, 'input', id]),
          kind: 'input',
          inputId: id,
          title: state.title,
          automation,
          target: request ? { ...state.target, threadRequest: request } : state.target,
        })
      }
    } else if (
      before.running &&
      !state.running &&
      !state.cancelled &&
      (state.failed || !state.delegated)
    )
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

export type TaskNotice = {
  title: string
  target: NotificationTarget
  input?: { stateKey: string; id?: string }
}

export function taskNoticeStillWaiting(
  states: ReadonlyMap<string, TaskState>,
  input: NonNullable<TaskNotice['input']>,
) {
  const state = states.get(input.stateKey)
  return !!state?.needsInput && (input.id === undefined || !!state.inputIds?.includes(input.id))
}

export function taskNoticeInput(event: ReturnType<typeof taskNotificationEvents>[number]) {
  if (event.kind !== 'input') return undefined
  const { runtimeId, entityId } = event.target
  return {
    stateKey: JSON.stringify(
      event.automation ? [runtimeId, 'run', entityId] : [runtimeId, entityId],
    ),
    id: event.inputId,
  }
}

/** Derive section dots from existing read state and pending human requests. */
export function taskSectionIndicators(
  entries: readonly RuntimeOverview[],
  notices: readonly TaskNotice[] = [],
) {
  const indicators: Record<string, 'unread' | 'attention'> = {}
  for (const notice of notices) indicators[notice.target.viewId] = 'unread'
  for (const entry of entries)
    if (entry.snapshot?.workspace.tasks.some(hasUnviewedTaskCompletion)) indicators.tasks = 'unread'
  for (const state of taskNotificationStates(entries).values())
    if (state.needsInput) indicators[state.target.viewId] = 'attention'
  if (indicators.tasks) indicators.workspace = indicators.tasks
  return indicators
}

export function enqueueTaskNotices(
  pending: readonly TaskNotice[],
  events: ReturnType<typeof taskNotificationEvents>,
  activeTarget?: NotificationTarget,
  states?: ReadonlyMap<string, TaskState>,
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
    ...pending.filter(
      (notice) =>
        visible(notice.target) &&
        (!states || !notice.input || taskNoticeStillWaiting(states, notice.input)),
    ),
    ...events
      .filter((event) => visible(event.target))
      .map((event) => ({
        title: `${event.title} · ${labels[event.kind]}`,
        target: event.target,
        input: taskNoticeInput(event),
      })),
  ].slice(-50)
}
