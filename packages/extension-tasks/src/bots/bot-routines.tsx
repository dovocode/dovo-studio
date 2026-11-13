import { formatDateTime, useStudioHost, useWorkspace } from '@dovo/studio-core'
import { botRoutines, botRunStatusLabels, botWorkInbox } from '@dovo/protocol'
import { Button } from '@dovo/studio-ui'

/** Run links use the normal automation history, with its owning computer intact. */
export function BotRoutines({ taskId }: { taskId: string }) {
  const { workspace, snapshot, activeRuntimeId } = useWorkspace()
  const host = useStudioHost()
  const routines = botRoutines(taskId, workspace.automations, snapshot?.runs ?? [])
  const task = workspace.tasks.find((t) => t.id === taskId)
  const inbox = task
    ? botWorkInbox(
        task,
        workspace.tasks,
        workspace.automations,
        snapshot?.runs ?? [],
        [...(snapshot?.approvals ?? []), ...(snapshot?.questions ?? [])].map(
          (input) => input.taskId,
        ),
      )
    : []
  const open = (automationId: string, runId?: string) =>
    host.navigate({
      viewId: 'jobs',
      entityId: runId ?? automationId,
      ...(activeRuntimeId
        ? { automationTarget: { runtimeId: activeRuntimeId, automationId, runId } }
        : {}),
    })
  return (
    <section className="grid gap-3" aria-label="Routines">
      <h2 className="font-semibold">Work inbox</h2>
      <p className="text-xs text-muted-foreground">
        Work runs in isolated workers. Your conversation stays available. Review requests and
        failures appear first.
      </p>
      {inbox.length ? (
        inbox.map((item) => (
          <Button
            key={item.key}
            variant="outline"
            size="sm"
            className="h-auto justify-start whitespace-normal text-left"
            onClick={() =>
              item.taskId
                ? host.navigate({
                    viewId: 'tasks',
                    entityId: item.taskId,
                  })
                : item.automationId && open(item.automationId, item.runId)
            }
          >
            {item.title} · {item.status}
          </Button>
        ))
      ) : (
        <p className="text-xs text-muted-foreground">No work yet.</p>
      )}
      <h2 className="font-semibold">Routines</h2>
      {routines.map(({ flow: routine, runs, triggers, steps }) => {
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
            <p className="text-xs text-muted-foreground">
              {triggers.join(' · ') || 'No trigger configured'}
            </p>
            <ul aria-label={`${routine.name} steps`} className="grid gap-1 text-xs">
              {steps.map((step) => (
                <li key={step.id}>
                  {step.label} ·{' '}
                  {step.botJob
                    ? 'This Bot'
                    : step.review
                      ? 'Human review'
                      : step.botId
                        ? 'Bot job'
                        : 'Agent task'}
                </li>
              ))}
            </ul>
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
                {formatDateTime(run.createdAt)} · {botRunStatusLabels[run.status]}
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
          No routines target this Bot. In Automations, target this Bot from a task step to run
          isolated work and report back.
        </p>
      )}
      <Button variant="outline" size="sm" onClick={() => host.navigate({ viewId: 'jobs' })}>
        Manage routines
      </Button>
    </section>
  )
}
