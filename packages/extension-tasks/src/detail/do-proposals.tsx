import { useEffect, useState } from 'react'
import { DO_CHAT_ORIGIN, doChatPlansReplySchema, type DoRun, type Task } from '@dovo/protocol'
import { useStudioHost, useWorkspace } from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'

/** Proposals stay attached to the ordinary conversation that owns them. */
export function DoProposals({ task, active }: { task: Task; active: boolean }) {
  const { runtimeRegistry, readRuntime, connected } = useWorkspace()
  const profile = runtimeRegistry.profiles.find((entry) => entry.id === runtimeRegistry.activeId)
  if (task.origin !== DO_CHAT_ORIGIN || !profile) return null
  return (
    <ProposalList
      key={JSON.stringify([task.id, profile.connection])}
      taskId={task.id}
      profile={profile}
      active={active && connected}
      readRuntime={readRuntime}
    />
  )
}

function ProposalList({
  taskId,
  profile,
  active,
  readRuntime,
}: {
  taskId: string
  profile: NonNullable<ReturnType<typeof useWorkspace>['runtimeRegistry']['profiles'][number]>
  active: boolean
  readRuntime: ReturnType<typeof useWorkspace>['readRuntime']
}) {
  const host = useStudioHost()
  const [runs, setRuns] = useState<DoRun[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    if (!active) return
    let alive = true
    let busy = false
    const load = async () => {
      if (busy) return
      busy = true
      try {
        const result = await readRuntime(
          profile,
          '/api/do/chat/plans',
          { taskId },
          doChatPlansReplySchema,
        )
        if (alive) {
          setRuns(result.runs)
          setError('')
        }
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        busy = false
      }
    }
    void load()
    const timer = setInterval(() => void load(), 3000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [active, taskId, profile, readRuntime])
  if (!runs.length && !error) return null
  return (
    <aside
      aria-label="Do proposals"
      className="max-h-48 shrink-0 overflow-auto border-b bg-muted/20 px-4 py-2"
    >
      {error && (
        <p role="alert" className="text-xs text-destructive">
          Could not refresh proposals: {error}
        </p>
      )}
      {runs.map((run) => (
        <div key={run.id} className="flex items-center justify-between gap-3 py-1">
          <div className="min-w-0 text-sm">
            <p className="truncate font-medium">{run.title}</p>
            <p className="text-xs text-muted-foreground">
              {run.status === 'draft' ? 'Proposed · waiting for your review' : run.status} ·{' '}
              {run.items.filter((item) => item.state.status === 'completed').length}/
              {run.items.length} finished
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => host.navigate({ viewId: 'do', entityId: run.id })}
          >
            {run.status === 'draft' ? 'Review proposal' : 'View work'}
          </Button>
        </div>
      ))}
    </aside>
  )
}
