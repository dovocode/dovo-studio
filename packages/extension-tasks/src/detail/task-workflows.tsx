import { taskWorkflows, workflowStateLabel, type Subagent, type TaskMetadata } from '@dovo/protocol'
import { useStudioHost, useWorkspace } from '@dovo/studio-core'
import { ChevronRight, Workflow } from 'lucide-react'

export function TaskWorkflows({
  task,
  onOpenThread,
}: {
  task: TaskMetadata
  onOpenThread: (thread: { taskId: string; agent: Subagent }) => void
}) {
  const { workspace, connected, activeRuntimeId } = useWorkspace()
  const host = useStudioHost()
  const workflows = taskWorkflows(task, workspace.tasks)
  if (!workflows.length) return null
  return (
    <div className="space-y-3 px-4 pt-4" aria-label="Workflows">
      {workflows.map((workflow) => (
        <section
          key={workflow.id}
          className="rounded-xl border p-3"
          aria-label={`Workflow: ${workflow.name}`}
        >
          <div className="flex items-start gap-2">
            <Workflow className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <h2 className="min-w-0 flex-1 break-words text-sm font-medium">{workflow.name}</h2>
            <span className="shrink-0 text-xs text-muted-foreground" role="status">
              {!connected && workflow.state === 'working'
                ? 'Last seen working'
                : workflowStateLabel[workflow.state]}
            </span>
          </div>
          {workflow.description && (
            <p className="mt-2 whitespace-pre-wrap break-words text-xs text-muted-foreground">
              {workflow.description}
            </p>
          )}
          <ol className="mt-3 space-y-3">
            {workflow.phases.map((phase, index) => (
              <li key={phase.id}>
                <div className="flex items-start gap-2 text-xs">
                  <span className="text-muted-foreground">{index + 1}.</span>
                  <h3 className="min-w-0 flex-1 break-words font-medium">{phase.title}</h3>
                  <span className="text-muted-foreground">
                    {!connected && phase.state === 'working'
                      ? 'Last seen working'
                      : workflowStateLabel[phase.state]}
                  </span>
                </div>
                {!phase.members.length && (
                  <p className="ml-4 mt-1 text-xs text-muted-foreground">No agents assigned yet.</p>
                )}
                {phase.members.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    className="mt-1 flex w-full items-start gap-2 rounded-lg p-2 text-left hover:bg-muted/50 disabled:cursor-default"
                    disabled={member.taskId ? !host.openThread : !member.agent}
                    onClick={() => {
                      if (member.taskId)
                        host.openThread?.({
                          runtimeId:
                            member.runtimeId === 'local'
                              ? activeRuntimeId
                              : (member.runtimeId ?? activeRuntimeId),
                          threadId: member.taskId,
                          title: member.name,
                          parent: {
                            runtimeId: activeRuntimeId,
                            threadId: task.id,
                            title: task.title,
                          },
                        })
                      else if (member.agent) onOpenThread({ taskId: task.id, agent: member.agent })
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-xs font-medium">{member.name}</p>
                      <p className="mt-0.5 text-[0.6875rem] text-muted-foreground">
                        {[
                          member.provider,
                          !connected && member.state === 'working'
                            ? 'Last seen working'
                            : workflowStateLabel[member.state],
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                      {(member.result || member.activity) && (
                        <p className="mt-1 line-clamp-2 break-words text-xs text-muted-foreground">
                          {member.result || member.activity}
                        </p>
                      )}
                    </div>
                    <ChevronRight className="mt-1 size-3 shrink-0 text-muted-foreground" />
                  </button>
                ))}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  )
}
