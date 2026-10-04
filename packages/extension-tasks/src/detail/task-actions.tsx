import { useApplicationState } from '@dovo/studio-core/state'
import { TaskLifecycleActions } from './task-lifecycle-actions'
import { Ellipsis, GitPullRequest, Minimize2, Pin } from 'lucide-react'
import {
  readAppPreferences,
  responses,
  updateTask,
  useWorkspace,
  type Task,
} from '@dovo/studio-core'
import { IconButton, Popover } from '@dovo/studio-ui'
export function TaskActions({ task, onLinkPull }: { task: Task; onLinkPull?: () => void }) {
  const { setWorkspace, request, connected } = useWorkspace(),
    [actionsOpen, setActionsOpen] = useApplicationState(false),
    [compactBusy, setCompactBusy] = useApplicationState(false),
    [compactError, setCompactError] = useApplicationState('')
  const compact = () => {
    if (compactBusy) return
    setCompactBusy(true)
    setCompactError('')
    void request('/api/tasks/compact', { id: task.id }, responses.ok)
      .then(() => setActionsOpen(false))
      .catch((cause: unknown) =>
        setCompactError(cause instanceof Error ? cause.message : String(cause)),
      )
      .finally(() => setCompactBusy(false))
  }
  return (
    <>
      <Popover.Root open={actionsOpen} onOpenChange={setActionsOpen}>
        <Popover.Trigger asChild>
          <IconButton label="Task actions" className="size-8">
            <Ellipsis size={16} />
          </IconButton>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="end"
            sideOffset={8}
            className="z-50 flex flex-col gap-1 rounded-lg border bg-popover p-2 shadow-lg"
            aria-label="Task actions"
          >
            <div className="flex items-center gap-2">
              <IconButton
                label={task.pinned ? 'Unpin task' : 'Pin task'}
                aria-pressed={!!task.pinned}
                className="size-7"
                onClick={() => {
                  if (
                    task.pinned &&
                    readAppPreferences().confirmUnpin &&
                    !window.confirm(`Unpin “${task.title}”?`)
                  )
                    return
                  setWorkspace((w) => updateTask(w, task.id, (t) => ({ ...t, pinned: !t.pinned })))
                }}
              >
                <Pin size={13} />
              </IconButton>
              {!!task.sessionId && !task.archived && (
                <IconButton
                  label="Compact agent context"
                  title="Summarize older agent context"
                  className="size-7"
                  disabled={
                    !connected || task.status === 'running' || !!task.queue?.length || compactBusy
                  }
                  onClick={compact}
                >
                  <Minimize2 size={13} />
                </IconButton>
              )}
              <TaskLifecycleActions task={task} />
              {onLinkPull && (
                <IconButton
                  label="Manage linked pull requests"
                  className="size-7"
                  onClick={() => {
                    setActionsOpen(false)
                    onLinkPull()
                  }}
                >
                  <GitPullRequest size={13} />
                </IconButton>
              )}
            </div>
            {compactError && (
              <p role="alert" className="max-w-64 text-xs text-destructive">
                {compactError}
              </p>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </>
  )
}
