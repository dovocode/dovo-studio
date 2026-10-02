import { spawn, type ChildProcess } from 'node:child_process'
import { startPolling } from '@dovo/client-runtime'
import { Effect } from 'effect'
import type { Task } from '@dovo/protocol'
import type { Services } from '../../services.js'
import { listWorktreesEffect, removeWorktreeEffect } from '../../scm/git/worktrees.js'

const day = 86_400_000

/** When a task last saw activity: its latest turn, update or creation. */
export function lastTaskActivity(task: Task) {
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
    .filter(
      (task) =>
        !task.example &&
        !task.archivedAt &&
        !task.pinned &&
        task.status !== 'running' &&
        !busy(task) &&
        now - lastTaskActivity(task) > days * day,
    )
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
  | 'activity'
>
/** Whether a task is doing or waiting for something, so automatic archiving must skip it. */
export function taskIsBusy(s: ArchiveServices, id: string) {
  if (
    [...s.questions.list(), ...s.approvals.list()].some((item) => item.taskId === id) ||
    s.terminals.list().some((terminal) => terminal.taskId === id && !terminal.exited)
  )
    return true
  try {
    s.tasks.requireIdle(id)
    s.jobs.requireTaskIdle(id)
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
) {
  try {
    await s.browsers.closeTask(id)
    await s.simulators.closeTask(id)
    s.store.updateTask(id, (task) => ({
      ...task,
      archived: true,
      archivedAt: task.archivedAt ?? new Date(now).toISOString(),
      snoozedUntil: null,
    }))
    s.activity.add('task', id, reason)
    return true
  } catch {
    return false
  }
}

/** Per-computer upkeep from Settings → Task defaults: auto-archive and keep-awake. */
export class Housekeeping {
  private archiver?: ReturnType<typeof startPolling>
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
      | 'questions'
      | 'approvals'
      | 'activity'
      | 'git'
    >,
  ) {}
  start() {
    // Each step is independent: a failed archive pass must not skip pruning or cleanup.
    const step = (name: string, run: () => unknown) =>
      Effect.tryPromise(async () => {
        await run()
      }).pipe(
        Effect.catchAll((error) =>
          Effect.sync(() => console.error(`Housekeeping could not ${name}`, error.cause)),
        ),
      )
    this.archiver = startPolling(
      Effect.all(
        [
          step('archive inactive tasks', () => this.archiveInactive()),
          step('prune activity history', () => this.pruneActivity()),
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
    const waiting = new Set(
      [...this.s.questions.list(), ...this.s.approvals.list()].map((item) => item.taskId),
    )
    const openTerminals = new Set(
      this.s.terminals
        .list()
        .filter((terminal) => !terminal.exited)
        .map((terminal) => terminal.taskId),
    )
    const ids = inactiveTaskIds(this.s.store.get().tasks, autoArchiveDays, now, (task) => {
      if (waiting.has(task.id) || openTerminals.has(task.id)) return true
      return taskIsBusy(this.s, task.id)
    })
    for (const id of ids)
      await archiveTask(this.s, id, `Archived after ${autoArchiveDays} days without activity`, now)
    return ids
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
        Effect.either(removeWorktreeEffect(this.s, entry.path)),
      )
      if (result._tag === 'Left') continue
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
    await Promise.all([this.archiver?.stop(), this.waker?.stop()])
    this.caffeinate?.kill()
    this.caffeinate = undefined
  }
}
