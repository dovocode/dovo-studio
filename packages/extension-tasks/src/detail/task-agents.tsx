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
export function TaskAgents({ task }: { task: Task }) {
  const host = useStudioHost()
  const { connected, workspace, request } = useWorkspace()
  const { hideFinishedSubagents } = useAppPreferences()
  const [stopping, setStopping] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const stopAgents = async (target = task, stopTurn = false) => {
    setStopping(true)
    setError('')
    try {
      await request(
        stopTurn ? '/api/tasks/cancel' : '/api/tasks/stop-agents',
        stopTurn
          ? { id: target.id, runId: target.activeRunId }
          : { id: target.id, runToken: taskFamilyRunToken(workspace.tasks, target.id) },
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
  const agents = indexed(task)
  const visibleAgents = agents.filter(
    (agent) =>
      !hideFinishedSubagents ||
      (!agent.finishedAt && (agent.status === 'working' || agent.status === 'unknown')),
  )
  const hidden = agents.length - visibleAgents.length
  const activeAgents = new Set(connected ? indexed(task, true) : [])
  const live = connected
  const working = activeAgents.size
  useEffect(() => {
    if (!working) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [working])
  return (
    <section className="flex min-h-full flex-col" aria-label="Subagents">
      {task.delegation && (
        <Button
          variant="ghost"
          className="mx-4 mt-3"
          onClick={() =>
            host.navigate({ viewId: 'tasks', entityId: task.delegation?.parentTaskId })
          }
        >
          Back to parent thread
        </Button>
      )}
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
      {[...activeAgents].some((agent) => agent.source === 'dovo') && (
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
      {!agents.length && (
        <div className="px-4 py-8 text-center text-xs text-muted-foreground">
          <Bot className="mx-auto mb-3 size-5" />
          No subagents yet.
          <p className="mt-2">Agents spawned by a supported harness appear here as they work.</p>
        </div>
      )}
      {!!agents.length && !visibleAgents.length && (
        <p className="px-4 py-8 text-center text-xs text-muted-foreground">
          All subagents have finished. Turn off Hide finished to view them.
        </p>
      )}
      <div className="flex-1 px-2">
        {visibleAgents.map((agent, index) => {
          const active = live && activeAgents.has(agent)
          const childId = agent.source === 'dovo' ? (agent.taskId ?? agent.id) : undefined
          const child = childId ? workspace.tasks.find((item) => item.id === childId) : undefined
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
                {agent.prompt && <p className="whitespace-pre-wrap">{agent.prompt}</p>}
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
        <span>{agents.length} total</span>
        {hidden > 0 && <span>{hidden} hidden</span>}
        {!connected && <span className="ml-auto">Offline · saved state</span>}
      </footer>
    </section>
  )
}
