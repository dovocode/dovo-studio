import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect } from 'react'
import { subagentElapsed, subagentMetadata } from '@dovo/studio-core'
import { type Task, useWorkspace } from '@dovo/studio-core'
import { Bot, ChevronRight } from 'lucide-react'
import { cn } from '@dovo/studio-ui'
export function TaskAgents({ task }: { task: Task }) {
  const { connected } = useWorkspace()
  const [now, setNow] = useApplicationState(Date.now)
  const agents = task.subagents ?? []
  const live = connected && task.status === 'running'
  const working = live ? agents.filter((agent) => agent.status === 'working').length : 0
  useEffect(() => {
    if (!working) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [working])
  return (
    <section className="flex min-h-full flex-col" aria-label="Subagents">
      <div className="px-4 py-4 text-[0.625rem] uppercase tracking-wider text-muted-foreground">
        Spawned agents
      </div>
      {!agents.length && (
        <div className="px-4 py-8 text-center text-xs text-muted-foreground">
          <Bot className="mx-auto mb-3 size-5" />
          No subagents yet.
          <p className="mt-2">Agents spawned by a supported harness appear here as they work.</p>
        </div>
      )}
      <div className="flex-1 px-2">
        {agents.map((agent) => {
          const active = live && agent.status === 'working'
          const state =
            !live && agent.status === 'working'
              ? 'Last seen working'
              : agent.status === 'unknown'
                ? 'Status unavailable'
                : agent.status
          return (
            <details
              key={`${agent.provider}:${agent.id}`}
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
                <p className="text-[0.625rem]">{agent.id}</p>
              </div>
            </details>
          )
        })}
      </div>
      <footer className="sticky bottom-0 mt-4 flex gap-3 border-t bg-background px-4 py-3 text-[0.6875rem] text-muted-foreground">
        <span className={working ? 'text-blue-400' : ''}>{working} working</span>
        <span>{agents.length} total</span>
        {!connected && <span className="ml-auto">Offline · saved state</span>}
      </footer>
    </section>
  )
}
