import { useLayoutEffect, useRef, useState } from 'react'
import { MessageSquarePlus } from 'lucide-react'
import { conversationPageSchema, createRuntimeClient, threadContextSnapshot } from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@dovo/studio-ui'

export function ThreadContextPicker({
  taskId,
  disabled,
  attachmentBusy = false,
  upload,
  showLabel = false,
}: {
  taskId: string
  disabled: boolean
  attachmentBusy?: boolean
  upload: (files: File[], signal: AbortSignal) => Promise<void>
  showLabel?: boolean
}) {
  const { workspace, connection, connected } = useWorkspace()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const operation = useRef<AbortController | null>(null)
  useLayoutEffect(
    () => () => {
      operation.current?.abort()
    },
    [connection, taskId, disabled],
  )
  const attach = async (source: (typeof workspace.tasks)[number]) => {
    if (!connection || !connected || operation.current) return
    const controller = new AbortController()
    operation.current = controller
    setBusy(true)
    setError('')
    try {
      const client = createRuntimeClient(connection)
      const snapshot = await threadContextSnapshot(
        source,
        (before, signal) =>
          client.request('/api/tasks/history', { id: source.id, before }, conversationPageSchema, {
            method: 'POST',
            signal,
          }),
        controller.signal,
      )
      if (controller.signal.aborted) return
      await upload(
        [new File([snapshot.text], snapshot.name, { type: 'text/markdown' })],
        controller.signal,
      )
      if (!controller.signal.aborted) setOpen(false)
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (operation.current === controller) {
        operation.current = null
        setBusy(false)
      }
    }
  }
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size={showLabel ? 'default' : 'icon'}
        className={
          showLabel ? 'h-10 w-full justify-start gap-2 px-3 text-sm font-normal' : 'size-7'
        }
        aria-label="Attach thread context"
        disabled={disabled || attachmentBusy || !connected}
        onClick={() => {
          setError('')
          setOpen(true)
        }}
      >
        <MessageSquarePlus className="size-3.5" />
        {showLabel && 'Attach thread context'}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) operation.current?.abort()
          setOpen(next)
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogTitle>Attach thread context</DialogTitle>
          <DialogDescription>
            Attach a snapshot from this computer, up to 5 MB. Review it before sending; existing
            attachments are listed by name only.
          </DialogDescription>
          <input
            aria-label="Search threads"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-full rounded border bg-background p-2 text-sm"
          />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="max-h-72 overflow-y-auto">
            {workspace.tasks
              .filter(
                (task) =>
                  task.id !== taskId &&
                  !task.example &&
                  task.title.toLowerCase().includes(query.toLowerCase()),
              )
              .map((task) => (
                <Button
                  key={task.id}
                  type="button"
                  variant="ghost"
                  className="w-full justify-start"
                  disabled={busy || disabled || attachmentBusy || !connected}
                  onClick={() => void attach(task)}
                >
                  {task.title || 'Untitled thread'}
                </Button>
              ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
