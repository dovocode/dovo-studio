import { Effect } from 'effect'
import { startPolling } from '@dovo/client-runtime'
import { checkOutcome, type Task } from '@dovo/protocol'
import type { Services } from '../../services.js'
import { archiveTask, taskIsBusy } from '../../agents/tasks/housekeeping.js'

type PullStatus = NonNullable<Task['pullStatus']>
type WatcherServices = Pick<
  Services,
  | 'store'
  | 'pullCache'
  | 'preferences'
  | 'tasks'
  | 'jobs'
  | 'terminals'
  | 'questions'
  | 'approvals'
  | 'browsers'
  | 'simulators'
  | 'activity'
>
const same = (a: PullStatus | undefined, b: PullStatus) =>
  !!a &&
  a.number === b.number &&
  a.state === b.state &&
  a.checks === b.checks &&
  JSON.stringify(a.failedChecks ?? []) === JSON.stringify(b.failedChecks ?? [])
const summaryChecks = (state: string | null | undefined) => {
  if (!state) return undefined
  const outcome = checkOutcome(state)
  return outcome === 'neutral' ? undefined : outcome
}

/** Follows each task's pull request, found by the task's PR link or by its branch, so tasks
 * show merge and check state, and can archive themselves once merged (Settings, optional). */
export class TaskPullWatcher {
  private poller?: ReturnType<typeof startPolling>
  constructor(private s: WatcherServices) {}
  start() {
    this.poller = startPolling(
      Effect.tryPromise(() => this.refresh()),
      {
        interval: 120_000,
        immediate: false,
        backoff: 600_000,
        onError: (error) => console.error('Could not refresh task pull requests', error),
      },
    )
  }
  async dispose() {
    await this.poller?.stop()
  }
  async refresh() {
    const workspace = this.s.store.get()
    const openPulls = new Map<string, Awaited<ReturnType<Services['pullCache']['list']>>>()
    for (const task of workspace.tasks) {
      if (task.example || task.archivedAt || (!task.pullRequest && !task.checkoutBranch)) continue
      const repo = workspace.repositories.find((item) => item.id === task.repositoryId)
      if (!repo) continue
      try {
        let open = openPulls.get(repo.path)
        if (!open) {
          open = await this.s.pullCache.list(repo.path, 'open', 1)
          openPulls.set(repo.path, open)
        }
        // A task with only a branch may have a pull request beyond the first page.
        // Keep pages already fetched for this repository so other tasks reuse them.
        if (task.checkoutBranch && !task.pullRequest && !task.pullStatus?.number)
          while (open.hasMore && !open.pulls.some((pull) => pull.head === task.checkoutBranch)) {
            const next = await this.s.pullCache.list(repo.path, 'open', open.page + 1)
            open = { ...next, pulls: [...open.pulls, ...next.pulls] }
            openPulls.set(repo.path, open)
            if (!next.pulls.length) break
          }
        const byBranch = task.checkoutBranch
          ? open.pulls.find((pull) => pull.head === task.checkoutBranch)
          : undefined
        const number = task.pullRequest?.number ?? task.pullStatus?.number ?? byBranch?.number
        if (!number) continue
        const summary = open.pulls.find((pull) => pull.number === number)
        const checks = summary ? summaryChecks(summary.checksState) : undefined
        let status: PullStatus
        if (summary && checks !== 'failed')
          status = {
            number,
            url: summary.url,
            state: 'open',
            ...(checks ? { checks } : {}),
            checkedAt: new Date().toISOString(),
          }
        else {
          // Failing checks need their names; a pull request that left the open list was
          // merged or closed. Both come from the (cached) detail.
          const detail = await this.s.pullCache.detail(repo.path, number)
          const outcomes = detail.checks.map((check) => ({
            name: check.name,
            outcome: checkOutcome(check.status),
          }))
          const failed = outcomes.filter((check) => check.outcome === 'failed')
          const overall = failed.length
            ? 'failed'
            : outcomes.some((check) => check.outcome === 'pending')
              ? 'pending'
              : outcomes.some((check) => check.outcome === 'passed')
                ? 'passed'
                : undefined
          status = {
            number,
            url: detail.pull.url,
            state: detail.pull.state,
            ...(overall ? { checks: overall } : {}),
            ...(failed.length
              ? { failedChecks: failed.slice(0, 20).map((check) => check.name) }
              : {}),
            checkedAt: new Date().toISOString(),
          }
        }
        const current = this.s.store.get().tasks.find((item) => item.id === task.id)
        if (!current || current.archivedAt) continue
        // Metadata only: keep updatedAt, so a status change neither reorders the task list
        // nor counts as activity for "auto-archive inactive tasks".
        if (!same(current.pullStatus, status))
          this.s.store.update((value) => ({
            ...value,
            tasks: value.tasks.map((item) =>
              item.id === task.id ? { ...item, pullStatus: status } : item,
            ),
          }))
        if (
          (status.state === 'merged' || status.state === 'closed') &&
          this.s.preferences.get().archiveOnPullMerge &&
          !current.pinned &&
          !taskIsBusy(this.s, task.id)
        )
          await archiveTask(
            this.s,
            task.id,
            `Archived because pull request #${number} was ${status.state}`,
          )
      } catch {
        // An unreachable forge or a missing pull request leaves the last known status.
        continue
      }
    }
  }
}
