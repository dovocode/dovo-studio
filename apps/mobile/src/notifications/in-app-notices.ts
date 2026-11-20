import {
  taskRemoteHumanInputs,
  type NotificationTarget,
  type TaskState,
  type taskNotificationEvents,
} from '@dovo/protocol'
import { taskHref, taskRouteHref, type TaskRouteParams } from '../shell/task-route'
import { remoteInputHref, type RemoteHumanInput } from './target'
import { notificationInputAccessible, type NotificationInputMatch } from './visibility'

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

/** Matches the delegated input ID in `taskNotificationStates`, so a push and a live update share one notice. */
export function delegatedNoticeInputId(input: RemoteHumanInput) {
  return JSON.stringify([
    'delegated',
    input.runtimeId,
    input.taskId,
    input.ownerRuntimeIdentity,
    input.ownerTaskId,
    input.kind,
    input.id,
  ])
}

/**
 * The request behind a notice input ID. A local request lives on the notice's computer; a
 * delegated child's request on another computer names its owner's identity.
 */
export function noticeInput(inputId: string | undefined) {
  if (!inputId) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(inputId)
  } catch {
    return undefined
  }
  if (!Array.isArray(parsed)) return undefined
  const request = (
    kind: unknown,
    id: unknown,
    owner?: string,
  ): { kind: 'question' | 'approval'; id: string; owner?: string } | undefined =>
    (kind === 'question' || kind === 'approval') && typeof id === 'string' && id
      ? { kind, id, owner }
      : undefined
  if (parsed.length === 2) return request(parsed[0], parsed[1])
  // [delegated, profile, thread, owner identity, owner thread, kind, id]
  if (parsed.length === 7 && parsed[0] === 'delegated' && typeof parsed[3] === 'string')
    return request(parsed[5], parsed[6], parsed[3])
  return undefined
}

/** The card that answers this notice. */
export function noticeInputMatch(
  notice: Pick<InAppInputNotice, 'target' | 'inputId'>,
): NotificationInputMatch | undefined {
  const input = noticeInput(notice.inputId)
  if (!input) return undefined
  return input.owner === undefined
    ? {
        runtimeId: notice.target.runtimeId,
        taskId: notice.target.entityId,
        inputId: input.id,
        inputType: input.kind,
      }
    : {
        runtimeId: notice.target.runtimeId,
        ownerRuntimeIdentity: input.owner,
        inputId: input.id,
        inputType: input.kind,
      }
}

/**
 * A notice is redundant only while its request card is on screen. An open thread is not enough:
 * the card can belong to another request in that thread, or another pane or sheet can hide it.
 */
export function noticeVisible(
  notice: Pick<InAppInputNotice, 'target' | 'inputId'>,
  accessible: (match: NotificationInputMatch) => boolean = notificationInputAccessible,
) {
  const match = noticeInputMatch(notice)
  return !!match && accessible(match)
}

type HrefSources = {
  profiles: Parameters<typeof remoteInputHref>[1]
  overviews: Parameters<typeof remoteInputHref>[2]
}

/** Opens the exact request. A delegated child's request opens on its own computer when paired. */
export function noticeHref(
  notice: Pick<InAppInputNotice, 'target' | 'inputId'>,
  sources: HrefSources,
) {
  const input = noticeInput(notice.inputId)
  const { runtimeId, entityId } = notice.target
  if (input?.owner !== undefined) {
    const task = sources.overviews
      .find((entry) => entry.profile.id === runtimeId)
      ?.snapshot?.workspace.tasks.find((task) => task.id === entityId)
    const remote =
      task &&
      taskRemoteHumanInputs(task).find((item) => delegatedNoticeInputId(item) === notice.inputId)
    if (remote) return remoteInputHref(remote, sources.profiles, sources.overviews)
    return taskHref(runtimeId, entityId)
  }
  return taskHref(
    runtimeId,
    entityId,
    input?.kind === 'question' ? input.id : undefined,
    undefined,
    undefined,
    undefined,
    input?.kind === 'approval' ? input.id : undefined,
  )
}

/** Reconcile live requests, rather than leaving an answered approval in the banner queue. */
export function reconcileInputNotices(
  pending: readonly InAppInputNotice[],
  states: ReadonlyMap<string, TaskState>,
  events: ReturnType<typeof taskNotificationEvents>,
  hidden: (notice: InAppInputNotice) => boolean = (notice) => noticeVisible(notice),
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
      if (hidden(notice)) return []
      const state = states.get(JSON.stringify([notice.target.runtimeId, notice.target.entityId]))
      const waiting =
        state?.needsInput && (!notice.inputId || state.inputIds?.includes(notice.inputId))
      if (notice.confirmed && !waiting) return []
      return [waiting && !notice.confirmed ? { ...notice, confirmed: true } : notice]
    })
    .slice(-50)
}

/**
 * Where "Return to" goes after a banner opens another thread. It keeps the interrupted route
 * whole, including its question, approval and parent. It shows in the thread the banner opened,
 * which can be on another computer.
 */
export function noticeReturnRoute(
  interrupted: TaskRouteParams & { runtimeId: string; taskId: string },
  opened: ReturnType<typeof taskHref>,
  fallbackParentTitle: string,
) {
  return {
    href: taskRouteHref(interrupted, fallbackParentTitle),
    destination: {
      runtimeId: opened.params.runtimeId,
      viewId: 'tasks',
      entityId: opened.params.taskId,
    } satisfies NotificationTarget,
  }
}
