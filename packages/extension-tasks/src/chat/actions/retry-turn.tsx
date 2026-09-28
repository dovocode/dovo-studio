import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { resolveTaskAgent } from '@dovo/protocol'
import { responses, useWorkspace, type TaskHarness } from '@dovo/studio-core'
import { Button, DropdownMenu } from '@dovo/studio-ui'
import { useHarnessCatalog } from '../composer/harness-catalog'

const item =
  'flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs outline-none transition-colors duration-150 data-[disabled]:opacity-50 data-[highlighted]:bg-accent/55 motion-reduce:transition-none'

/** Runs the latest request again, with the same or another model of the task's provider.
 * The previous attempt's file changes are undone first. */
export function RetryTurn({ taskId, turnId }: { taskId: string; turnId: string }) {
  const { workspace, request, connected } = useWorkspace()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const task = workspace.tasks.find((entry) => entry.id === taskId)
  const agent = task ? resolveTaskAgent(task, workspace.agents) : undefined
  const harness = (agent ?? {
    provider: 'codex',
    model: '',
    reasoning: '',
    instructions: '',
    permission: 'ask',
    endpoint: '',
  }) as TaskHarness
  const { catalog, loading } = useHarnessCatalog(harness, open && !!agent)
  const retry = (model?: string) => {
    if (busy) return
    setBusy(true)
    setError('')
    void request(
      '/api/tasks/retry',
      { id: taskId, turnId, ...(model ? { model } : {}) },
      responses.ok,
    )
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false))
  }
  if (!agent) return null
  return (
    <>
      <DropdownMenu.Root open={open} onOpenChange={setOpen}>
        <DropdownMenu.Trigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Try again"
            title="Try again, with this or another model. This turn’s file changes are undone first."
            className="size-6 text-muted-foreground"
            disabled={!connected || busy}
          >
            <RotateCcw size={12} />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            sideOffset={4}
            align="start"
            className="z-50 max-h-80 min-w-56 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          >
            <DropdownMenu.Item className={item} onSelect={() => retry()}>
              Try again{agent.model ? ` with ${agent.model}` : ''}
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="my-1 h-px bg-border" />
            <DropdownMenu.Label className="px-2 py-1 text-[0.625rem] text-muted-foreground">
              Try with another {agent.provider} model
            </DropdownMenu.Label>
            {loading && (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">Loading models…</p>
            )}
            {catalog?.models
              .filter((model) => !model.hidden && model.id !== agent.model)
              .map((model) => (
                <DropdownMenu.Item key={model.id} className={item} onSelect={() => retry(model.id)}>
                  {model.name || model.id}
                </DropdownMenu.Item>
              ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {error && (
        <span role="alert" className="text-[0.625rem] text-destructive">
          {error}
        </span>
      )}
    </>
  )
}
