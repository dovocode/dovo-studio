import { pullStacks, stackSummary, taskFamilyIds } from '@dovo/protocol'
import { Effect } from 'effect'
import { startPolling } from '@dovo/client-runtime'
import { checkOutcome, pullReferencesInText, verifyPullUrl, type Task } from '@dovo/protocol'
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
  JSON.stringify(a.failedChecks ?? []) === JSON.stringify(b.failedChecks ?? []) &&
  JSON.stringify(a.stack) === JSON.stringify(b.stack)
/** GitHub REST uses owner:branch labels, unlike the checkout's plain branch name. */
function matchesBranch(pull: { head: string; url: string }, branch: string | undefined) {
  if (!branch) return false
  if (pull.head === branch) return true
  const colon = pull.head.indexOf(':')
  if (colon < 1 || pull.head.slice(colon + 1) !== branch) return false
  try {
    const url = new URL(pull.url)
    const match = url.pathname.match(/^\/([^/]+)\/[^/]+\/pull\/\d+\/?$/)
    // A fork using the same branch name must not settle this checkout's thread.
    return !!match && match[1]!.toLowerCase() === pull.head.slice(0, colon).toLowerCase()
  } catch {
    return false
  }
}
const summaryChecks = (state: string | null | undefined) => {
  if (!state) return undefined
  const outcome = checkOutcome(state)
  return outcome === 'neutral' ? undefined : outcome
}

/** Follows each task's pull request, found by the task's PR link or by its branch, so tasks
 * show merge and check state, and can archive themselves once merged (Settings, optional). */
export class TaskPullWatcher {
  private poller?: ReturnType<typeof startPolling>
  private attach(
    task: Task,
    pull: Omit<NonNullable<Task['linkedPullRequests']>[number], 'repositoryUrl'> & {
      repositoryUrl?: string
    },
  ) {
    const current = this.s.store.get().tasks.find((item) => item.id === task.id)
    if (
      !current ||
      current.archivedAt ||
      current.repositoryId !== task.repositoryId ||
      !this.s.preferences.get().autoLinkPullRequests ||
      current.pullRequest?.url === pull.url ||
      current.ignoredPullRequestUrls?.includes(pull.url) ||
      current.linkedPullRequests?.some((item) => item.url === pull.url) ||
      (current.linkedPullRequests?.length ?? 0) >= 20
    )
      return
    this.s.store.update((value) => ({
      ...value,
      tasks: value.tasks.map((item) =>
        item.id === task.id
          ? {
              ...item,
              linkedPullRequests: [
                ...(item.linkedPullRequests ?? []),
                {
                  number: pull.number,
                  url: pull.url,
                  title: pull.title,
                  provider: pull.provider,
                  repositoryUrl:
                    pull.repositoryUrl ??
                    pull.url
                      .replace(
                        /\/(?:pull|pulls|pull-requests|pullrequest|merge_requests)\/\d+\/?(?:[?#].*)?$/i,
                        '',
                      )
                      .replace(/\/-$/, ''),
                },
              ],
            }
          : item,
      ),
    }))
  }
  private async linkMentions(task: Task, path: string) {
    const matches: Array<Awaited<ReturnType<Services['pullCache']['status']>>['pull']> = []
    if (!this.s.preferences.get().autoLinkPullRequests) return matches
    const references = new Map(
      task.messages
        .flatMap((message) => pullReferencesInText(message.text))
        .map((reference) => [reference.url, reference]),
    )
    for (const reference of [...references.values()].slice(-20)) {
      if (
        task.ignoredPullRequestUrls?.includes(reference.url) ||
        (task.linkedPullRequests?.some((pull) => pull.url === reference.url) &&
          (task.pullStatus?.number !== undefined || !task.checkoutBranch)) ||
        task.pullRequest?.url === reference.url
      )
        continue
      try {
        // Lookup uses this repository's configured forge, never a URL supplied in agent text.
        const { pull } = await this.s.pullCache.status(path, reference.number)
        verifyPullUrl(reference.url, pull.url)
        matches.push(pull)
        this.attach(task, pull)
      } catch {
        // A foreign-project URL, missing PR or unavailable forge cannot become a trusted link.
        continue
      }
    }
    return matches
  }
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
    const confirmations = new Map<string, Awaited<ReturnType<Services['pullCache']['status']>>>()
    for (const task of workspace.tasks) {
      if (
        task.example ||
        task.archivedAt ||
        (task.archived &&
          task.pullStatus?.state !== 'open' &&
          !this.s.preferences.get().archiveOnPullMerge)
      )
        continue
      if (
        !task.pullRequest &&
        !task.checkoutBranch &&
        !task.messages.some((message) =>
          /\/(?:pull|pulls|pull-requests|pullrequest|merge_requests)\//i.test(message.text),
        )
      )
        continue
      const repo = workspace.repositories.find((item) => item.id === task.repositoryId)
      if (!repo || repo.kind) continue
      try {
        const mentioned = await this.linkMentions(task, repo.path)
        if (!task.pullRequest && !task.checkoutBranch) continue
        let open = openPulls.get(repo.path)
        if (!open) {
          open = await this.s.pullCache.list(repo.path, 'open', 1)
          const preferences = this.s.preferences.get()
          if (open.stale && (preferences.settleOnPullClose || preferences.archiveOnPullMerge))
            open = await this.s.pullCache.list(repo.path, 'open', 1, true)
          openPulls.set(repo.path, open)
        }
        // A task with only a branch may have a pull request beyond the first page.
        // Keep pages already fetched for this repository so other tasks reuse them.
        if (task.checkoutBranch && !task.pullRequest && !task.pullStatus?.number)
          while (
            open.hasMore &&
            !open.pulls.some((pull) => matchesBranch(pull, task.checkoutBranch))
          ) {
            const next = await this.s.pullCache.list(repo.path, 'open', open.page + 1)
            open = { ...next, pulls: [...open.pulls, ...next.pulls] }
            openPulls.set(repo.path, open)
            if (!next.pulls.length) break
          }
        const branchMatches = open.pulls.filter((pull) => matchesBranch(pull, task.checkoutBranch))
        const byBranch = branchMatches.length === 1 ? branchMatches[0] : undefined
        const mentionedBranch = mentioned.filter((pull) => matchesBranch(pull, task.checkoutBranch))
        const number =
          task.pullRequest?.number ??
          byBranch?.number ??
          (mentionedBranch.length === 1 ? mentionedBranch[0]?.number : undefined) ??
          task.pullStatus?.number
        if (!number) continue
        const summary = open.pulls.find((pull) => pull.number === number)
        const checks = summary ? summaryChecks(summary.checksState) : undefined
        let status: PullStatus
        let freshClosure = false
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
          let detail = await this.s.pullCache.status(repo.path, number)
          const preferences = this.s.preferences.get()
          if (
            detail.pull.state !== 'open' &&
            !task.pinned &&
            !task.queue?.length &&
            !task.draft.trim() &&
            !task.draftAttachments?.length &&
            !task.scheduledMessages?.length &&
            !taskIsBusy(this.s, task.id) &&
            (preferences.archiveOnPullMerge || (preferences.settleOnPullClose && !task.archived))
          ) {
            const key = JSON.stringify([repo.path, number])
            const confirmed =
              confirmations.get(key) ?? (await this.s.pullCache.status(repo.path, number, true))
            confirmations.set(key, confirmed)
            detail = confirmed
          }
          freshClosure =
            !detail.stale &&
            !detail.refreshError &&
            (!!task.pullRequest || matchesBranch(detail.pull, task.checkoutBranch))
          this.attach(task, detail.pull)
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
        const stack = pullStacks(
          open.pulls,
          !open.hasMore && !open.stale && !open.refreshError,
        ).get(number)
        status.stack = stack ? stackSummary(stack) : undefined
        if (summary) this.attach(task, summary)
        const current = this.s.store.get().tasks.find((item) => item.id === task.id)
        if (
          !current ||
          current.archivedAt ||
          current.repositoryId !== task.repositoryId ||
          current.checkoutBranch !== task.checkoutBranch ||
          current.pullRequest?.url !== task.pullRequest?.url
        )
          continue
        // Metadata only: keep updatedAt, so a status change neither reorders the task list
        // nor counts as activity for "auto-archive inactive tasks".
        if (!same(current.pullStatus, status))
          this.s.store.update((value) => ({
            ...value,
            tasks: value.tasks.map((item) =>
              item.id === task.id ? { ...item, pullStatus: status } : item,
            ),
          }))
        const canSettle = () => {
          const tasks = this.s.store.get().tasks
          const latest = tasks.find((item) => item.id === task.id)
          const ids = taskFamilyIds(tasks, task.id)
          return (
            !!latest &&
            !latest.delegation &&
            !latest.archivedAt &&
            latest.repositoryId === task.repositoryId &&
            latest.checkoutBranch === task.checkoutBranch &&
            latest.pullRequest?.url === task.pullRequest?.url &&
            latest.pullStatus?.url === status.url &&
            (latest.pullStatus.state === 'merged' || latest.pullStatus.state === 'closed') &&
            !latest.ignoredPullRequestUrls?.includes(status.url) &&
            tasks.every(
              (member) =>
                !ids.has(member.id) ||
                (!member.pinned &&
                  !member.queue?.length &&
                  !member.draft.trim() &&
                  !member.draftAttachments?.length &&
                  !member.scheduledMessages?.length),
            ) &&
            !taskIsBusy(this.s, task.id)
          )
        }
        if (
          freshClosure &&
          (status.state === 'merged' || status.state === 'closed') &&
          canSettle()
        ) {
          const preferences = this.s.preferences.get()
          if (preferences.archiveOnPullMerge)
            await archiveTask(
              this.s,
              task.id,
              `Archived because pull request #${number} was ${status.state}`,
              Date.now(),
              () => this.s.preferences.get().archiveOnPullMerge && canSettle(),
            )
          else if (preferences.settleOnPullClose && !current.archived) {
            const ids = taskFamilyIds(this.s.store.get().tasks, task.id)
            this.s.store.transaction(() => {
              this.s.store.update((workspace) => ({
                ...workspace,
                tasks: workspace.tasks.map((item) =>
                  ids.has(item.id) ? { ...item, archived: true, snoozedUntil: null } : item,
                ),
              }))
              this.s.activity.add(
                'task',
                task.id,
                `Settled because pull request #${number} was ${status.state}`,
              )
            })
          }
        }
      } catch {
        // An unreachable forge or a missing pull request leaves the last known status.
        continue
      }
    }
  }
}
