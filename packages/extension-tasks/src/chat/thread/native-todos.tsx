import { useState } from 'react'
import { CheckCircle2, Circle, ListChecks, LoaderCircle } from 'lucide-react'
import { nativeTodoSummary, type Task } from '@dovo/protocol'

/** Shared agent checklist from native progress or the regular task tool, latest state only. */
export function NativeTodos({
  task,
  embedded = false,
  onClear,
  clearDisabled = false,
}: {
  task: Task
  embedded?: boolean
  onClear?: (items: NonNullable<Task['nativeTodos']>) => Promise<unknown>
  clearDisabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [error, setError] = useState('')
  const [confirmation, setConfirmation] = useState<Task['nativeTodos']>()
  const summary = nativeTodoSummary(task)
  if (!summary) return null
  const todos = task.nativeTodos ?? []
  return (
    <section
      aria-label="Agent checklist"
      className={embedded ? undefined : 'mx-auto w-full max-w-[var(--chat-max)] px-5 pb-2'}
    >
      <div
        className={
          embedded ? 'px-3 py-2' : 'rounded-lg border border-border/70 bg-card/60 px-3 py-2'
        }
      >
        {!embedded && (
          <button
            type="button"
            className="flex w-full items-center gap-2 text-left text-xs"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <ListChecks className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="font-medium">
              Checklist · {summary.completed} of {summary.total} done
              {summary.unfinished ? ' · Unfinished' : ''}
            </span>
            {summary.active && !open && (
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {summary.active}
              </span>
            )}
          </button>
        )}
        <div
          role="progressbar"
          aria-label="Checklist completion"
          aria-valuemin={0}
          aria-valuemax={summary.total}
          aria-valuenow={summary.completed}
          className="mt-2 h-1 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-status-success"
            style={{ width: `${(summary.completed / summary.total) * 100}%` }}
          />
        </div>
        {(open || embedded) && (
          <ul
            className="mt-2 max-h-48 space-y-1.5 overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable]"
            aria-label="Checklist items"
          >
            {todos.map((todo, index) => (
              <li key={todo.id ?? index} className="flex min-w-0 items-start gap-2 text-xs">
                {todo.status === 'completed' ? (
                  <CheckCircle2
                    className="mt-px size-3.5 shrink-0 text-status-success"
                    aria-hidden
                  />
                ) : todo.status === 'in-progress' && !summary.unfinished ? (
                  <span className="mt-px size-3.5 shrink-0 overflow-hidden" aria-hidden>
                    <LoaderCircle className="size-3.5 animate-spin text-primary motion-reduce:animate-none" />
                  </span>
                ) : (
                  <Circle className="mt-px size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <span
                  className={
                    todo.status === 'completed'
                      ? 'min-w-0 break-words text-muted-foreground line-through'
                      : todo.status === 'in-progress'
                        ? 'min-w-0 break-words font-medium'
                        : 'min-w-0 break-words'
                  }
                >
                  {todo.text}
                </span>
                <span className="sr-only">
                  (
                  {todo.status !== 'completed' && summary.unfinished
                    ? 'unfinished'
                    : todo.status.replace('-', ' ')}
                  )
                </span>
              </li>
            ))}
          </ul>
        )}
        {summary.unfinished && (
          <p className="mt-2 text-xs text-muted-foreground">
            Work stopped with {summary.total - summary.completed}{' '}
            {summary.total - summary.completed === 1 ? 'item' : 'items'} left. Continue the thread
            to pick them up.
          </p>
        )}
        {onClear && (open || embedded) && (
          <div className="mt-2 space-y-2 text-xs">
            {confirmation && (
              <p>Clear all {confirmation.length} checklist items, including unfinished work?</p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={clearDisabled || clearing}
                className="rounded-md px-2 py-1 text-muted-foreground hover:bg-muted disabled:opacity-50"
                onClick={async () => {
                  setError('')
                  if (!confirmation) {
                    setConfirmation(todos)
                    return
                  }
                  setClearing(true)
                  try {
                    await onClear(confirmation)
                  } catch (error) {
                    setError(error instanceof Error ? error.message : String(error))
                  } finally {
                    setClearing(false)
                    setConfirmation(undefined)
                  }
                }}
              >
                {clearing
                  ? 'Clearing…'
                  : confirmation
                    ? 'Confirm clear checklist'
                    : 'Clear checklist'}
              </button>
              {confirmation && (
                <button
                  type="button"
                  disabled={clearing}
                  className="rounded-md px-2 py-1 hover:bg-muted"
                  onClick={() => setConfirmation(undefined)}
                >
                  Cancel
                </button>
              )}
            </div>
            {error && (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
