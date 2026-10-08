import { AlarmClock, Check, Undo2 } from 'lucide-react'
import { updateTask, useWorkspace, type Task } from '@dovo/studio-core'
import { Button, DropdownMenu } from '@dovo/studio-ui'
import { useRef, useState } from 'react'
import { taskActionClient, type TaskRowChanges } from '../list/task-row-actions'
import type { TaskSource } from '../list/task-collection'
import { isSnoozed } from '../list/task-priority'
export function TaskLifecycleActions({ task, source }: { task: Task; source?: TaskSource }) {
  const store = useWorkspace()
  const pendingRef = useRef(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const change = async (updates: TaskRowChanges) => {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    setError('')
    try {
      if (source) await taskActionClient(store, source).patch(task, updates)
      else store.setWorkspace((w) => updateTask(w, task.id, (t) => ({ ...t, ...updates })))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }
  const snooze = (until: string | null) => void change({ snoozedUntil: until })
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
              disabled={pending}
              aria-label="Snooze task"
              title="Snooze task"
            >
              <AlarmClock className="size-3.5" />
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
        className="h-6 gap-1 px-1 text-[0.6875rem]"
        aria-label={task.archived ? 'Reopen task' : 'Settle task'}
        disabled={pending || task.status === 'running'}
        onClick={() => void change({ archived: !task.archived, snoozedUntil: null })}
      >
        {task.archived ? <Undo2 className="size-3.5" /> : <Check className="size-3.5" />}
        {task.archived ? 'Reopen' : 'Settle'}
      </Button>
      {error && (
        <span
          role="alert"
          className="absolute right-0 top-full z-10 w-56 rounded-md border bg-popover p-2 text-xs text-destructive"
        >
          {error}
        </span>
      )}
    </>
  )
}
