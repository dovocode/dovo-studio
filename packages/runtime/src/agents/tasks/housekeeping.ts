import { rotateRuntimeLogs } from '../../storage/log-rotation.js'
import { dirname, resolve } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { startPolling } from '@dovo/client-runtime'
import { Effect } from 'effect'
import { taskFamilyIds, type Task } from '@dovo/protocol'
import type { Services } from '../../services.js'
import { listWorktreesEffect, removeWorktreeEffect } from '../../scm/git/worktrees.js'

const day = 86_400_000

/** When a task last saw activity: its latest turn, update or creation. */
function lastTaskActivity(task: Task) {
  const turn = task.turns?.at(-1)
  return Math.max(
    ...[task.updatedAt, task.createdAt, turn?.finishedAt, turn?.startedAt]
      .map((value) => (value ? Date.parse(value) : NaN))
      .filter(Number.isFinite),
    0,
  )
}

/** Tasks to archive under "Auto-archive inactive tasks". Anything that could still need the
 * user (running, waiting for input, pinned, busy elsewhere) is never selected. */
export function inactiveTaskIds(
  tasks: readonly Task[],
  days: number,
  now: number,
  busy: (task: Task) => boolean,
) {
  if (!days) return []
  return tasks
    .filter((task) => {
      if (task.delegation || task.example || task.archivedAt) return false
      const ids = taskFamilyIds(tasks, task.id)
      return tasks.every(
        (member) =>
          !ids.has(member.id) ||
          (!member.pinned &&
            member.status !== 'running' &&
            !member.waitingForFeedback &&
            !busy(member) &&
            now - lastTaskActivity(member) > days * day),
      )
    })
    .map((task) => task.id)
}

type ArchiveServices = Pick<
  Services,
  | 'store'
  | 'tasks'
  | 'jobs'
  | 'terminals'
  | 'questions'
  | 'approvals'
  | 'browsers'
  | 'simulators'
  | 'deviceHosts'
  | 'activity'
>
/** Whether a task is doing or waiting for something, so automatic archiving must skip it. */
export function taskIsBusy(s: ArchiveServices, id: string) {
  const ids = taskFamilyIds(s.store.get().tasks, id)
  if (
    [...s.questions.list(), ...s.approvals.list()].some((item) => ids.has(item.taskId)) ||
    s.terminals.list().some((terminal) => ids.has(terminal.taskId) && !terminal.exited)
  )
    return true
  try {
    for (const member of ids) {
      s.tasks.requireIdle(member)
      s.jobs.requireTaskIdle(member)
    }
    return false
  } catch {
    return true
  }
}
/** Archives a task the same way as by hand. A failure leaves it for the next pass. */
export async function archiveTask(
  s: ArchiveServices,
  id: string,
  reason: string,
  now = Date.now(),
  eligible: (task: Task) => boolean = () => true,
) {
  try {
    const current = s.store.get().tasks.find((task) => task.id === id)
    if (
      !current ||
      current.delegation ||
      current.archivedAt ||
      taskIsBusy(s, id) ||
      !eligible(current)
    )
      return false
    const ids = taskFamilyIds(s.store.get().tasks, id)
    for (const member of ids) {
      const cleanup = await Promise.allSettled([
        s.browsers.closeTask(member),
        s.simulators.closeTask(member),
        s.deviceHosts.closeTask(member),
      ])
      for (const result of cleanup) if (result.status === 'rejected') throw result.reason
    }
    const latest = s.store.get().tasks.find((task) => task.id === id)
    const latestIds = taskFamilyIds(s.store.get().tasks, id)
    if (
      !latest ||
      latest.archivedAt ||
      latestIds.size !== ids.size ||
      [...latestIds].some((member) => !ids.has(member)) ||
      taskIsBusy(s, id) ||
      !eligible(latest)
    )
      return false
    s.store.transaction(() => {
      s.store.update((workspace) => ({
        ...workspace,
        tasks: workspace.tasks.map((task) =>
          ids.has(task.id)
            ? {
                ...task,
                archived: true,
                archivedAt: task.archivedAt ?? new Date(now).toISOString(),
                snoozedUntil: null,
              }
            : task,
        ),
      }))
      s.activity.add('task', id, reason)
    })
    return true
  } catch {
    return false
  }
}

/** Per-computer upkeep from Settings → Task defaults: auto-archive and keep-awake. */
export class Housekeeping {
  private pending = new Set<Promise<unknown>>()
  private async runStep(run: () => unknown) {
    const work = Promise.resolve(run())
    this.pending.add(work)
    try {
      await work
    } finally {
      this.pending.delete(work)
    }
  }
  private archiver?: ReturnType<typeof startPolling>
  private logs?: ReturnType<typeof startPolling>
  private waker?: ReturnType<typeof startPolling>
  private caffeinate?: ChildProcess
  constructor(
    private s: Pick<
      Services,
      | 'store'
      | 'preferences'
      | 'tasks'
      | 'jobs'
      | 'terminals'
      | 'browsers'
      | 'simulators'
      | 'deviceHosts'
      | 'questions'
      | 'approvals'
      | 'activity'
      | 'artifacts'
      | 'attachments'
      | 'backups'
      | 'db'
      | 'git'
    >,
  ) {}
  start() {
    // Each step is independent: a failed archive pass must not skip pruning or cleanup.
    const step = (name: string, run: () => unknown) =>
      Effect.tryPromise(() => this.runStep(run)).pipe(
        Effect.catch((error) =>
          Effect.sync(() => console.error(`Housekeeping could not ${name}`, error.cause)),
        ),
      )
    this.archiver = startPolling(
      Effect.all(
        [
          step('settle inactive tasks', () => this.settleInactive()),
          step('archive inactive tasks', () => this.archiveInactive()),
          step('prune activity history', () => this.pruneActivity()),
          step('prune expired artifacts', () => this.s.artifacts.prune()),
          step('prune unreferenced attachments', () => this.s.attachments.prune()),
          step('create and retain verified backups', () => this.s.backups.automatic()),
          step('prune automation runs', () => this.s.jobs.prune()),
          step('remove archived worktrees', () => this.removeArchivedWorktrees()),
        ],
        { discard: true },
      ),
      {
        interval: 15 * 60_000,
        onError: (error) => console.error('Housekeeping failed', error),
      },
    )
    if (this.s.db.name !== ':memory:')
      this.logs = startPolling(
        Effect.tryPromise(() =>
          this.runStep(() => rotateRuntimeLogs(dirname(resolve(this.s.db.name)))),
        ),
        { interval: 60_000, onError: (error) => console.error('Log rotation failed', error) },
      )
    this.waker = startPolling(
      Effect.try(() => this.updateKeepAwake()),
      {
        interval: 20_000,
        onError: (error) => console.error('Could not update keep-awake', error),
      },
    )
  }
  async archiveInactive(now = Date.now()) {
    const { autoArchiveDays } = this.s.preferences.get()
    const eligibleIds = () =>
      inactiveTaskIds(
        this.s.store.get().tasks,
        this.s.preferences.get().autoArchiveDays,
        now,
        (task) => taskIsBusy(this.s, task.id),
      )
    const archived: string[] = []
    for (const id of eligibleIds())
      if (
        await archiveTask(
          this.s,
          id,
          `Archived after ${autoArchiveDays} days without activity`,
          now,
          () => eligibleIds().includes(id),
        )
      )
        archived.push(id)
    return archived
  }
  async settleInactive(now = Date.now()) {
    const settled: string[] = []
    for (const task of this.s.store.get().tasks) {
      const policy = this.s.store.projectSettings(task.repositoryId).taskBehavior
      if (!policy?.settleInactive || task.archived) continue
      const eligible = inactiveTaskIds(
        this.s.store.get().tasks,
        policy.inactiveDays ?? 3,
        now,
        (member) =>
          taskIsBusy(this.s, member.id) ||
          !!member.queue?.length ||
          !!member.draft.trim() ||
          !!member.draftAttachments?.length ||
          !!member.scheduledMessages?.length ||
          !!member.quotaContinuation,
      )
      if (!eligible.includes(task.id)) continue
      const ids = taskFamilyIds(this.s.store.get().tasks, task.id)
      this.s.store.transaction(() => {
        this.s.store.update((workspace) => ({
          ...workspace,
          tasks: workspace.tasks.map((member) =>
            ids.has(member.id)
              ? { ...member, archived: true, autoSettled: true, snoozedUntil: null }
              : member,
          ),
        }))
        this.s.activity.add(
          'task',
          task.id,
          `Settled after ${policy.inactiveDays ?? 3} days without activity`,
        )
      })
      settled.push(task.id)
    }
    return settled
  }
  /** Removes worktrees of archived tasks that have no uncommitted changes. Each removal re-checks
   * state and git refuses dirty checkouts; restoring a task reattaches its kept branch. */
  async removeArchivedWorktrees() {
    if (!this.s.preferences.get().removeArchivedWorktrees) return []
    const { worktrees } = await Effect.runPromise(listWorktreesEffect(this.s))
    const removed: string[] = []
    for (const entry of worktrees) {
      if (entry.state !== 'archived' || entry.dirty || !entry.taskId) continue
      const result = await Effect.runPromise(
        Effect.result(removeWorktreeEffect(this.s, entry.path)),
      )
      if (result._tag === 'Failure') continue
      removed.push(entry.path)
      this.s.activity.add(
        'task',
        entry.taskId,
        `Removed the archived task's worktree; branch ${entry.branch} is kept`,
      )
    }
    return removed
  }
  /** Trims activity history past the retention window in batches, yielding between them so
   * requests keep flowing. Returns how many entries were removed. */
  async pruneActivity(now = Date.now()) {
    const { activityRetentionDays } = this.s.preferences.get()
    if (!activityRetentionDays) return 0
    const before = new Date(now - activityRetentionDays * day).toISOString()
    let removed = 0
    for (let batch = 0; batch < 500; batch++) {
      const changes = this.s.activity.pruneBefore(before)
      removed += changes
      if (changes < 2000) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    return removed
  }
  /** macOS: hold a `caffeinate -i` assertion only while a task is running. */
  private updateKeepAwake() {
    const wanted =
      process.platform === 'darwin' &&
      this.s.preferences.get().preventSleepWhileRunning &&
      this.s.store.get().tasks.some((task) => task.status === 'running')
    if (wanted && !this.caffeinate) {
      const child = spawn('/usr/bin/caffeinate', ['-i', '-w', String(process.pid)], {
        stdio: 'ignore',
      })
      child.on('error', () => {})
      child.on('exit', () => {
        if (this.caffeinate === child) this.caffeinate = undefined
      })
      this.caffeinate = child
    } else if (!wanted && this.caffeinate) {
      this.caffeinate.kill()
      this.caffeinate = undefined
    }
  }
  async dispose() {
    await Promise.all([this.archiver?.stop(), this.waker?.stop(), this.logs?.stop()])
    // Poll cancellation cannot abort filesystem/SQLite promises. Drain them before DB close.
    const results = await Promise.allSettled([...this.pending])
    for (const result of results)
      if (result.status === 'rejected')
        console.error('Housekeeping failed during shutdown', result.reason)
    await this.s.backups.settle()
    this.caffeinate?.kill()
    this.caffeinate = undefined
  }
}
