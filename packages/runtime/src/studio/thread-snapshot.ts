import { createHash } from 'node:crypto'
import {
  taskFamilyIds,
  mergeThreadWatchEntries,
  sumThreadWatchEntries,
  permissionPolicyReadOnly,
  resolveTaskAgent,
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
    return {
      runtimeId: s.runtimeId,
      threadId: item.id,
      attention,
      watches,
      phase: attention.length
        ? 'needs-input'
        : item.status === 'draft' && !item.activeRunId
          ? 'draft'
          : item.activeRunId ||
              item.status === 'running' ||
              (!!item.queue?.length && !item.queuePaused)
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
  const attention = merged.entries
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
    : s.tasks.hasWorkingFamily(id) || merged.entries.some((entry) => entry.phase === 'running')
      ? task.status === 'draft' &&
        !task.activeRunId &&
        merged.entries.every((entry) => entry.phase === 'draft')
        ? 'draft'
        : 'running'
      : merged.entries.some((entry) => entry.phase === 'draft')
        ? 'draft'
        : merged.entries.some((entry) => entry.phase === 'waiting') ||
            remote.some((w) => w.status === 'watching' && !w.paused && (w.offline || !w.snapshot))
          ? 'waiting'
          : 'completed'
  return {
    runtimeId: s.runtimeId,
    title: task.title.slice(0, 1000),
    phase,
    attention,
    watches,
    revision: createHash('sha256').update(JSON.stringify(merged.entries)).digest('hex'),
    entries: merged.entries,
    partial: merged.partial || undefined,
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
