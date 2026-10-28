import { nextQueuedMessage } from '@dovo/protocol'
import { createHash } from 'node:crypto'
import {
  taskFamilyIds,
  mergeThreadWatchEntries,
  sumThreadWatchEntries,
  permissionPolicyReadOnly,
  resolveTaskAgent,
  nativeAgentWorking,
  taskFailureVersion,
  threadNativeAgents,
  threadNativeAgentOverflow,
  compareThreadWatchSources,
  type TaskSummary,
  type ThreadWatchEntry,
  type ThreadWatchSummary,
  type ThreadWatchSnapshot,
} from '@dovo/protocol'
import type { Services } from '../services.js'

/** Read only persisted/cached state. A snapshot never starts recursive remote requests. */
export function threadSnapshot(s: Services, id: string): ThreadWatchSnapshot {
  const task = s.store.taskSummary(id)
  const family = taskFamilyIds(s.store.get().tasks, id)
  const questions = s.questions.list(),
    approvals = s.approvals.list()
  const tasks = s.store.get().tasks.filter((item) => family.has(item.id))
  // Put ancestors first so truncation cannot strand a displayed descendant.
  const byId = new Map(tasks.map((item) => [item.id, item]))
  const depth = (item: TaskSummary) => {
    let current = item,
      value = 0
    const seen = new Set<string>()
    while (current.id !== id && current.delegation && !seen.has(current.id)) {
      seen.add(current.id)
      const parent = byId.get(current.delegation.parentTaskId)
      if (!parent) break
      current = parent
      value++
    }
    return value
  }
  tasks.sort((a, b) => Number(b.id === id) - Number(a.id === id) || depth(a) - depth(b))
  const local = tasks.map((item): ThreadWatchEntry => {
    const pipelines = s.pipelineWatch.counts(item.id),
      pulls = s.pullRequestWatch.counts(item.id)
    const attention = [
      ...questions.filter((q) => q.taskId === item.id).map((q) => `question:${q.id}`),
      ...approvals.filter((q) => q.taskId === item.id).map((q) => `approval:${q.id}`),
    ].slice(0, 100)
    const writable = !permissionPolicyReadOnly(resolveTaskAgent(item, s.store.get().agents))
    const watches = {
      pipelines: writable ? pipelines.active : 0,
      pullRequests: writable ? pulls.active : 0,
      failures: pipelines.failures + pulls.failures,
    }
    const repository = s.store
      .get()
      .repositories.find((repository) => repository.id === item.repositoryId)
    const parent =
      item.spawnParent ??
      (item.delegation
        ? {
            runtimeId: s.runtimeId,
            threadId: item.delegation.parentTaskId,
            title: s.store
              .get()
              .tasks.find((parent) => parent.id === item.delegation?.parentTaskId)
              ?.title?.slice(0, 1000),
          }
        : undefined)
    return {
      title: item.title.slice(0, 1000),
      repositoryId: item.repositoryId || undefined,
      projectIdentity: repository?.gitIdentity?.slice(0, 2000),
      projectKind: repository?.kind === 'scratch' ? 'scratch' : 'project',
      nativeAgents: threadNativeAgents(item),
      nativeAgentOverflow: threadNativeAgentOverflow(item),
      projectName: (repository?.kind === 'scratch' ? 'No Project' : repository?.name)?.slice(
        0,
        1000,
      ),
      parent,
      status: item.status,
      failureVersion: item.status === 'failed' ? taskFailureVersion(item) : undefined,
      runtimeId: s.runtimeId,
      threadId: item.id,
      attention,
      watches,
      phase: attention.length
        ? 'needs-input'
        : item.status === 'draft' && !item.activeRunId
          ? 'draft'
          : item.subagents?.some(nativeAgentWorking) ||
              item.activeRunId ||
              item.status === 'running' ||
              (!!nextQueuedMessage(item) && !item.queuePaused)
            ? 'running'
            : watches.pipelines || watches.pullRequests
              ? 'waiting'
              : 'completed',
      revision: JSON.stringify([
        item.activeRunId,
        item.historyRevision,
        item.runAttempt,
        item.status,
      ]),
    }
  })
  const remote = s.preferences.get().enableStudioThreads
    ? tasks.flatMap((item) => s.threadWatch.list(item.id))
    : []
  const merged = mergeThreadWatchEntries(local, remote, s.runtimeId)
  // Presentation retains stopped branches without treating them as active provider watches.
  const presentation = new Map(
    local.map((entry) => [JSON.stringify([entry.runtimeId, entry.threadId]), entry]),
  )
  const presentationSources = new Map<string, ThreadWatchSummary>()
  let partial =
    merged.partial ||
    tasks.some(
      (item) => (item.subagents ?? []).filter((agent) => agent.source !== 'dovo').length > 40,
    )
  for (const owner of tasks)
    for (const watch of s.threadWatch.list(owner.id)) {
      if (watch.relation !== 'spawned' || !watch.snapshot) continue
      const snapshot = watch.snapshot
      const identity =
        snapshot.runtimeId ?? (watch.runtimeId === 'local' ? s.runtimeId : watch.runtimeId)
      const facts = snapshot.threads ??
        snapshot.entries ?? [
          {
            runtimeId: identity,
            threadId: watch.threadId,
            title: snapshot.title,
            projectName: snapshot.projectName,
            repositoryId: snapshot.repositoryId,
            projectIdentity: snapshot.projectIdentity,
            projectKind: snapshot.projectKind,
            nativeAgents: snapshot.nativeAgents,
            nativeAgentOverflow: snapshot.nativeAgentOverflow,
            status: snapshot.status,
            failureVersion: snapshot.failureVersion,
            phase: snapshot.phase,
            revision: snapshot.revision,
            attention: snapshot.attention,
            watches: snapshot.watches,
          },
        ]
      partial ||= !!snapshot.partial || (!snapshot.threads && !snapshot.entries)
      for (const fact of facts) {
        const key = JSON.stringify([fact.runtimeId, fact.threadId])
        const previous = presentationSources.get(key)
        if (
          presentation.has(key) &&
          (!previous || compareThreadWatchSources(watch, previous, fact, s.runtimeId) <= 0)
        )
          continue
        if (!presentation.has(key) && presentation.size >= 200) {
          partial = true
          continue
        }
        presentationSources.set(key, watch)
        presentation.set(key, {
          ...fact,
          computerName: fact.computerName ?? watch.computerName,
          parent:
            fact.runtimeId === identity && fact.threadId === watch.threadId
              ? { runtimeId: s.runtimeId, threadId: owner.id, title: owner.title.slice(0, 1000) }
              : fact.parent,
          paused:
            !s.preferences.get().enableStudioThreads ||
            !!fact.paused ||
            watch.status === 'stopped' ||
            !!watch.paused,
          offline: !!fact.offline || watch.offline,
        })
      }
    }
  partial ||= presentation.size > 200
  const activeEntries = merged.entries.filter((entry) => !entry.offline && !entry.paused)
  const attention = activeEntries
    .flatMap((entry) =>
      entry.attention.map((value) =>
        createHash('sha256')
          .update(JSON.stringify([entry.runtimeId, entry.threadId, value]))
          .digest('hex'),
      ),
    )
    .sort()
    .slice(0, 100)
  const watches = sumThreadWatchEntries(merged.entries)
  const phase = attention.length
    ? 'needs-input'
    : tasks.some((task) => task.subagents?.some(nativeAgentWorking)) ||
        activeEntries.some((entry) => entry.phase === 'running')
      ? task.status === 'draft' &&
        !task.activeRunId &&
        merged.entries.every((entry) => entry.phase === 'draft')
        ? 'draft'
        : 'running'
      : activeEntries.some((entry) => entry.phase === 'draft')
        ? 'draft'
        : activeEntries.some((entry) => entry.phase === 'waiting') ||
            tasks.some(
              (item) =>
                !!item.subagentInbox?.length ||
                item.queue?.some((message) => message.subagentResultId) ||
                item.subagents?.some((agent) => agent.completion === 'pending') ||
                (item.id !== id && item.delegation?.completion === 'pending'),
            ) ||
            remote.some((w) => w.status === 'watching' && !w.paused && (w.offline || !w.snapshot))
          ? 'waiting'
          : 'completed'
  const answer =
    phase === 'completed' && task.status !== 'failed' && task.status !== 'cancelled'
      ? [...(s.store.historyPage(id)?.messages ?? [])]
          .reverse()
          .find((message) => message.role === 'assistant')?.text
      : undefined
  const repository = s.store
    .get()
    .repositories.find((repository) => repository.id === task.repositoryId)
  return {
    humanInputs: [
      ...questions
        .filter((question) => family.has(question.taskId) && question.routing !== 'parent')
        .map((question) => ({
          id: question.id,
          runtimeId: s.runtimeId,
          taskId: question.taskId,
          kind: 'question' as const,
          title: question.prompt.title.slice(0, 1000),
          threadTitle: byId.get(question.taskId)?.title.slice(0, 1000) ?? 'Child thread',
        })),
      ...approvals
        .filter((approval) => family.has(approval.taskId))
        .map((approval) => ({
          id: approval.id,
          runtimeId: s.runtimeId,
          taskId: approval.taskId,
          kind: 'approval' as const,
          title: approval.title.slice(0, 1000),
          threadTitle: byId.get(approval.taskId)?.title.slice(0, 1000) ?? 'Child thread',
        })),
      ...remote
        .filter(
          (watch) =>
            watch.delegated && !watch.offline && !watch.paused && watch.status === 'watching',
        )
        .flatMap((watch) => watch.snapshot?.humanInputs ?? []),
    ].slice(0, 100),
    questions: questions
      .filter((question) => question.taskId === id && question.routing === 'parent')
      .slice(0, 100),
    runtimeId: s.runtimeId,
    title: task.title.slice(0, 1000),
    repositoryId: task.repositoryId || undefined,
    projectIdentity: repository?.gitIdentity?.slice(0, 2000),
    projectKind: repository?.kind === 'scratch' ? 'scratch' : 'project',
    nativeAgents: threadNativeAgents(task),
    nativeAgentOverflow: threadNativeAgentOverflow(task),
    failureVersion: task.status === 'failed' ? taskFailureVersion(task) : undefined,
    projectName: (repository?.kind === 'scratch' ? 'No Project' : repository?.name)?.slice(0, 1000),
    phase,
    attention,
    watches,
    revision: createHash('sha256')
      .update(
        JSON.stringify(
          merged.entries.map(
            ({
              runtimeId,
              threadId,
              revision,
              phase,
              attention,
              watches,
              nativeAgents,
              nativeAgentOverflow,
            }) => ({
              runtimeId,
              threadId,
              revision,
              phase,
              attention,
              watches,
              nativeAgentOverflow,
              nativeAgents: nativeAgents?.map(({ key, status, working }) => ({
                key,
                status,
                working,
              })),
            }),
          ),
        ),
      )
      .digest('hex'),
    entries: merged.entries,
    threads: [...presentation.values()].slice(0, 200),
    partial: partial || undefined,
    status: task.status,
    error: task.error?.slice(0, 2000),
    result: answer?.slice(0, 20000),
    resultTruncated: answer && answer.length > 20000 ? true : undefined,
  }
}

/** Build local family rollups from own counts and provenance, never from prior rollups. */
export function familyWatchCounts(
  tasks: readonly TaskSummary[],
  own: ReadonlyMap<string, ThreadWatchEntry>,
  remote: ReadonlyMap<string, ThreadWatchSummary[]>,
  runtimeId: string,
) {
  const owners = new Map(tasks.map((task) => [task.id, task]))
  const families = new Map<string, Set<string>>()
  for (const task of tasks) {
    let current: string | undefined = task.id
    const seen = new Set<string>()
    while (current && !seen.has(current)) {
      seen.add(current)
      const family = families.get(current) ?? new Set<string>()
      family.add(task.id)
      families.set(current, family)
      current = owners.get(current)?.delegation?.parentTaskId
    }
  }
  return new Map(
    tasks.map((task) => {
      const ids = [...(families.get(task.id) ?? [])]
      const entries = ids.flatMap((id) => {
        const entry = own.get(id)
        return entry ? [entry] : []
      })
      return [
        task.id,
        sumThreadWatchEntries(
          mergeThreadWatchEntries(
            entries,
            ids.flatMap((id) => remote.get(id) ?? []),
            runtimeId,
          ).entries,
        ),
      ]
    }),
  )
}
