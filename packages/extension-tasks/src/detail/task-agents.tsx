import {
  buildThreadTree,
  nativeFailureKey,
  threadFailureKey,
  taskFailureVersion,
  subagentVisible,
  taskFamilyIds,
  threadDescendants,
  unlistedThreadBranches,
  visibleThreadChildren,
  workspacePatchResultSchema,
} from '@dovo/protocol'
import { taskRowPatch } from '../list/task-row-actions'
import { NestedThreads } from '../list/nested-threads'
import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect, useMemo } from 'react'
import { subagentElapsed, subagentMetadata } from '@dovo/studio-core'
import {
  type Task,
  useWorkspace,
  useAppPreferences,
  updateAppPreferences,
  responses,
} from '@dovo/studio-core'
import { Bot, ChevronRight } from 'lucide-react'
import { useStudioHost } from '@dovo/studio-core'
import { Button, Toggle, cn } from '@dovo/studio-ui'
import { indexTaskSubagents, taskFamilyRunToken } from '@dovo/protocol'
import type { Subagent } from '@dovo/protocol'
export function TaskAgents({
  task,
  onOpenThread,
}: {
  task: Task
  onOpenThread: (thread: { taskId: string; agent: Subagent }) => void
}) {
  const host = useStudioHost()
  const { connected, workspace, request, snapshot, activeRuntimeId } = useWorkspace()
  const { hideFinishedSubagents } = useAppPreferences()
  const [stopping, setStopping] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const completeChild = async (child: Task) => {
    setStopping(true)
    setError('')
    try {
      await request(
        '/api/workspace',
        taskRowPatch(child, { archived: !child.archived, snoozedUntil: null }),
        workspacePatchResultSchema,
        'PATCH',
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setStopping(false)
    }
  }
  const stopAgents = async (target = task, stopTurn = false, childId?: string) => {
    setStopping(true)
    setError('')
    try {
      await request(
        stopTurn ? '/api/tasks/cancel' : '/api/tasks/stop-agents',
        stopTurn
          ? { id: target.id, runId: target.activeRunId }
          : { id: target.id, runToken: taskFamilyRunToken(workspace.tasks, target.id), childId },
        responses.ok,
      )
    } catch (error) {
      setError(String(error))
    } finally {
      setStopping(false)
    }
  }
  const [now, setNow] = useApplicationState(Date.now)
  const indexed = useMemo(() => indexTaskSubagents(workspace.tasks), [workspace.tasks])
  const tree = useMemo(
    () =>
      buildThreadTree(
        workspace.tasks.map((item) => {
          const repository = workspace.repositories.find(
            (repository) => repository.id === item.repositoryId,
          )
          return {
            key: JSON.stringify([activeRuntimeId, item.id]),
            task: item,
            needsInput: false,
            projectName:
              repository?.kind === 'scratch' ? 'No Project' : (repository?.name ?? 'No Project'),
            source: {
              runtimeId: activeRuntimeId,
              name: 'This computer',
              online: connected,
              snapshot,
            },
          }
        }),
      ),
    [workspace.tasks, workspace.repositories, snapshot, activeRuntimeId, connected],
  )
  const thread = tree.nodes.get(JSON.stringify([activeRuntimeId, task.id]))
  const agents = indexed(task)
  const listed = new Set(
    [
      task.id,
      ...agents.filter((agent) => agent.source === 'dovo').map((agent) => agent.taskId ?? agent.id),
    ].map((id) => JSON.stringify([activeRuntimeId, id])),
  )
  const branches = thread ? unlistedThreadBranches(thread, listed) : []
  const remote = branches.flatMap((branch) => threadDescendants(branch.children))
  const visibleBranches = branches.map((branch) => ({
    ...branch,
    children: visibleThreadChildren(
      branch.children,
      hideFinishedSubagents,
      task.acknowledgedSubagentFailures,
    ),
  }))
  const visibleRemote = visibleBranches.flatMap((branch) => threadDescendants(branch.children))
  const ownerFor = (agent: Subagent) =>
    workspace.tasks.find((item) => item.subagents?.includes(agent))
  const failureKey = (agent: Subagent) => {
    const child =
      agent.source === 'dovo'
        ? workspace.tasks.find((item) => item.id === (agent.taskId ?? agent.id))
        : undefined
    return child
      ? threadFailureKey(
          snapshot?.runtimeId ?? activeRuntimeId,
          child.id,
          taskFailureVersion(child),
        )
      : nativeFailureKey(ownerFor(agent)?.id ?? task.id, agent)
  }
  const visibleAgents = agents.filter((agent) =>
    subagentVisible(
      agent,
      hideFinishedSubagents,
      task.acknowledgedSubagentFailures?.includes(failureKey(agent)),
    ),
  )
  const hidden = agents.length - visibleAgents.length + remote.length - visibleRemote.length
  const activeAgents = new Set(connected ? indexed(task, true) : [])
  const family = taskFamilyIds(workspace.tasks, task.id)
  const canStopRemote =
    connected &&
    workspace.tasks.some(
      (item) =>
        family.has(item.id) &&
        item.threadWatches?.some(
          (watch) =>
            watch.delegated && !watch.stopRequested && watch.snapshot?.phase !== 'completed',
        ),
    )
  const acknowledgeFailure = async (key: string) => {
    setStopping(true)
    setError('')
    try {
      await request('/api/tasks/acknowledge-subagent-failure', { id: task.id, key }, responses.ok)
    } catch (error) {
      setError(String(error))
    } finally {
      setStopping(false)
    }
  }
  const live = connected
  const working =
    activeAgents.size +
    remote.filter((child) => child.online && !child.paused && child.phase === 'running').length
  useEffect(() => {
    if (!working) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [working])
  return (
    <section className="flex min-h-full flex-col" aria-label="Subagents">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 text-muted-foreground">
        <span className="text-[0.625rem] uppercase tracking-wider">Spawned agents</span>
        <div className="flex items-center gap-2 text-xs">
          <span>Hide finished</span>
          <Toggle
            label="Hide finished"
            checked={hideFinishedSubagents}
            onChange={(hideFinishedSubagents) => updateAppPreferences({ hideFinishedSubagents })}
          />
        </div>
      </div>
      {(activeAgents.size > 0 || canStopRemote) && (
        <Button
          className="mx-4 mb-3"
          variant="outline"
          size="sm"
          disabled={stopping}
          onClick={() => stopAgents()}
        >
          {stopping ? 'Stopping…' : 'Stop agents'}
        </Button>
      )}
      {error && (
        <p role="alert" className="mx-4 mb-3 text-xs text-destructive">
          {error}
        </p>
      )}
      {!agents.length && !remote.length && (
        <div className="px-4 py-8 text-center text-xs text-muted-foreground">
          <Bot className="mx-auto mb-3 size-5" />
          No subagents yet.
          <p className="mt-2">Agents spawned by a supported harness appear here as they work.</p>
        </div>
      )}
      {(!!agents.length || !!remote.length) && !visibleAgents.length && !visibleRemote.length && (
        <p className="px-4 py-8 text-center text-xs text-muted-foreground">
          All subagents have finished. Turn off Hide finished to view them.
        </p>
      )}
      <div className="flex-1 px-2">
        {visibleBranches.map((branch) => (
          <NestedThreads
            key={branch.key}
            threads={branch.children}
            parent={branch}
            acknowledgedFailures={task.acknowledgedSubagentFailures}
            onAcknowledgeFailure={acknowledgeFailure}
          />
        ))}
        {visibleAgents.map((agent, index) => {
          const active = live && activeAgents.has(agent)
          const childId = agent.source === 'dovo' ? (agent.taskId ?? agent.id) : undefined
          const child = childId ? workspace.tasks.find((item) => item.id === childId) : undefined
          const owner = workspace.tasks.find((item) => item.subagents?.includes(agent))
          const state =
            !active && agent.status === 'working'
              ? 'Last seen working'
              : agent.status === 'unknown'
                ? 'Status unavailable'
                : agent.status
          return (
            <details
              key={`${agent.provider}:${agent.id}:${index}`}
              className="group rounded-lg px-2 py-2 hover:bg-muted/30"
            >
              <summary className="flex cursor-pointer list-none items-start gap-2">
                <span
                  className={cn(
                    'mt-1.5 size-1.5 shrink-0 rounded-full',
                    active
                      ? 'bg-blue-400'
                      : agent.status === 'failed'
                        ? 'bg-destructive'
                        : 'bg-muted-foreground/40',
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-xs font-medium" title={agent.name}>
                      {agent.name}
                    </span>
                    <span className="ml-auto shrink-0 text-[0.625rem] tabular-nums text-muted-foreground">
                      {subagentElapsed(
                        active
                          ? agent
                          : {
                              ...agent,
                              status: agent.status === 'working' ? 'unknown' : agent.status,
                            },
                        now,
                      )}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-[0.6875rem] text-muted-foreground">
                    {active ? agent.activity || 'Working' : state}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-[0.625rem] text-muted-foreground/70">
                    {subagentMetadata(agent) || agent.provider}
                  </p>
                </div>
                <ChevronRight className="mt-0.5 size-3 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
              </summary>
              <div className="ml-3.5 mt-3 space-y-2 break-words text-xs text-muted-foreground">
                {agent.status === 'failed' &&
                  !task.acknowledgedSubagentFailures?.includes(failureKey(agent)) && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={stopping}
                      onClick={() => acknowledgeFailure(failureKey(agent))}
                    >
                      Acknowledge failure
                    </Button>
                  )}
                {agent.prompt && <p className="whitespace-pre-wrap">{agent.prompt}</p>}
                {agent.result && <p className="whitespace-pre-wrap">{agent.result}</p>}
                {agent.activity && <p className="whitespace-pre-wrap">{agent.activity}</p>}
                {childId && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => host.navigate({ viewId: 'tasks', entityId: childId })}
                  >
                    Open child thread · {agent.provider}
                  </Button>
                )}
                {child && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      !connected ||
                      stopping ||
                      !!child.activeRunId ||
                      child.status === 'running' ||
                      indexed(child, true).length > 0
                    }
                    onClick={() => void completeChild(child)}
                  >
                    {child.archived ? 'Reopen child' : 'Mark completed'}
                  </Button>
                )}
                {agent.source !== 'dovo' && owner && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onOpenThread({ taskId: owner.id, agent })}
                  >
                    View native thread · {agent.provider}
                  </Button>
                )}
                {active &&
                  agent.source !== 'dovo' &&
                  agent.canStopIndividual !== false &&
                  owner && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={stopping}
                      onClick={() => stopAgents(owner, false, agent.id)}
                    >
                      Stop child
                    </Button>
                  )}
                {active && child?.activeRunId && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={stopping}
                    onClick={() => stopAgents(child, true)}
                  >
                    Stop child
                  </Button>
                )}
                <p className="text-[0.625rem]">
                  {agent.source === 'dovo' ? 'Dovo child agent' : agent.id}
                </p>
              </div>
            </details>
          )
        })}
      </div>
      <footer className="sticky bottom-0 mt-4 flex gap-3 border-t bg-background px-4 py-3 text-[0.6875rem] text-muted-foreground">
        <span className={working ? 'text-blue-400' : ''}>{working} working</span>
        <span>{agents.length + remote.length} total</span>
        {hidden > 0 && <span>{hidden} hidden</span>}
        {!connected && <span className="ml-auto">Offline · saved state</span>}
      </footer>
    </section>
  )
}
