import { createdPulls, pullCommands, commandInput, commandOutput } from './pull-commands.js'
import type { CompletedCommand } from '../../agents/execution/run-turn.js'
import {
  pullStacks,
  pullReference,
  stackSummary,
  taskFamilyIds,
  taskPullLinks,
  taskPullStatusFor,
  gitRemoteIdentity,
  pullRepositoryIdentity,
  threadPullLink,
  type Repository,
} from '@dovo/protocol'
import { Effect } from 'effect'
import { startPolling } from '@dovo/client-runtime'
import { checkOutcome, verifyPullUrl, type TaskSummary } from '@dovo/protocol'
import type { Services } from '../../services.js'
import { archiveTask, taskIsBusy } from '../../agents/tasks/housekeeping.js'

type PullStatus = NonNullable<TaskSummary['pullStatus']>
type WatcherServices = Pick<
  Services,
  | 'git'
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
  private unwatchCommands?: () => void
  private commandWork = Promise.resolve()
  private closingTasks = new Set<string>()
  private commandPulls = new Map<string, { number: number; url: string }>()
  private enqueueCommand(work: () => Promise<void>) {
    const pending = this.commandWork
      .then(async () => {
        if (!this.stopping) await work()
      })
      .catch((error: unknown) => console.warn('Could not refresh PRs after a shell command', error))
    this.commandWork = pending
    this.pending.add(pending)
    void pending.finally(() => this.pending.delete(pending))
  }
  private async completedCommand({ taskId, tool }: CompletedCommand) {
    const input = commandInput(tool.input)
    const commands = pullCommands(input)
    if (!commands.length) return
    const task = this.s.store.get().tasks.find((task) => task.id === taskId)
    if (!task || task.example || task.archivedAt) return
    const repo = this.s.store
      .get()
      .repositories.find((repo) => repo.id === task.repositoryId && !repo.kind)
    const identity = repo && pullRepositoryIdentity(repo)
    if (!repo || !identity) return
    const sameProject = () => {
      const current = this.s.store.get().repositories.find((value) => value.id === repo.id)
      return (
        !!current &&
        current.path === repo.path &&
        pullRepositoryIdentity(current) === identity &&
        current.forge?.connectionId === repo.forge?.connectionId &&
        current.forge?.repository === repo.forge?.repository &&
        current.forge?.revision === repo.forge?.revision
      )
    }
    const matching = commands.filter((command) => {
      if (!command.repository) return true
      const host = identity.slice(0, identity.indexOf('/'))
      return (
        gitRemoteIdentity(
          command.repository.includes('://')
            ? command.repository
            : `https://${host}/${command.repository}`,
        ) === identity
      )
    })
    if (!matching.length) return
    const closed = matching.filter((command) => command.action !== 'create')
    if (closed.length && task.activeRunId) this.closingTasks.add(taskId)
    const references = matching.some((command) => command.action === 'create')
      ? createdPulls(input, commandOutput(tool.output))
      : []
    for (const command of closed) {
      if (!command.target) continue
      try {
        const reference = pullReference(command.target)
        references.push({ number: reference.number, url: reference.url ?? '' })
      } catch {
        // A branch target is resolved using the verified checkout association below.
      }
    }
    for (const reference of references) {
      if (this.stopping) return
      if (reference.url) {
        const link = threadPullLink(reference.url)
        if (!link?.repositoryUrl || gitRemoteIdentity(link.repositoryUrl) !== identity) continue
      }
      try {
        const detail = await this.s.pullCache.status(repo.path, reference.number, true, true)
        if (detail.stale || detail.refreshError || detail.warnings.length) continue
        verifyPullUrl(reference.url || undefined, detail.pull.url)
        const link = threadPullLink(detail.pull.url)
        if (!link?.repositoryUrl || gitRemoteIdentity(link.repositoryUrl) !== identity) continue
        // A bare number from a different checkout cannot attach or settle this thread.
        if (
          !reference.url &&
          !matchesBranch(detail.pull, task.checkoutBranch) &&
          !taskPullLinks(task).some((link) => link.url === detail.pull.url)
        )
          continue
        const current = this.s.store.get().tasks.find((task) => task.id === taskId)
        if (
          this.stopping ||
          !current ||
          current.ignoredPullRequestUrls?.includes(detail.pull.url) ||
          !sameProject() ||
          current.repositoryId !== task.repositoryId ||
          current.checkoutBranch !== task.checkoutBranch
        )
          continue
        this.attach(task, detail.pull)
        if (
          closed.length &&
          (!task.checkoutBranch || matchesBranch(detail.pull, task.checkoutBranch)) &&
          taskPullLinks(this.s.store.taskSummary(taskId)).some(
            (link) => link.url === detail.pull.url,
          )
        )
          this.commandPulls.set(taskId, { number: detail.pull.number, url: detail.pull.url })
      } catch {
        // A command's output is only a hint; unavailable or mismatched forge data cannot link it.
      }
    }
    const currentTask = this.s.store.get().tasks.find((value) => value.id === taskId)
    if (
      this.stopping ||
      !sameProject() ||
      currentTask?.repositoryId !== task.repositoryId ||
      currentTask.checkoutBranch !== task.checkoutBranch
    )
      return
    await this.refreshTasks(taskId, true)
  }
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
  private async linkMentions(task: TaskSummary, repo: Repository) {
    const matches: Array<Awaited<ReturnType<Services['pullCache']['status']>>['pull']> = []
    if (!this.s.preferences.get().autoLinkPullRequests) return matches
    const identity =
      pullRepositoryIdentity(repo) ??
      (!repo.forge && !repo.gitIdentityError && task.history.pullReferences?.length
        ? await this.s.git.repositoryIdentity(repo.path)
        : undefined)
    for (const reference of task.history.pullReferences ?? []) {
      if (
        task.ignoredPullRequestUrls?.includes(reference.url) ||
        (task.linkedPullRequests?.some((pull) => pull.url === reference.url) &&
          (task.pullStatus?.number !== undefined || !task.checkoutBranch)) ||
        task.pullRequest?.url === reference.url
      )
        continue
      const link = threadPullLink(reference.url)
      // Reject foreign repository mentions before looking up their number in this project.
      if (!identity || !link?.repositoryUrl || gitRemoteIdentity(link.repositoryUrl) !== identity)
        continue
      try {
        // Lookup uses this repository's configured forge, never a URL supplied in agent text.
        const { pull } = await this.s.pullCache.status(repo.path, reference.number, false, true)
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
    this.unwatchCommands = this.s.tasks.onCommandCompleted((event) => {
      if (!/\b(?:gh|glab)\b/.test(commandInput(event.tool.input))) return
      this.enqueueCommand(() => this.completedCommand(event))
    })
    this.unwatch = this.s.store.onCommitted((before, after) => {
      const previous = new Map(before.tasks.map((task) => [task.id, task]))
      if (this.commandPulls.size || this.closingTasks.size) {
        const currentTasks = new Map(after.tasks.map((task) => [task.id, task]))
        for (const [id, hint] of this.commandPulls) {
          const current = currentTasks.get(id)
          const prior = previous.get(id)
          if (
            !current ||
            current.archivedAt ||
            current.repositoryId !== prior?.repositoryId ||
            current.checkoutBranch !== prior?.checkoutBranch ||
            !taskPullLinks(current).some((link) => link.url === hint.url)
          ) {
            this.commandPulls.delete(id)
            this.closingTasks.delete(id)
          }
        }
        for (const id of this.closingTasks)
          if (!currentTasks.has(id) || currentTasks.get(id)?.archivedAt)
            this.closingTasks.delete(id)
      }
      for (const task of after.tasks) {
        if (task.example || task.archivedAt) continue
        const prior = previous.get(task.id)
        if (prior?.activeRunId && !task.activeRunId && this.closingTasks.delete(task.id)) {
          // releaseRun clears activeRunId before releasing its in-memory lock. The queued
          // microtask runs after that lock is released, and rechecks --auto merges as well.
          this.enqueueCommand(() => this.refreshTasks(task.id, true))
        }
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
    this.unwatchCommands?.()
    this.closingTasks.clear()
    this.commandPulls.clear()
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
  private async refreshTasks(taskId?: string, force = false) {
    const workspace = this.s.store.get()
    const openPulls = new Map<string, Awaited<ReturnType<Services['pullCache']['list']>>>()
    const confirmations = new Map<string, Awaited<ReturnType<Services['pullCache']['status']>>>()
    for (const task of workspace.tasks) {
      if (this.stopping) return
      if (taskId && task.id !== taskId) continue
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
      if (
        !task.pullRequest &&
        !task.checkoutBranch &&
        !task.history.pullReferences?.length &&
        !this.commandPulls.has(task.id) &&
        !task.pullStatus?.number
      )
        continue
      const repo = workspace.repositories.find((item) => item.id === task.repositoryId)
      if (!repo || repo.kind) continue
      try {
        const mentioned = await this.linkMentions(task, repo)
        // A shell-linked branchless PR keeps following its verified association after restart.
        const remembered = taskPullLinks(task).find(
          (link) =>
            link.url === task.pullStatus?.url &&
            gitRemoteIdentity(link.repositoryUrl) === pullRepositoryIdentity(repo),
        )
        const commandPull = this.commandPulls.get(task.id) ?? remembered
        if (!task.pullRequest && !task.checkoutBranch && !commandPull) continue
        let open = openPulls.get(repo.path)
        if (!open) {
          open = await this.s.pullCache.list(repo.path, 'open', 1, force, true)
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
            const next = await this.s.pullCache.list(repo.path, 'open', open.page + 1, force, true)
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
          task.pullStatus?.number ??
          commandPull?.number
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
          let detail = await this.s.pullCache.status(repo.path, number, force, true)
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
            (!!task.pullRequest ||
              matchesBranch(detail.pull, task.checkoutBranch) ||
              commandPull?.url === detail.pull.url)
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
