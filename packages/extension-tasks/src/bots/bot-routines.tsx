import { formatDateTime, useStudioHost, useWorkspace, type JobRun } from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'

const statusLabels = {
  running: 'Working',
  waiting: 'Needs review',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
} satisfies Record<JobRun['status'], string>

/** Run links use the normal automation history, with its owning computer intact. */
export function BotRoutines({ taskId }: { taskId: string }) {
  const { workspace, snapshot, activeRuntimeId } = useWorkspace()
  const host = useStudioHost()
  const routines = workspace.automations.filter((routine) =>
    routine.nodes.some((node) => node.data.kind === 'task' && node.data.botId === taskId),
  )
  const open = (automationId: string, runId?: string) =>
    host.navigate({
      viewId: 'jobs',
      entityId: runId ?? automationId,
      ...(activeRuntimeId
        ? { automationTarget: { runtimeId: activeRuntimeId, automationId, runId } }
        : {}),
    })
  return (
    <section className="grid gap-3" aria-label="Bot routines">
      <h2 className="font-semibold">Routines</h2>
      {routines.map((routine) => {
        const runs = (snapshot?.runs ?? [])
          .filter((run) => run.automationId === routine.id)
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        return (
          <div key={routine.id} className="grid min-w-0 gap-2 rounded-lg border p-3">
            <Button
              variant="ghost"
              size="sm"
              className="h-auto justify-start whitespace-normal text-left"
              onClick={() => open(routine.id)}
            >
              {routine.name}
            </Button>
            <p className="text-xs text-muted-foreground">
              {routine.enabled ? 'Triggers enabled' : 'Triggers disabled'}
            </p>
            {!runs.length && <p className="text-xs text-muted-foreground">No runs yet.</p>}
            {runs.slice(0, 3).map((run) => (
              <Button
                key={run.id}
                variant="ghost"
                size="sm"
                className="h-auto justify-start whitespace-normal text-left text-xs"
                aria-label={`Open ${routine.name} run ${formatDateTime(run.createdAt)}`}
                onClick={() => open(routine.id, run.id)}
              >
                {formatDateTime(run.createdAt)} · {statusLabels[run.status]}
              </Button>
            ))}
            {!!runs.length && (
              <Button variant="outline" size="sm" onClick={() => open(routine.id)}>
                View run history
              </Button>
            )}
          </div>
        )
      })}
      {!routines.length && (
        <p className="text-xs text-muted-foreground">
          No routines target this Bot. In Automations, target this Bot from a task step to send work
          into this thread.
        </p>
      )}
      <Button variant="outline" size="sm" onClick={() => host.navigate({ viewId: 'jobs' })}>
        Manage routines
      </Button>
    </section>
  )
}
