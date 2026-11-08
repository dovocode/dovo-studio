import { useEffect, useEffectEvent, useMemo } from 'react'
import {
  buildThreadTree,
  threadPhaseLabels,
  watchRuntimeSettled,
  type NestedThread,
  type Task,
} from '@dovo/protocol'
import { useStudioHost, useWorkspace } from '@dovo/studio-core'

export function TaskAgentLineage({ task }: { task: Task }) {
  const host = useStudioHost()
  const { workspace, snapshot, connected, activeRuntimeId, connection, runtimes } = useWorkspace()
  const connections = JSON.stringify([
    ...new Map(
      [
        ...(connection ? [connection] : []),
        ...runtimes.map((source) => source.profile.connection),
      ].map((entry) => [JSON.stringify(entry), entry]),
    ).values(),
  ])
  const subscribe = useEffectEvent(() => {
    const stops = [
      ...(connection ? [watchRuntimeSettled(connection)] : []),
      ...runtimes
        .filter((source) => source.profile.id !== activeRuntimeId)
        .map((source) => watchRuntimeSettled(source.profile.connection)),
    ]
    return () => stops.forEach((stop) => stop())
  })
  useEffect(() => subscribe(), [connections])
  const tree = useMemo(() => {
    const sources = [
      {
        runtimeId: activeRuntimeId,
        online: connected,
        name: snapshot?.runtimeHost ?? 'This computer',
        workspace,
        snapshot,
      },
      ...runtimes
        .filter((source) => source.profile.id !== activeRuntimeId && source.snapshot)
        .map((source) => ({
          runtimeId: source.profile.id,
          online: source.connected,
          name: source.profile.name,
          workspace: source.snapshot!.workspace,
          snapshot: source.snapshot,
        })),
    ]
    return buildThreadTree(
      sources.flatMap((source) =>
        source.workspace.tasks.map((item) => ({
          key: JSON.stringify([source.runtimeId, item.id]),
          task: source.runtimeId === activeRuntimeId && item.id === task.id ? task : item,
          needsInput: false,
          projectName:
            source.workspace.repositories.find((repo) => repo.id === item.repositoryId)?.name ??
            'No Project',
          source,
        })),
      ),
    )
  }, [workspace, snapshot, connected, activeRuntimeId, runtimes, task])
  const selected = JSON.stringify([activeRuntimeId, task.id])
  const root = tree.nodes.get(tree.rootKeys.get(selected) ?? selected)
  if (!root || (!root.children.length && !root.nativeAgents?.length && root.key === selected))
    return null
  const branch = (node: NestedThread, depth = 0) => (
    <li key={node.key} className="min-w-0">
      <button
        type="button"
        aria-current={node.key === selected ? 'page' : undefined}
        disabled={!host.openThread || node.key === selected}
        className={`w-full min-w-0 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent/50 ${node.key === selected ? 'bg-accent font-medium' : ''}`}
        onClick={() =>
          host.openThread?.({
            runtimeId: node.runtimeId,
            runtimeIdentity: node.runtimeIdentity,
            threadId: node.threadId,
            title: node.title,
          })
        }
      >
        <span className="block truncate">{node.title || 'Untitled thread'}</span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {node.computerName} · {node.online ? threadPhaseLabels[node.phase] : 'Offline'}
          {node.partial ? ' · Partial history' : ''}
        </span>
      </button>
      {(node.children.length > 0 || !!node.nativeAgents?.length) && depth < 16 && (
        <ul className="ml-3 border-l border-border pl-2">
          {node.nativeAgents?.map((agent) => (
            <li key={agent.key} className="px-2 py-1 text-xs">
              <span className="block break-words">{agent.name}</span>
              <span className="text-[11px] text-muted-foreground">
                {agent.status === 'working' ? 'Running' : agent.status}
              </span>
            </li>
          ))}
          {node.nativeAgentOverflow && node.nativeAgentOverflow.total > 0 && (
            <li className="px-2 py-1 text-xs text-muted-foreground">
              {node.nativeAgentOverflow.total} more native agents
            </li>
          )}
          {node.children.map((child) => branch(child, depth + 1))}
        </ul>
      )}
    </li>
  )
  return (
    <section aria-label="Agent lineage" className="mx-2.5 my-3 min-w-0 border-t pt-3">
      <h3 className="mb-2 text-xs font-medium">Agent lineage</h3>
      <ul className="max-h-64 overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable]">
        {branch(root)}
      </ul>
    </section>
  )
}
