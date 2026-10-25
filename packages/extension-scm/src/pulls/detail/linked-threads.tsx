import { useEffect, useEffectEvent, useState } from 'react'
import { AddPullsToThread } from '../list/add-to-thread'
import type { PullSummary } from '@dovo/protocol'
import { pullLinkedTasks, runtimeComputerName, watchRuntimeSettled } from '@dovo/protocol'
import { useStudioHost, useWorkspace } from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'
import { MessageSquare } from 'lucide-react'

export function PullLinkedThreads({ pull }: { pull: PullSummary }) {
  const [linking, setLinking] = useState(false)
  const { runtimes, workspace, activeRuntimeId } = useWorkspace()
  const host = useStudioHost()
  const connections = JSON.stringify(runtimes.map((runtime) => runtime.profile.connection))
  const subscribe = useEffectEvent(() =>
    runtimes.map((runtime) => watchRuntimeSettled(runtime.profile.connection)),
  )
  useEffect(() => {
    const stops = subscribe()
    return () => stops.forEach((stop) => stop())
  }, [connections])
  const threads = runtimes.flatMap((runtime) =>
    pullLinkedTasks(
      (runtime.profile.id === activeRuntimeId ? workspace : runtime.snapshot?.workspace)?.tasks ??
        [],
      pull.url,
    ).map((task) => ({ task, runtime })),
  )
  return (
    <section aria-label="Linked Studio threads" className="mb-4 space-y-1 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-medium text-muted-foreground">
          Linked threads · {threads.length}
        </h2>
        <Button variant="ghost" size="sm" onClick={() => setLinking(true)}>
          Link thread
        </Button>
      </div>
      {!threads.length && (
        <p className="text-xs text-muted-foreground">
          Link an existing thread to continue working on this PR.
        </p>
      )}
      {linking && <AddPullsToThread pulls={[pull]} onClose={() => setLinking(false)} />}
      {threads.map(({ task, runtime }) => (
        <Button
          key={JSON.stringify([runtime.profile.id, task.id])}
          variant="ghost"
          size="sm"
          className="h-auto w-full justify-start gap-2 py-2 text-left"
          disabled={!host.openThread}
          onClick={() =>
            host.openThread?.({
              runtimeId: runtime.profile.id,
              threadId: task.id,
              title: task.title,
            })
          }
        >
          <MessageSquare className="size-4 shrink-0" />
          <span className="min-w-0">
            <span className="block truncate">{task.title}</span>
            <span className="block text-xs text-muted-foreground">
              {runtimeComputerName(runtime)}
              {runtime.connected ? '' : ' · Offline'}
            </span>
          </span>
        </Button>
      ))}
    </section>
  )
}
