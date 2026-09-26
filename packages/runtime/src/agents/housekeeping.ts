import { spawn, type ChildProcess } from 'node:child_process'
import { startPolling } from '@dovo/client-runtime'
import { Effect } from 'effect'
import type { Task } from '@dovo/protocol'
import type { Services } from '../services.js'
import { listWorktreesEffect, removeWorktreeEffect } from '../scm/worktrees.js'

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
    this.archiver = startPolling(
      Effect.promise(async () => {
        await this.archiveInactive()
        await this.pruneActivity()
        await this.removeArchivedWorktrees()
      }),
      {
        interval: 15 * 60_000,
        onError: () => {},
      },
    )
    this.waker = startPolling(
      Effect.sync(() => this.updateKeepAwake()),
      {
        interval: 20_000,
        onError: () => {},
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
      try {
        this.s.tasks.requireIdle(task.id)
        this.s.jobs.requireTaskIdle(task.id)
        return false
      } catch {
        return true
      }
    })
    for (const id of ids) {
      // Same cleanup as archiving by hand; a failure leaves the task for the next pass.
      try {
        await this.s.browsers.close(id)
        await this.s.simulators.closeTask(id)
        this.s.store.updateTask(id, (task) => ({
          ...task,
          archived: true,
          archivedAt: task.archivedAt ?? new Date(now).toISOString(),
          snoozedUntil: null,
        }))
        this.s.activity.add('task', id, `Archived after ${autoArchiveDays} days without activity`)
      } catch {
        continue
      }
    }
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
