import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useWorkspace } from '@dovo/studio-core'
import { nativeTodoSummary, responses, type PendingMessage, type Task } from '@dovo/protocol'
import { MessageQueue } from '../thread/message-queue'
import { NativeTodos } from '../thread/native-todos'

/** Keep progress and queued follow-ups attached to the input, with one visible panel. */
export function ComposerActivity({
  task,
  pending,
}: {
  task: Task
  pending?: readonly PendingMessage[]
}) {
  const [selected, setSelected] = useState('queue')
  const [collapsed, setCollapsed] = useState(false)
  const previousInputs = useRef(new Set<string>())
  const { snapshot, request, connected } = useWorkspace()
  useEffect(() => {
    const inputs = [
      ...(snapshot?.questions ?? [])
        .filter((item) => item.taskId === task.id)
        .map((item) => item.id),
      ...(snapshot?.approvals ?? [])
        .filter((item) => item.taskId === task.id)
        .map((item) => item.id),
    ]
    if (inputs.some((id) => !previousInputs.current.has(id))) setCollapsed(true)
    previousInputs.current = new Set(inputs)
  }, [task.id, snapshot?.questions, snapshot?.approvals])
  const id = useId()
  const summary = nativeTodoSummary(task)
  const hasQueue = !!task.queue?.length
  const both = hasQueue && !!summary
  const active = hasQueue ? (summary ? selected : 'queue') : 'checklist'
  if (!hasQueue && !summary) return null
  return (
    <section
      aria-label="Composer activity"
      className="relative mx-auto -mb-3 w-[calc(100%-24px)] max-w-[calc(var(--chat-max)-1.5rem)] rounded-t-xl border border-b-0 bg-muted/15 pb-3 text-xs"
    >
      <div className="flex items-center px-2 py-1">
        <div
          role={both ? 'tablist' : undefined}
          aria-label={both ? 'Queue and checklist' : undefined}
          className="flex min-w-0 items-center gap-1"
        >
          {[
            ...(hasQueue ? [{ value: 'queue', label: `Queue · ${task.queue?.length ?? 0}` }] : []),
            ...(summary
              ? [
                  {
                    value: 'checklist',
                    label: `Checklist · ${summary.completed}/${summary.total}${summary.unfinished ? ' · Unfinished' : ''}`,
                  },
                ]
              : []),
          ].map(({ value, label }) =>
            both ? (
              <button
                key={value}
                type="button"
                role="tab"
                id={`${id}-${value}`}
                aria-controls={`${id}-${value}-panel`}
                aria-selected={active === value}
                tabIndex={active === value ? 0 : -1}
                className="rounded-md px-2 py-1 text-muted-foreground aria-selected:bg-muted aria-selected:text-foreground"
                onClick={() => {
                  setSelected(value)
                  setCollapsed(false)
                }}
                onKeyDown={(event) => {
                  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                  event.preventDefault()
                  const next =
                    event.key === 'Home'
                      ? 'queue'
                      : event.key === 'End'
                        ? 'checklist'
                        : value === 'queue'
                          ? 'checklist'
                          : 'queue'
                  setSelected(next)
                  setCollapsed(false)
                  document.getElementById(`${id}-${next}`)?.focus()
                }}
              >
                {label}
              </button>
            ) : (
              <span key={value} className="px-2 py-1 font-medium">
                {label}
              </span>
            ),
          )}
        </div>
        <button
          type="button"
          aria-label={collapsed ? 'Expand composer activity' : 'Collapse composer activity'}
          title={collapsed ? 'Expand queue and checklist' : 'Collapse queue and checklist'}
          aria-expanded={!collapsed}
          aria-controls={`${id}-${active}-panel`}
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setCollapsed((value) => !value)}
        >
          {collapsed ? (
            <ChevronRight aria-hidden="true" className="size-4" />
          ) : (
            <ChevronDown aria-hidden="true" className="size-4" />
          )}
        </button>
      </div>
      {hasQueue && (
        <div
          role={both ? 'tabpanel' : undefined}
          id={`${id}-queue-panel`}
          aria-labelledby={both ? `${id}-queue` : undefined}
          hidden={collapsed || active !== 'queue'}
        >
          <MessageQueue task={task} pending={pending} embedded />
        </div>
      )}
      {summary && (
        <div
          role={both ? 'tabpanel' : undefined}
          id={`${id}-checklist-panel`}
          aria-labelledby={both ? `${id}-checklist` : undefined}
          hidden={collapsed || active !== 'checklist'}
        >
          <NativeTodos
            key={task.id}
            task={task}
            embedded
            clearDisabled={!connected}
            onClear={(expectedItems) =>
              request('/api/tasks/checklist/clear', { id: task.id, expectedItems }, responses.ok)
            }
          />
        </div>
      )}
    </section>
  )
}
