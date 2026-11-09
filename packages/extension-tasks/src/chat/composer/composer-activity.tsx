import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Pause, CircleAlert } from 'lucide-react'
import { useWorkspace } from '@dovo/studio-core'
import { nativeTodoSummary, responses, type PendingMessage, type Task } from '@dovo/protocol'
import { MessageQueue } from '../thread/message-queue'
import { NativeTodos } from '../thread/native-todos'

/** Keep progress and queued follow-ups above the input, with one visible panel. */
export function ComposerActivity({
  task,
  pending,
}: {
  task: Task
  pending?: readonly PendingMessage[]
}) {
  const section = useRef<HTMLElement>(null)
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
  const pausedCount = task.queuePaused
    ? (task.queue?.length ?? 0)
    : (task.queue?.filter((message) => message.paused).length ?? 0)
  const hasQueue = !!task.queue?.length
  const both = hasQueue && !!summary
  const active = hasQueue ? (summary ? selected : 'queue') : 'checklist'
  useEffect(() => {
    const pane = section.current?.closest('[data-conversation-pane]')
    if (!pane) return
    let compact = false
    const measure = () => {
      const next = pane.getBoundingClientRect().height < 620
      if (next && !compact) setCollapsed(true)
      compact = next
    }
    const observer = new ResizeObserver(measure)
    observer.observe(pane)
    measure()
    return () => observer.disconnect()
  }, [task.id, hasQueue, !!summary])
  if (!hasQueue && !summary) return null
  return (
    <section
      ref={section}
      aria-label="Composer activity"
      className="studio-composer-activity relative mx-auto overflow-hidden text-[0.8125rem]"
    >
      <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {`${task.queue?.length ?? 0} queued ${(task.queue?.length ?? 0) === 1 ? 'message' : 'messages'}${pausedCount ? `, ${pausedCount} paused` : ''}`}
      </span>
      <div
        className={`flex min-h-8 min-w-0 items-center gap-1 px-2 py-0.5 ${collapsed ? '' : 'border-b border-border/40'}`}
      >
        <div
          role={both ? 'tablist' : undefined}
          aria-label={both ? 'Queue and checklist' : undefined}
          className={`flex min-w-0 flex-1 items-center gap-1 pr-8 ${both ? 'studio-segmented' : ''}`}
        >
          {[
            ...(hasQueue
              ? [
                  {
                    value: 'queue',
                    title: `${task.queue?.length ?? 0} queued`,
                    count: '',
                    notice: pausedCount ? `${pausedCount} queued messages paused` : '',
                    label: `Queue · ${task.queue?.length ?? 0}${pausedCount ? (pausedCount === task.queue?.length ? ' · Paused' : ` · ${pausedCount} paused`) : ''}`,
                  },
                ]
              : []),
            ...(summary
              ? [
                  {
                    value: 'checklist',
                    title: 'Checklist',
                    count: `${summary.completed}/${summary.total}`,
                    notice: summary.unfinished ? 'Checklist unfinished' : '',
                    label: `Checklist · ${summary.completed}/${summary.total}${summary.unfinished ? ' · Unfinished' : ''}`,
                  },
                ]
              : []),
          ].map(({ value, label, title, count, notice }) => {
            const content = (
              <>
                <span className="shrink-0">{title}</span>
                {count && (
                  <span className="shrink-0 tabular-nums text-muted-foreground">{count}</span>
                )}
                {(both || notice) && (
                  <span aria-hidden className="flex size-3 shrink-0 items-center justify-center">
                    {notice &&
                      (value === 'queue' ? (
                        <Pause className="size-3 text-status-warning" />
                      ) : (
                        <CircleAlert className="size-3 text-status-warning" />
                      ))}
                  </span>
                )}
              </>
            )
            return both ? (
              <button
                key={value}
                type="button"
                role="tab"
                id={`${id}-${value}`}
                aria-label={label}
                title={notice || label}
                aria-controls={`${id}-${value}-panel`}
                aria-selected={active === value}
                tabIndex={active === value ? 0 : -1}
                className="inline-flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring aria-selected:bg-muted aria-selected:text-foreground"
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
                {content}
              </button>
            ) : (
              <span
                key={value}
                aria-label={label}
                title={label}
                className="inline-flex min-w-0 items-center gap-1.5 pl-1 text-xs font-medium"
              >
                {content}
              </span>
            )
          })}
          {hasQueue && !both && (
            <span className="truncate text-xs text-muted-foreground">
              ·{' '}
              {task.queuePaused || task.queue?.[0]?.paused
                ? 'paused'
                : task.status === 'running'
                  ? 'after this turn'
                  : 'ready to send'}
            </span>
          )}
        </div>
        <button
          type="button"
          aria-label={collapsed ? 'Expand composer activity' : 'Collapse composer activity'}
          title={collapsed ? 'Expand queue and checklist' : 'Collapse queue and checklist'}
          aria-expanded={!collapsed}
          aria-controls={`${id}-${active}-panel`}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setCollapsed((value) => !value)}
        >
          {collapsed ? (
            <ChevronDown aria-hidden="true" className="size-4" />
          ) : (
            <ChevronUp aria-hidden="true" className="size-4" />
          )}
        </button>
      </div>
      {collapsed && summary && (
        <div
          role="progressbar"
          aria-label="Checklist completion"
          aria-valuemin={0}
          aria-valuemax={summary.total}
          aria-valuenow={summary.completed}
          className="mx-3 h-1 rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-status-success"
            style={{ width: `${(summary.completed / summary.total) * 100}%` }}
          />
        </div>
      )}
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
