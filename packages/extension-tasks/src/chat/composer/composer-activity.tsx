import { useId, useState } from 'react'
import { nativeTodoSummary, type PendingMessage, type Task } from '@dovo/protocol'
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
      <div
        role={both ? 'tablist' : undefined}
        aria-label={both ? 'Queue and checklist' : undefined}
        className="flex items-center gap-1 px-2 py-1"
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
              onClick={() => setSelected(value)}
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
      {hasQueue && (
        <div
          role={both ? 'tabpanel' : undefined}
          id={`${id}-queue-panel`}
          aria-labelledby={both ? `${id}-queue` : undefined}
          hidden={active !== 'queue'}
        >
          <MessageQueue task={task} pending={pending} embedded />
        </div>
      )}
      {summary && (
        <div
          role={both ? 'tabpanel' : undefined}
          id={`${id}-checklist-panel`}
          aria-labelledby={both ? `${id}-checklist` : undefined}
          hidden={active !== 'checklist'}
        >
          <NativeTodos task={task} embedded />
        </div>
      )}
    </section>
  )
}
