import { useEffect, useMemo, useState } from 'react'
import { checkpointFiles, sideThreadChangesResultSchema, type Task } from '@dovo/protocol'
import type { Schema } from 'effect'
import { useWorkspace } from '@dovo/studio-core'
import {
  Button,
  ChoicePicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  ErrorBoundary,
  FileBrowserTree,
} from '@dovo/studio-ui'
import { SavedFilePreview } from '../files/saved-file-preview'

type Changes = Schema.Schema.Type<typeof sideThreadChangesResultSchema>

export function ReviewSideThreadChangesButton({ task }: { task: Task }) {
  const { activeRuntimeId, connection } = useWorkspace()
  const scope = JSON.stringify([activeRuntimeId, connection?.address, connection?.token, task.id])
  const [openScope, setOpenScope] = useState('')
  useEffect(() => setOpenScope(''), [scope])
  if (!task.sideThread || task.sideThread.source === 'scratch') return null
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpenScope(scope)}>
        Review changes
      </Button>
      {openScope === scope && (
        <SideThreadChanges key={scope} taskId={task.id} onClose={() => setOpenScope('')} />
      )}
    </>
  )
}

/** A pinned, read-only comparison against the side chat's creation snapshot. */
export function SideThreadChanges({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const { request, connected, activeRuntimeId, connection } = useWorkspace()
  const scope = JSON.stringify([activeRuntimeId, connection?.address, connection?.token, taskId])
  const [attempt, setAttempt] = useState(0)
  const [selected, setSelected] = useState('')
  const [state, setState] = useState<{
    scope: string
    value?: Changes
    busy: boolean
    error: string
  }>({ scope, busy: false, error: '' })
  const current = state.scope === scope ? state : undefined
  useEffect(() => {
    if (!connected) return
    let active = true
    setState((previous) => ({
      scope,
      value: previous.scope === scope ? previous.value : undefined,
      busy: true,
      error: '',
    }))
    void request(
      '/api/tasks/side-thread/changes',
      { id: taskId },
      sideThreadChangesResultSchema,
    ).then(
      (value) => {
        if (active) setState({ scope, value, busy: false, error: '' })
      },
      (cause: unknown) => {
        if (active)
          setState((previous) => ({
            ...previous,
            busy: false,
            error: cause instanceof Error ? cause.message : String(cause),
          }))
      },
    )
    return () => {
      active = false
    }
  }, [request, connected, scope, taskId, attempt])
  const files = useMemo(
    () => (current?.value ? checkpointFiles(current.value) : []),
    [current?.value],
  )
  const treeFiles = useMemo(() => files.map((file) => ({ path: file.path })), [files])
  const file = files.find((item) => item.path === selected) ?? files[0]
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="flex h-[85dvh] max-w-7xl flex-col gap-0 overflow-hidden p-0">
        <div className="shrink-0 space-y-1 border-b px-4 py-3 pr-12">
          <DialogTitle className="text-sm">Side-chat changes</DialogTitle>
          <DialogDescription className="text-xs">
            Changes since this side chat started. Parent edits from its starting snapshot are
            excluded.
          </DialogDescription>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2 text-xs">
          <Button
            size="sm"
            variant="outline"
            disabled={!connected || !!current?.busy}
            onClick={() => setAttempt((value) => value + 1)}
          >
            {current?.busy ? 'Refreshing changes…' : 'Refresh changes'}
          </Button>
          {!connected && (
            <span className="text-muted-foreground">Connect to refresh these changes.</span>
          )}
          {!!current?.error && (
            <p role="alert" className="text-destructive">
              {current.error}
            </p>
          )}
        </div>
        {!current?.value ? (
          <p role="status" className="p-4 text-xs text-muted-foreground">
            {current?.busy ? 'Loading side-chat changes…' : 'No snapshot loaded.'}
          </p>
        ) : !files.length ? (
          <p className="p-4 text-xs text-muted-foreground">
            No changes since this side chat started.
          </p>
        ) : file ? (
          <>
            <div className="shrink-0 border-b px-3 py-2 md:hidden">
              <ChoicePicker
                aria-label="Side-chat changed file"
                value={file.path}
                onValueChange={setSelected}
              >
                {files.map((item) => (
                  <option key={item.path} value={item.path}>
                    {item.path}
                  </option>
                ))}
              </ChoicePicker>
            </div>
            <div className="flex min-h-0 min-w-0 flex-1">
              <aside
                aria-label="Side-chat files"
                className="hidden min-h-0 w-60 shrink-0 overflow-y-auto border-r bg-muted/10 p-2 md:block"
              >
                <FileBrowserTree
                  files={treeFiles}
                  selected={file.path}
                  onSelect={setSelected}
                  defaultExpandedDepth={1}
                />
              </aside>
              <div className="min-h-0 min-w-0 flex-1 overflow-auto">
                <ErrorBoundary key={JSON.stringify([scope, current.value.after, file.path])}>
                  <SavedFilePreview
                    file={file}
                    taskId={taskId}
                    sideThreadSnapshot={{
                      before: current.value.before,
                      after: current.value.after,
                    }}
                  />
                </ErrorBoundary>
              </div>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
