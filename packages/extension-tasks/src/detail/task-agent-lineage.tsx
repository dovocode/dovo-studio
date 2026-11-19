import { useEffect, useEffectEvent, useMemo } from 'react'
import {
  buildThreadTree,
  threadPhaseLabels,
  threadChildRows,
  watchRuntimeSettled,
  type NestedThread,
  type Task,
} from '@dovo/protocol'
import { useStudioHost, useWorkspace } from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'
import { NestedThreads } from '../list/nested-threads'
import { collectTasks, taskCollectionKey, taskSources } from '../list/task-collection'

export function TaskAgentLineage({
  task,
  onManageAgents,
}: {
  task: Task
  onManageAgents: () => void
}) {
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
  const selected = taskCollectionKey(activeRuntimeId, task.id)
  const tree = useMemo(
    () =>
      buildThreadTree(
        collectTasks(
          taskSources({ workspace, snapshot, connected, connection, runtimes, activeRuntimeId }),
        ),
      ),
    [workspace, snapshot, connected, connection, runtimes, activeRuntimeId],
  )
  const root = tree.nodes.get(tree.rootKeys.get(selected) ?? selected)
  const thread = tree.nodes.get(selected)
  const childRows = useMemo(() => (thread ? threadChildRows(thread) : []), [thread])
  if (!root || (!childRows.length && root.key === selected && !root.nativeAgentOverflow?.total))
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
      {node.key === selected && childRows.length > 0 ? (
        <NestedThreads
          hideSummary
          threads={childRows}
          parent={node}
          acknowledgedFailures={task.acknowledgedSubagentFailures}
        />
      ) : (
        (node.children.length > 0 ||
          !!node.nativeAgents?.length ||
          !!node.nativeAgentOverflow?.total) &&
        depth < 16 && (
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
        )
      )}
    </li>
  )
  return (
    <section aria-label="Agent lineage" className="mx-2.5 my-3 min-w-0 border-t pt-3">
      <h3 className="mb-2 text-xs font-medium">Agent lineage</h3>
      <ul className="max-h-64 overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable]">
        {branch(root)}
      </ul>
      {childRows.length > 0 && (
        <Button size="sm" variant="ghost" onClick={onManageAgents}>
          Manage agents
        </Button>
      )}
    </section>
  )
}
