import { botWorkSummary, type TaskMetadata } from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'

export function BotWorkSummary({
  task,
  onRoutines,
  onWorkers,
}: {
  task: TaskMetadata
  onRoutines: () => void
  onWorkers: () => void
}) {
  const { workspace, snapshot, connected } = useWorkspace()
  const work = botWorkSummary(task, workspace.tasks, workspace.automations, snapshot?.runs ?? [])
  return (
    <section
      aria-label="Bot work overview"
      className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-muted/20 px-4 py-2 text-xs"
    >
      <span className="font-medium">{connected ? 'Bot work' : 'Bot work · Last saved state'}</span>
      <Button variant="outline" size="sm" onClick={onRoutines}>
        Routines · {work.routines}
        {work.running ? ` · ${work.running} working` : ''}
        {work.review ? ` · ${work.review} need review` : ''}
        {work.failed ? ` · ${work.failed} failed` : ''}
      </Button>
      <Button variant="outline" size="sm" onClick={onWorkers}>
        Workers · {work.workers} active
        {work.offlineWorkers ? ` · ${work.offlineWorkers} offline` : ''}
      </Button>
      {!work.routines && !work.workers && (
        <span className="text-muted-foreground">
          Ask this Bot to set up a routine or delegate a task.
        </span>
      )}
    </section>
  )
}
