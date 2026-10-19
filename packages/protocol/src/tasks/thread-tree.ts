import { nativeAgentWorking } from '../conversation/workflow/subagents.js'
import {
  compareThreadWatchSources,
  type ThreadWatchSummary,
  type ThreadNativeAgent,
  type ThreadWatchEntry,
} from './thread-watches.js'
import type { TaskMetadata } from './task-summary.js'
import {
  taskFailureVersion,
  threadFailureKey,
  threadNativeAgents,
  threadNativeAgentOverflow,
} from './subagent-failures.js'
import type { RuntimeSnapshot } from '../runtime/connection/runtime.js'

export type ThreadTreeEntry = {
  key: string
  task: TaskMetadata
  needsInput: boolean
  projectName: string
  source: {
    runtimeId: string | null
    name: string
    online: boolean
    snapshot: Pick<RuntimeSnapshot, 'runtimeId' | 'questions' | 'approvals'> | null
  }
}
const taskCollectionKey = (runtimeId: string | null, threadId: string) =>
  JSON.stringify([runtimeId, threadId])

export type NestedThread = {
  key: string
  runtimeId: string | null
  runtimeIdentity?: string
  threadId: string
  title: string
  projectName?: string
  repositoryId?: string
  projectIdentity?: string
  projectKind?: 'scratch' | 'project'
  nativeAgents?: readonly ThreadNativeAgent[]
  nativeAgentOverflow?: ThreadWatchEntry['nativeAgentOverflow']
  needsInput?: boolean
  partial?: boolean
  failureKey?: string
  activity?: string
  computerName: string
  phase:
    | 'connecting'
    | 'draft'
    | 'running'
    | 'waiting'
    | 'needs-input'
    | 'completed'
    | 'failed'
    | 'stopped'
    | 'stopping'
    | 'review'
  online: boolean
  paused: boolean
  lastSuccessAt?: string
  children: NestedThread[]
}

function threadNode(entry: ThreadTreeEntry): NestedThread {
  const { task, source } = entry
  const needsInput = [
    ...(source.snapshot?.questions ?? []),
    ...(source.snapshot?.approvals ?? []),
  ].some((request) => request.taskId === task.id)
  return {
    needsInput,
    failureKey:
      task.status === 'failed'
        ? threadFailureKey(
            source.snapshot?.runtimeId ?? source.runtimeId,
            task.id,
            taskFailureVersion(task),
          )
        : undefined,
    key: entry.key,
    runtimeId: source.runtimeId,
    runtimeIdentity: source.snapshot?.runtimeId,
    threadId: task.id,
    title: task.title,
    computerName: source.name,
    projectName: entry.projectName,
    repositoryId: task.repositoryId,
    nativeAgents: threadNativeAgents(task),
    nativeAgentOverflow: threadNativeAgentOverflow(task),
    phase:
      task.status === 'failed'
        ? 'failed'
        : needsInput
          ? 'needs-input'
          : task.status === 'running' || task.subagents?.some(nativeAgentWorking)
            ? 'running'
            : task.status === 'cancelled'
              ? 'stopped'
              : task.waitingForFeedback
                ? 'waiting'
                : task.status === 'draft'
                  ? 'draft'
                  : task.status === 'review'
                    ? 'review'
                    : 'completed',
    online: source.online,
    paused: false,
    children: [],
  }
}

/** Build a forest from explicit spawn relationships, never from titles or matching thread IDs. */
export function buildThreadTree<Entry extends ThreadTreeEntry>(
  entries: readonly Entry[],
  previous?: ReadonlyMap<string, NestedThread>,
  include?: (entry: Entry) => boolean,
  options: {
    includeSnapshot?: (thread: NestedThread) => boolean
    runtimeIds?: ReadonlyMap<string, string | null>
  } = {},
) {
  const nodes = new Map(entries.map((entry) => [entry.key, threadNode(entry)]))
  const parents = new Map<string, string>()
  const identities = new Map(
    entries.flatMap((entry) =>
      entry.source.snapshot?.runtimeId
        ? [[entry.source.snapshot.runtimeId, entry.source.runtimeId] as const]
        : [],
    ),
  )
  for (const [identity, id] of options.runtimeIds ?? []) identities.set(identity, id)
  const resolveIdentity = (identity: string) =>
    identities.has(identity) ? identities.get(identity)! : identity
  const snapshotSources = new Map<string, ThreadWatchSummary>()
  const acceptSnapshot = (
    key: string,
    watch: ThreadWatchSummary,
    identity: string,
    threadId: string,
  ) => {
    if (entryByKey.get(key)?.source.online) return false
    const previous = snapshotSources.get(key)
    if (
      previous &&
      compareThreadWatchSources(watch, previous, { runtimeId: identity, threadId }, '') <= 0
    )
      return false
    snapshotSources.set(key, watch)
    return true
  }
  const entryByKey = new Map(entries.map((entry) => [entry.key, entry]))
  const attach = (parentKey: string, childKey: string) => {
    const parentEntry = entryByKey.get(parentKey),
      childEntry = entryByKey.get(childKey)
    // Promote a matching child when its owner is outside the visible scope.
    if (include && parentEntry && childEntry && include(childEntry) && !include(parentEntry)) return
    if (parents.has(childKey)) return
    // A linked peer can report a cycle or self-reference. Keep every thread navigable.
    let ancestor: string | undefined = parentKey
    while (ancestor) {
      if (ancestor === childKey) return
      ancestor = parents.get(ancestor)
    }
    const parent = nodes.get(parentKey)
    const child = nodes.get(childKey)
    if (!parent || !child) return
    parents.set(childKey, parentKey)
    parent.children.push(child)
  }
  // Local delegation is authoritative when a remote monitor also refers to the same child.
  for (const entry of entries)
    if (entry.task.delegation) {
      const parentKey = taskCollectionKey(
        entry.source.runtimeId,
        entry.task.delegation.parentTaskId,
      )
      const record = entryByKey
        .get(parentKey)
        ?.task.subagents?.find(
          (agent) => agent.source === 'dovo' && (agent.taskId ?? agent.id) === entry.task.id,
        )
      nodes.get(entry.key)!.activity = record?.activity
      attach(parentKey, entry.key)
    }
  for (const entry of entries) {
    const parent = entry.task.spawnParent
    if (parent)
      attach(taskCollectionKey(resolveIdentity(parent.runtimeId), parent.threadId), entry.key)
  }
  for (const entry of entries) {
    // Archiving a parent stops observing its remote work, but must not hide that work.
    if (entry.task.archivedAt) continue
    for (const watch of entry.task.threadWatches ?? []) {
      if (watch.relation !== 'spawned') continue
      const fallback = watch.runtimeId === 'local' ? entry.source.runtimeId : watch.runtimeId
      const runtimeId = watch.snapshot?.runtimeId
        ? resolveIdentity(watch.snapshot.runtimeId)
        : fallback
      const key = taskCollectionKey(runtimeId, watch.threadId)
      const candidate = {
        ...watch,
        snapshot: watch.snapshot
          ? { ...watch.snapshot, runtimeId: watch.snapshot.runtimeId ?? fallback ?? undefined }
          : undefined,
        offline: !entry.source.online || watch.offline,
      }
      if (
        acceptSnapshot(key, candidate, watch.snapshot?.runtimeId ?? fallback ?? '', watch.threadId)
      ) {
        const node = nodes.get(key)
        const next = watchedNode(entry, watch, runtimeId, key)
        next.partial ||= !!watch.snapshot && !(watch.snapshot.threads ?? watch.snapshot.entries)
        if (node) Object.assign(node, next, { children: node.children })
        else nodes.set(key, next)
      }
      // Monitoring state belongs to the direct relationship even with a live UI snapshot.
      if (
        (!parents.has(key) || parents.get(key) === entry.key) &&
        entryByKey.get(key)?.source.online
      ) {
        nodes.get(key)!.paused = watch.status === 'stopped' || !!watch.paused
      }
      const facts = watch.snapshot?.threads ?? watch.snapshot?.entries ?? []
      const factByKey = new Map(
        facts.map((fact) => [taskCollectionKey(fact.runtimeId, fact.threadId), fact]),
      )
      const snapshotRoot = taskCollectionKey(
        watch.snapshot?.runtimeId ?? watch.runtimeId,
        watch.threadId,
      )
      const factKey = (runtime: string, thread: string) =>
        taskCollectionKey(resolveIdentity(runtime), thread)
      const admitted = new Set<string>()
      for (const fact of facts) {
        if (fact.threadId === watch.threadId && fact.runtimeId === watch.snapshot?.runtimeId)
          continue
        if (fact.title === undefined || !fact.parent) {
          if (fact.title === undefined) nodes.get(key)!.partial = true
          continue
        }
        let ancestor = taskCollectionKey(fact.parent.runtimeId, fact.parent.threadId)
        const seen = new Set<string>([taskCollectionKey(fact.runtimeId, fact.threadId)])
        while (ancestor !== snapshotRoot && !seen.has(ancestor)) {
          seen.add(ancestor)
          const next = factByKey.get(ancestor)?.parent
          if (!next) break
          ancestor = taskCollectionKey(next.runtimeId, next.threadId)
        }
        if (ancestor !== snapshotRoot) continue
        const childKey = factKey(fact.runtimeId, fact.threadId)
        admitted.add(childKey)
        const existing = nodes.get(childKey)
        if (acceptSnapshot(childKey, candidate, fact.runtimeId, fact.threadId)) {
          const next: NestedThread = {
            key: childKey,
            runtimeId: resolveIdentity(fact.runtimeId),
            runtimeIdentity: fact.runtimeId,
            threadId: fact.threadId,
            title: fact.title || 'Untitled thread',
            projectName: fact.projectName,
            repositoryId: fact.repositoryId,
            projectIdentity: fact.projectIdentity,
            projectKind: fact.projectKind,
            nativeAgents: fact.nativeAgents,
            nativeAgentOverflow: fact.nativeAgentOverflow,
            computerName: fact.computerName ?? watch.computerName,
            phase:
              fact.status === 'failed'
                ? 'failed'
                : fact.status === 'cancelled'
                  ? 'stopped'
                  : fact.phase,
            needsInput: fact.attention.length > 0,
            failureKey:
              fact.status === 'failed'
                ? threadFailureKey(
                    fact.runtimeId,
                    fact.threadId,
                    fact.failureVersion ?? fact.revision,
                  )
                : undefined,
            online: entry.source.online && !watch.offline && !fact.offline,
            paused: !!fact.paused,
            lastSuccessAt: watch.lastSuccessAt,
            children: existing?.children ?? [],
          }
          if (existing) Object.assign(existing, next)
          else nodes.set(childKey, next)
        }
      }
      for (const fact of facts)
        if (fact.parent && admitted.has(factKey(fact.runtimeId, fact.threadId)))
          attach(
            factKey(fact.parent.runtimeId, fact.parent.threadId),
            factKey(fact.runtimeId, fact.threadId),
          )
      attach(entry.key, key)
      if (watch.stopRequested && watch.status === 'watching' && parents.get(key) === entry.key)
        nodes.get(key)!.phase = 'stopping'
    }
  }
  const rootKeys = new Map<string, string>()
  for (const key of nodes.keys()) {
    let root = key
    while (parents.has(root)) root = parents.get(root)!
    rootKeys.set(key, root)
  }
  // Streaming one conversation should not re-render every other thread tree.
  const retain = (node: NestedThread, paused = false): NestedThread => {
    node.paused ||= paused
    node.children = node.children.map((child) => retain(child, node.paused))
    const old = previous?.get(node.key)
    if (
      old &&
      old.children.length === node.children.length &&
      old.children.every((child, i) => child === node.children[i])
    ) {
      node.children = old.children
      if (JSON.stringify(node.nativeAgentOverflow) === JSON.stringify(old.nativeAgentOverflow))
        node.nativeAgentOverflow = old.nativeAgentOverflow
      if (JSON.stringify(node.nativeAgents) === JSON.stringify(old.nativeAgents))
        node.nativeAgents = old.nativeAgents
      if (
        (Object.keys(node) as (keyof NestedThread)[]).every((key) => Object.is(old[key], node[key]))
      ) {
        nodes.set(node.key, old)
        return old
      }
    }
    return node
  }
  for (const node of nodes.values()) if (!parents.has(node.key)) retain(node)
  const contextKeys = new Set<string>()
  if (options.includeSnapshot)
    for (const entry of entries) {
      if (parents.has(entry.key) || entry.task.archivedAt || include?.(entry)) continue
      if (
        threadDescendants(nodes.get(entry.key)?.children ?? []).some(
          (node) => !entryByKey.has(node.key) && options.includeSnapshot!(node),
        )
      )
        contextKeys.add(entry.key)
    }
  return {
    contextKeys,
    roots: entries
      .filter((entry) => !parents.has(entry.key))
      .map((entry) =>
        !entry.needsInput &&
        threadDescendants(nodes.get(entry.key)?.children ?? []).some(
          (child) => child.online && !child.paused && threadNeedsInput(child),
        )
          ? { ...entry, needsInput: true }
          : entry,
      ),
    nodes,
    rootKeys,
  }
}

function watchedNode(
  parent: ThreadTreeEntry,
  watch: ThreadWatchSummary,
  runtimeId: string | null,
  key: string,
): NestedThread {
  const own = (watch.snapshot?.threads ?? watch.snapshot?.entries)?.find(
    (fact) => fact.threadId === watch.threadId && fact.runtimeId === watch.snapshot?.runtimeId,
  )
  return {
    needsInput: own ? own.attention.length > 0 : watch.snapshot?.phase === 'needs-input',
    partial: watch.snapshot?.partial,
    failureKey:
      watch.snapshot?.status === 'failed'
        ? threadFailureKey(
            watch.snapshot.runtimeId ?? runtimeId,
            watch.threadId,
            watch.snapshot.failureVersion ?? watch.snapshot.revision,
          )
        : undefined,
    key,
    runtimeId,
    runtimeIdentity: watch.snapshot?.runtimeId,
    threadId: watch.threadId,
    title: watch.snapshot?.title ?? 'Connected thread',
    computerName: watch.computerName,
    projectName: watch.snapshot?.projectName,
    repositoryId: watch.snapshot?.repositoryId,
    projectIdentity: watch.snapshot?.projectIdentity,
    projectKind: watch.snapshot?.projectKind,
    nativeAgents: own?.nativeAgents ?? watch.snapshot?.nativeAgents,
    nativeAgentOverflow: own?.nativeAgentOverflow ?? watch.snapshot?.nativeAgentOverflow,
    phase:
      watch.stopRequested && watch.status === 'watching'
        ? 'stopping'
        : watch.snapshot?.status === 'failed'
          ? 'failed'
          : watch.snapshot?.status === 'cancelled'
            ? 'stopped'
            : (own?.phase ?? watch.snapshot?.phase ?? 'connecting'),
    online: parent.source.online && !watch.offline,
    paused: watch.status === 'stopped' || !!watch.paused,
    lastSuccessAt: watch.lastSuccessAt,
    children: [],
  }
}

export function threadDescendants(children: readonly NestedThread[]): NestedThread[] {
  return children.flatMap((child) => [child, ...threadDescendants(child.children)])
}

/** Summarize child work; provider PR/check watches keep their own presentation. */
export function threadTreeSummary(
  children: readonly NestedThread[],
  acknowledged: readonly string[] = [],
) {
  const descendants = threadDescendants(children)
  const count = (phase: NestedThread['phase']) =>
    descendants.filter((child) => child.online && !child.paused && child.phase === phase).length
  return {
    total: descendants.length,
    running: count('running'),
    attention: descendants.filter(
      (child) => child.online && !child.paused && threadNeedsInput(child),
    ).length,
    waiting: count('waiting'),
    failed:
      descendants.filter(
        (child) =>
          child.phase === 'failed' &&
          (!child.failureKey || !acknowledged.includes(child.failureKey)),
      ).length +
      descendants.reduce(
        (sum, child) =>
          sum +
          nativeOverflowFailures(child, acknowledged) +
          (child.nativeAgents ?? []).filter(
            (agent) => agent.status === 'failed' && !acknowledged.includes(agent.key),
          ).length,
        0,
      ),
    offline: descendants.filter((child) => !child.online).length,
  }
}
export const threadPhaseLabels: Record<NestedThread['phase'], string> = {
  connecting: 'Connecting',
  draft: 'Draft',
  running: 'Running',
  waiting: 'Waiting',
  'needs-input': 'Needs input',
  completed: 'Done',
  failed: 'Failed',
  stopped: 'Stopped',
  stopping: 'Stopping…',
  review: 'Review',
}

/** Finished branches can be hidden without losing a live or failed descendant. */
export function visibleThreadChildren(
  children: readonly NestedThread[],
  hideFinished: boolean,
  acknowledged: readonly string[] = [],
): NestedThread[] {
  if (!hideFinished) return [...children]
  return children.flatMap((child) => {
    const children = visibleThreadChildren(child.children, true, acknowledged)
    return (child.phase !== 'completed' &&
      child.phase !== 'stopped' &&
      child.phase !== 'review' &&
      !(child.phase === 'failed' && child.failureKey && acknowledged.includes(child.failureKey))) ||
      threadNeedsInput(child) ||
      !!child.nativeAgentOverflow?.working ||
      nativeOverflowFailures(child, acknowledged) > 0 ||
      child.nativeAgents?.some(
        (agent) =>
          agent.working || (agent.status === 'failed' && !acknowledged.includes(agent.key)),
      ) ||
      children.length
      ? [{ ...child, children }]
      : []
  })
}

/** Show watched children absent from the local agents index, keeping their immediate owner. */
export function unlistedThreadBranches(
  thread: NestedThread,
  listed: ReadonlySet<string>,
): NestedThread[] {
  const children = thread.children.filter((child) => !listed.has(child.key))
  return [
    ...(children.length ? [{ ...thread, children }] : []),
    ...thread.children
      .filter((child) => listed.has(child.key))
      .flatMap((child) => unlistedThreadBranches(child, listed)),
  ]
}

export function threadNeedsInput(thread: NestedThread) {
  return thread.needsInput ?? thread.phase === 'needs-input'
}

export function nativeOverflowFailures(
  thread: Pick<NestedThread, 'nativeAgentOverflow'>,
  acknowledged: readonly string[] = [],
) {
  const overflow = thread.nativeAgentOverflow
  return overflow && (!overflow.failureKey || !acknowledged.includes(overflow.failureKey))
    ? overflow.failed
    : 0
}
