import { TaskLifecycleActions } from './task-lifecycle-actions'
import { useState } from 'react'
import { Ellipsis, Pin, Settings2 } from 'lucide-react'
import { updateTask, useWorkspace, type Task } from '@dovo/studio-core'
import { IconButton, Popover } from '@dovo/studio-ui'
import { TaskSettings } from './task-settings'
export function TaskActions({ task }: { task: Task }) {
  const { setWorkspace } = useWorkspace(),
    [settings, setSettings] = useState(false),
    [actionsOpen, setActionsOpen] = useState(false)
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
            className="z-50 flex items-center gap-2 rounded-lg border bg-popover p-2 shadow-lg"
            aria-label="Task actions"
          >
            <IconButton
              label={task.pinned ? 'Unpin task' : 'Pin task'}
              aria-pressed={!!task.pinned}
              className="size-7"
              onClick={() =>
                setWorkspace((w) => updateTask(w, task.id, (t) => ({ ...t, pinned: !t.pinned })))
              }
            >
              <Pin size={13} />
            </IconButton>
            <TaskLifecycleActions task={task} />
            <IconButton
              label="Task settings"
              className="size-7"
              onClick={() => {
                setActionsOpen(false)
                setSettings(true)
              }}
            >
              <Settings2 size={13} />
            </IconButton>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {settings && <TaskSettings task={task} open={settings} onOpenChange={setSettings} />}
    </>
  )
}
