import {
  pullStacks,
  stackSummary,
  taskFamilyIds,
  taskPullLinks,
  taskPullStatusFor,
  gitRemoteIdentity,
  pullRepositoryIdentity,
} from '@dovo/protocol'
import { Effect } from 'effect'
import { startPolling } from '@dovo/client-runtime'
import { checkOutcome, verifyPullUrl, type TaskSummary } from '@dovo/protocol'
import type { Services } from '../../services.js'
import { archiveTask, taskIsBusy } from '../../agents/tasks/housekeeping.js'

type PullStatus = NonNullable<TaskSummary['pullStatus']>
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
  | 'deviceHosts'
  | 'activity'
  | 'agents'
>
const same = (a: PullStatus | undefined, b: PullStatus) =>
  !!a &&
  a.number === b.number &&
  a.url === b.url &&
  a.title === b.title &&
  a.state === b.state &&
  a.draft === b.draft &&
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
  private unwatch?: () => void
  private linkedRefresh?: ReturnType<typeof setTimeout>
  private linkedTasks = new Set<string>()
  private stopping = false
  private pending = new Set<Promise<void>>()
  private attach(
    task: TaskSummary,
    pull: Omit<NonNullable<TaskSummary['linkedPullRequests']>[number], 'repositoryUrl'> & {
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
  private async linkMentions(task: TaskSummary, path: string) {
    const matches: Array<Awaited<ReturnType<Services['pullCache']['status']>>['pull']> = []
    if (!this.s.preferences.get().autoLinkPullRequests) return matches
    for (const reference of task.history.pullReferences ?? []) {
      if (
        task.ignoredPullRequestUrls?.includes(reference.url) ||
        (task.linkedPullRequests?.some((pull) => pull.url === reference.url) &&
          (task.pullStatus?.number !== undefined || !task.checkoutBranch)) ||
        task.pullRequest?.url === reference.url
      )
        continue
      try {
        // Lookup uses this repository's configured forge, never a URL supplied in agent text.
        const { pull } = await this.s.pullCache.status(path, reference.number, false, true)
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
  private shouldSettle(task: TaskSummary, state?: string) {
    const policy = {
      ...this.s.store.projectSettings(task.repositoryId).taskBehavior,
      ...task.settleBehavior,
    }
    const fallback = this.s.preferences.get().settleOnPullClose
    return state === 'merged'
      ? (policy?.settleMerged ?? fallback)
      : state === 'closed'
        ? (policy?.settleClosed ?? fallback)
        : (policy?.settleMerged ?? fallback) || (policy?.settleClosed ?? fallback)
  }
  start() {
    if (this.stopping || this.poller) return
    this.unwatch = this.s.store.onCommitted((before, after) => {
      const previous = new Map(before.tasks.map((task) => [task.id, task]))
      for (const task of after.tasks) {
        if (task.example || task.archivedAt) continue
        const prior = previous.get(task.id)
        if (
          prior &&
          prior.pullRequest === task.pullRequest &&
          prior.linkedPullRequests === task.linkedPullRequests
        )
          continue
        const urls = taskPullLinks(task)
          .filter((pull) => pull.url !== task.pullStatus?.url || !task.pullStatus.title)
          .map((pull) => pull.url)
        const saved = new Set(
          taskPullLinks(
            previous.get(task.id) ?? { pullRequest: undefined, linkedPullRequests: undefined },
          ).map((pull) => pull.url),
        )
        if (urls.some((url) => !saved.has(url))) this.linkedTasks.add(task.id)
      }
      if (!this.linkedTasks.size || this.linkedRefresh) return
      this.linkedRefresh = setTimeout(() => {
        this.linkedRefresh = undefined
        const ids = [...this.linkedTasks]
        this.linkedTasks.clear()
        for (const id of ids) {
          const task = this.s.store.get().tasks.find((task) => task.id === id)
          if (!task || task.archivedAt || this.stopping) continue
          if (taskPullLinks(task).every((link) => taskPullStatusFor(task, link.url)?.title))
            continue
          const work = this.refreshLinkedPulls(task)
          this.pending.add(work)
          void work
            .catch((error) => console.warn('Could not refresh linked PR metadata', error))
            .finally(() => this.pending.delete(work))
        }
      }, 250)
      this.linkedRefresh.unref()
    })
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
    this.stopping = true
    this.unwatch?.()
    clearTimeout(this.linkedRefresh)
    this.linkedTasks.clear()
    // Interrupting the polling fiber does not cancel its underlying refresh promise.
    const results = await Promise.allSettled([this.poller?.stop(), ...this.pending])
    for (const result of results) if (result.status === 'rejected') throw result.reason
  }
  async refresh() {
    if (this.stopping) return
    const work = this.refreshTasks()
    this.pending.add(work)
    try {
      await work
    } finally {
      this.pending.delete(work)
    }
  }
  private async refreshLinkedPulls(task: TaskSummary) {
    const links = taskPullLinks(task)
    if (!links.length) return
    const repositories = this.s.store.get().repositories
    const read = async (link: (typeof links)[number]) => {
      const identity = gitRemoteIdentity(link.repositoryUrl)
      const repository =
        repositories.find(
          (repo) =>
            !repo.kind &&
            repo.id === task.repositoryId &&
            pullRepositoryIdentity(repo) === identity,
        ) ?? repositories.find((repo) => !repo.kind && pullRepositoryIdentity(repo) === identity)
      const detail = await this.s.pullCache.status(
        repository?.path ?? link.url,
        link.number,
        false,
        true,
      )
      verifyPullUrl(link.url, detail.pull.url)
      const failed = detail.checks.filter((check) => checkOutcome(check.status) === 'failed')
      const checks = failed.length
        ? 'failed'
        : detail.checks.some((check) => checkOutcome(check.status) === 'pending')
          ? 'pending'
          : detail.checks.some((check) => checkOutcome(check.status) === 'passed')
            ? 'passed'
            : summaryChecks(detail.pull.checksState)
      return {
        number: detail.pull.number,
        url: detail.pull.url,
        title: detail.pull.title,
        state: detail.pull.state,
        draft: detail.pull.draft,
        ...(checks ? { checks } : {}),
        ...(failed.length ? { failedChecks: failed.slice(0, 20).map((check) => check.name) } : {}),
        checkedAt: new Date().toISOString(),
      }
    }
    const results: PromiseSettledResult<Awaited<ReturnType<typeof read>>>[] = []
    for (let index = 0; index < links.length; index += 4) {
      if (this.stopping) return
      results.push(...(await Promise.allSettled(links.slice(index, index + 4).map(read))))
    }
    const current = this.s.store.get().tasks.find((item) => item.id === task.id)
    if (!current || current.archivedAt || current.repositoryId !== task.repositoryId) return
    const currentLinks = taskPullLinks(current)
    // A transient provider failure retains metadata for this URL; removed links stay removed.
    const statuses = currentLinks.flatMap((link) => {
      const result = results.find((_, index) => links[index]?.url === link.url)
      const status =
        result?.status === 'fulfilled'
          ? result.value
          : current.pullStatuses?.find((status) => status.url === link.url)
      return status ? [status] : []
    })
    if (
      statuses.length !== (current.pullStatuses?.length ?? 0) ||
      statuses.some((status, index) => !same(current.pullStatuses?.[index], status))
    )
      this.s.store.update((workspace) => ({
        ...workspace,
        tasks: workspace.tasks.map((item) =>
          item.id === current.id
            ? {
                ...item,
                pullStatuses: statuses,
                linkedPullRequests: item.linkedPullRequests?.map((link) => ({
                  ...link,
                  title: statuses.find((status) => status.url === link.url)?.title || link.title,
                })),
              }
            : item,
        ),
      }))
  }
  private async refreshTasks() {
    const workspace = this.s.store.get()
    const openPulls = new Map<string, Awaited<ReturnType<Services['pullCache']['list']>>>()
    const confirmations = new Map<string, Awaited<ReturnType<Services['pullCache']['status']>>>()
    for (const task of workspace.tasks) {
      if (
        !task.example &&
        !task.archivedAt &&
        (task.pullRequest || task.linkedPullRequests?.length)
      )
        await this.refreshLinkedPulls(task)
      if (
        task.example ||
        task.archivedAt ||
        (task.archived &&
          task.pullStatus?.state !== 'open' &&
          !this.s.preferences.get().archiveOnPullMerge)
      )
        continue
      if (!task.pullRequest && !task.checkoutBranch && !task.history.pullReferences?.length)
        continue
      const repo = workspace.repositories.find((item) => item.id === task.repositoryId)
      if (!repo || repo.kind) continue
      try {
        const mentioned = await this.linkMentions(task, repo.path)
        if (!task.pullRequest && !task.checkoutBranch) continue
        let open = openPulls.get(repo.path)
        if (!open) {
          open = await this.s.pullCache.list(repo.path, 'open', 1, false, true)
          const preferences = this.s.preferences.get()
          if (open.stale && (this.shouldSettle(task) || preferences.archiveOnPullMerge))
            open = await this.s.pullCache.list(repo.path, 'open', 1, true, true)
          openPulls.set(repo.path, open)
        }
        // A task with only a branch may have a pull request beyond the first page.
        // Keep pages already fetched for this repository so other tasks reuse them.
        if (task.checkoutBranch && !task.pullRequest && !task.pullStatus?.number)
          while (
            open.hasMore &&
            !open.pulls.some((pull) => matchesBranch(pull, task.checkoutBranch))
          ) {
            const next = await this.s.pullCache.list(repo.path, 'open', open.page + 1, false, true)
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
            title: summary.title,
            url: summary.url,
            state: 'open',
            draft: summary.draft,
            ...(checks ? { checks } : {}),
            checkedAt: new Date().toISOString(),
          }
        else {
          // Failing checks need their names; a pull request that left the open list was
          // merged or closed. Both come from the (cached) detail.
          let detail = await this.s.pullCache.status(repo.path, number, false, true)
          const preferences = this.s.preferences.get()
          if (
            detail.pull.state !== 'open' &&
            !task.pinned &&
            !task.queue?.length &&
            !task.draft.trim() &&
            !task.draftAttachments?.length &&
            !task.scheduledMessages?.length &&
            !taskIsBusy(this.s, task.id) &&
            (preferences.archiveOnPullMerge ||
              (this.shouldSettle(task, detail.pull.state) && !task.archived))
          ) {
            const key = JSON.stringify([repo.path, number])
            const confirmed =
              confirmations.get(key) ??
              (await this.s.pullCache.status(repo.path, number, true, true))
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
            title: detail.pull.title,
            url: detail.pull.url,
            state: detail.pull.state,
            draft: detail.pull.draft,
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
                  !member.waitingForFeedback &&
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
          else if (this.shouldSettle(task, status.state) && !current.archived) {
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
