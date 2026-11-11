import { useHarnessHandoff } from '@dovo/studio-core/harness-handoff'
import { providers, responses, useWorkspace, type Task } from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'

export function useInlineHarnessHandoff(task: Task, enabled = true) {
  const { request, flush, snapshot, connected, activeRuntimeId, connection } = useWorkspace()
  const handoff = useHarnessHandoff({
    task,
    scope: JSON.stringify([activeRuntimeId, connection]),
    supported: enabled && snapshot?.threadHandoffsSupported === true,
    connected,
    request: async (input) => {
      await flush()
      return request('/api/tasks/continue-harness', input, responses.ok)
    },
  })
  return {
    ...handoff,
    notice: (
      <>
        {handoff.pending && (
          <div className="w-full space-y-2 rounded-lg border bg-muted/30 p-3 text-xs" role="status">
            <p>
              Continue with {providers[handoff.pending.provider]?.short ?? handoff.pending.provider}
              . Your saved conversation stays in this thread.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={!connected || handoff.busy}
                onClick={() => void handoff.confirm()}
              >
                {handoff.busy
                  ? 'Switching…'
                  : task.status === 'running'
                    ? 'Stop and switch harness'
                    : 'Retry harness switch'}
              </Button>
              <Button size="sm" variant="ghost" disabled={handoff.busy} onClick={handoff.cancel}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        {handoff.error && (
          <p role="alert" className="w-full text-xs text-destructive">
            {handoff.error}
          </p>
        )}
        {handoff.notice && (
          <p role="status" className="w-full text-xs text-muted-foreground">
            {handoff.notice}
          </p>
        )}
      </>
    ),
  }
}
