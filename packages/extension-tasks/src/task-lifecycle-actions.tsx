import { Clock, Check, Undo2 } from 'lucide-react'
import { updateTask, useWorkspace, type Task } from '@dovo/studio-core'
import { Button, DropdownMenu } from '@dovo/studio-ui'
import { isSnoozed } from './task-priority'
export function TaskLifecycleActions({ task }: { task: Task }) {
  const { setWorkspace } = useWorkspace()
  const snooze = (until: string | null) =>
    setWorkspace((w) => updateTask(w, task.id, (t) => ({ ...t, snoozedUntil: until })))
  return (
    <>
      {!task.archived && (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6"
              aria-label="Snooze task"
              title="Snooze task"
            >
              <Clock className="size-3.5" />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              sideOffset={4}
              className="z-50 min-w-40 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
            >
              {[
                [1, 'For 1 hour'],
                [4, 'For 4 hours'],
                [24, 'Until tomorrow'],
              ].map(([hours, label]) => (
                <DropdownMenu.Item
                  key={hours}
                  className="rounded-sm px-2 py-1.5 text-xs outline-none transition-colors duration-150 data-[highlighted]:bg-accent/55 motion-reduce:transition-none"
                  onSelect={() =>
                    snooze(new Date(Date.now() + Number(hours) * 3600000).toISOString())
                  }
                >
                  {label}
                </DropdownMenu.Item>
              ))}
              {isSnoozed(task, Date.now()) && (
                <DropdownMenu.Item
                  className="rounded-sm px-2 py-1.5 text-xs outline-none transition-colors duration-150 data-[highlighted]:bg-accent/55 motion-reduce:transition-none"
                  onSelect={() => snooze(null)}
                >
                  Unsnooze
                </DropdownMenu.Item>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
      <Button
        type="button"
        variant="ghost"
        className="h-6 gap-1 px-1 text-[11px]"
        aria-label={task.archived ? 'Reopen task' : 'Settle task'}
        disabled={task.status === 'running'}
        onClick={() =>
          setWorkspace((w) =>
            updateTask(w, task.id, (t) => ({ ...t, archived: !t.archived, snoozedUntil: null })),
          )
        }
      >
        {task.archived ? <Undo2 className="size-3.5" /> : <Check className="size-3.5" />}
        {task.archived ? 'Reopen' : 'Settle'}
      </Button>
    </>
  )
}
