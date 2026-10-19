import type { ThreadWatchSummary } from '@dovo/protocol'
import { taskCollectionKey, type TaskEntry } from './task-collection'

export type NestedThread = {
  key: string
  runtimeId: string | null
  runtimeIdentity?: string
  threadId: string
  title: string
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
    | 'review'
  online: boolean
  paused: boolean
  lastSuccessAt?: string
  children: NestedThread[]
}

function threadNode(entry: TaskEntry): NestedThread {
  const { task, source } = entry
  return {
    key: entry.key,
    runtimeId: source.runtimeId,
    runtimeIdentity: source.snapshot?.runtimeId,
    threadId: task.id,
    title: task.title,
    computerName: source.name,
    phase: [...(source.snapshot?.questions ?? []), ...(source.snapshot?.approvals ?? [])].some(
      (request) => request.taskId === task.id,
    )
      ? 'needs-input'
      : task.status === 'running'
        ? 'running'
        : task.waitingForFeedback
          ? 'waiting'
          : task.status === 'draft'
            ? 'draft'
            : task.status === 'failed'
              ? 'failed'
              : task.status === 'cancelled'
                ? 'stopped'
                : task.status === 'review'
                  ? 'review'
                  : 'completed',
    online: source.online,
    paused: false,
    children: [],
  }
}

/** Build a forest from explicit spawn relationships, never from titles or matching thread IDs. */
export function buildThreadTree(
  entries: readonly TaskEntry[],
  previous?: ReadonlyMap<string, NestedThread>,
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
  const attach = (parentKey: string, childKey: string) => {
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
  const entryByKey = new Map(entries.map((entry) => [entry.key, entry]))
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
    // Archiving a parent stops observing its remote work, but must not hide that work.
    if (entry.task.archivedAt) continue
    for (const watch of entry.task.threadWatches ?? []) {
      if (watch.relation !== 'spawned') continue
      const fallback = watch.runtimeId === 'local' ? entry.source.runtimeId : watch.runtimeId
      const runtimeId = watch.snapshot?.runtimeId
        ? (identities.get(watch.snapshot.runtimeId) ?? fallback)
        : fallback
      const key = taskCollectionKey(runtimeId, watch.threadId)
      if (!nodes.has(key)) nodes.set(key, watchedNode(entry, watch, runtimeId, key))
      else if (
        entryByKey.get(key)?.source.online === false &&
        (!parents.has(key) || parents.get(key) === entry.key)
      ) {
        const node = nodes.get(key)!
        node.lastSuccessAt = watch.lastSuccessAt
        // A background monitor can still reach a peer whose UI connection is unavailable.
        if (
          entry.source.online &&
          !watch.offline &&
          !watch.paused &&
          watch.status === 'watching' &&
          watch.snapshot
        ) {
          Object.assign(node, watchedNode(entry, watch, runtimeId, key), {
            children: node.children,
            runtimeIdentity: watch.snapshot.runtimeId ?? node.runtimeIdentity,
          })
        }
      }
      attach(entry.key, key)
    }
  }
  const rootKeys = new Map<string, string>()
  for (const key of nodes.keys()) {
    let root = key
    while (parents.has(root)) root = parents.get(root)!
    rootKeys.set(key, root)
  }
  // Streaming one conversation should not re-render every other thread tree.
  const retain = (node: NestedThread): NestedThread => {
    node.children = node.children.map(retain)
    const old = previous?.get(node.key)
    if (
      old &&
      old.children.length === node.children.length &&
      old.children.every((child, i) => child === node.children[i])
    ) {
      node.children = old.children
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
  return {
    roots: entries
      .filter((entry) => !parents.has(entry.key))
      .map((entry) =>
        !entry.needsInput &&
        threadDescendants(nodes.get(entry.key)?.children ?? []).some(
          (child) => child.online && !child.paused && child.phase === 'needs-input',
        )
          ? { ...entry, needsInput: true }
          : entry,
      ),
    nodes,
    rootKeys,
  }
}

function watchedNode(
  parent: TaskEntry,
  watch: ThreadWatchSummary,
  runtimeId: string | null,
  key: string,
): NestedThread {
  return {
    key,
    runtimeId,
    runtimeIdentity: watch.snapshot?.runtimeId,
    threadId: watch.threadId,
    title: watch.snapshot?.title ?? 'Connected thread',
    computerName: watch.computerName,
    phase: watch.snapshot?.phase ?? 'connecting',
    online: parent.source.online && !watch.offline,
    paused: watch.status === 'stopped' || !!watch.paused,
    lastSuccessAt: watch.lastSuccessAt,
    children: [],
  }
}

export function threadDescendants(children: readonly NestedThread[]): NestedThread[] {
  return children.flatMap((child) => [child, ...threadDescendants(child.children)])
}
