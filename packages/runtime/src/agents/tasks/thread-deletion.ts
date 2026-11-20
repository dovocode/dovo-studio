import { taskFamilyIds, type TaskSummary } from '@dovo/protocol'
import { Effect } from 'effect'
import type { Services } from '../../services.js'
import { HttpError, errorMessage } from '../../errors.js'
import { forgetThreadActions } from '../../agent-tools/thread-actions.js'
import { serviceResult } from '../../http/support/effect.js'
import {
  piSessionStorage,
  removeDeletedPiCopy,
  removePiSessionCopies,
} from '../providers/pi/session-copies.js'

export type ThreadLifecycleAction = 'archive' | 'restore' | 'delete'

/** A thread with its child agents, and, for a Bot, its conversations. The checks only read
 * state, so callers can check every family before any cleanup starts. */
export function threadFamily(
  s: Services,
  id: string,
  action: ThreadLifecycleAction,
  deletionReservation?: symbol,
) {
  const familyIds = () => {
    const tasks = s.store.get().tasks
    const ids = taskFamilyIds(tasks, id)
    if (action === 'delete' && s.store.taskSummary(id).bot)
      for (const task of tasks)
        if (task.botConversation?.botId === id)
          for (const childId of taskFamilyIds(tasks, task.id)) ids.add(childId)
    return ids
  }
  const ids = familyIds()
  const deletingBot = action === 'delete' && !!s.store.taskSummary(id).bot
  const requireIdle = () => {
    for (const taskId of ids) {
      const task = s.store.taskSummary(taskId)
      const handoff = task.machineHandoff
      if (
        deletingBot &&
        s.threadWatch
          .list(taskId)
          .some(
            (watch) =>
              watch.delegated &&
              watch.status === 'watching' &&
              watch.snapshot?.phase !== 'completed',
          )
      )
        throw new HttpError(
          409,
          'Stop or unlink delegated work on other computers before deleting this Bot. Reconnect offline workers if their state is unknown.',
        )
      if (
        handoff &&
        !(handoff.state === 'staged' && action === 'delete') &&
        (handoff.state !== 'moved' ||
          action === 'restore' ||
          s.projectTransfers.list().find((job) => job.id === handoff.id)?.state !== 'completed')
      )
        throw new HttpError(
          409,
          'Finish this thread’s computer transfer first. Its source stays available for recovery.',
        )
      s.tasks.requireIdle(taskId, deletionReservation)
      s.jobs.requireTaskIdle(taskId)
      if (action === 'delete') s.botAvatars.requireIdle(taskId)
    }
    if (
      action !== 'restore' &&
      s.terminals.list().some((terminal) => ids.has(terminal.taskId) && !terminal.exited)
    )
      throw new HttpError(
        409,
        'Close this thread’s and its child agents’ terminals before archiving or deleting it.',
      )
  }
  const requireUnchanged = () => {
    const latest = familyIds()
    if (latest.size !== ids.size || [...latest].some((taskId) => !ids.has(taskId)))
      throw new HttpError(409, 'This thread’s child agents changed. Refresh and retry.')
  }
  return { ids, requireIdle, requireUnchanged }
}

/** Before the commit: stops processes that belong to the threads. Files, containers and thread
 * records stay intact, so a failed commit loses nothing. */
export function releaseThreadResources(s: Services, ids: ReadonlySet<string>) {
  return Effect.gen(function* () {
    for (const taskId of ids) {
      const cleanup = yield* serviceResult(
        Promise.allSettled([
          s.browsers.closeTask(taskId),
          s.simulators.closeTask(taskId),
          s.deviceHosts.closeTask(taskId),
          s.agents.releaseTask(taskId),
        ]),
      )
      for (const result of cleanup) if (result.status === 'rejected') throw result.reason
    }
  })
}

/** After an archive or deletion commits: removes each thread's container and its private state
 * and harness folders. This cannot be undone, so it never runs before the commit. A failure
 * keeps the committed change; startup cleanup removes containers of archived or deleted
 * threads, and repeating a deletion retries the removal. */
export function removeThreadSandboxes(
  s: Pick<Services, 'sandboxes' | 'activity'>,
  ids: Iterable<string>,
) {
  return Effect.promise(async () => {
    for (const taskId of ids)
      await s.sandboxes.remove(taskId).catch((error: unknown) => {
        console.error(`Could not remove the sandbox of thread ${taskId}`, error)
        s.activity.add('task', taskId, 'Sandbox kept: cleanup after the thread change failed', {
          error: errorMessage(error),
        })
      })
  })
}

/** Removes the threads and their durable records. Call inside the store transaction that also
 * commits any related metadata, so a failure keeps every record. */
export function deleteThreadRecords(s: Services, ids: ReadonlySet<string>) {
  for (const taskId of ids) {
    s.projectTransfers.discardStagedThread(taskId)
    s.db.prepare('DELETE FROM activity WHERE scope = ?').run(taskId)
    s.memory.removeBot(taskId)
    forgetThreadActions(s, taskId)
  }
  s.store.update((workspace) => ({
    ...workspace,
    tasks: workspace.tasks.filter((task) => !ids.has(task.id)),
  }))
}

/** After the deletion commits: retire side chats, questions and approvals that no turn can
 * receive. Cancelling writes audit records, which must not outlive the deleted threads. */
export function retireDeletedThreadInputs(s: Services, ids: ReadonlySet<string>) {
  for (const taskId of ids) {
    s.titles.cancelSideChats(taskId)
    s.questions.cancelTask(taskId)
    s.approvals.cancelTask(taskId)
  }
  for (const taskId of ids) s.db.prepare('DELETE FROM activity WHERE scope = ?').run(taskId)
}

/** File cleanup after the deletion commits. Startup recovery removes Pi copies left by a crash. */
export function removeDeletedThreadFiles(s: Services, deleted: readonly TaskSummary[]) {
  return Effect.gen(function* () {
    yield* serviceResult(removePiSessionCopies(piSessionStorage(s.db), deleted))
    yield* serviceResult(s.attachments.prune())
  })
}

/** A repeated deletion finishes file cleanup that failed after the first deletion committed. */
export function retryDeletedThreadFiles(s: Services, id: string) {
  return Effect.gen(function* () {
    yield* serviceResult(removeDeletedPiCopy(piSessionStorage(s.db), s.store, id))
    if (s.store.wasTaskDeleted(id) && !s.store.get().tasks.some((task) => task.id === id))
      yield* removeThreadSandboxes(s, [id])
  })
}
