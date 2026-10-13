import { useState } from 'react'
import { CheckCircle2, Circle, ListChecks, LoaderCircle } from 'lucide-react'
import { nativeTodoSummary, type Task } from '@dovo/protocol'

/** The provider's native todo list (Muse `session/todoListChanged`), latest state only. */
export function NativeTodos({ task }: { task: Task }) {
  const [open, setOpen] = useState(false)
  const summary = nativeTodoSummary(task)
  if (!summary) return null
  const todos = task.nativeTodos ?? []
  return (
    <section aria-label="Agent checklist" className="mx-auto w-full max-w-[var(--chat-max)] px-5 pb-2">
      <div className="rounded-lg border border-border/70 bg-card/60 px-3 py-2">
        <button
          type="button"
          className="flex w-full items-center gap-2 text-left text-xs"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <ListChecks className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="font-medium">
            Checklist · {summary.completed} of {summary.total} done
          </span>
          {summary.active && !open && (
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{summary.active}</span>
          )}
        </button>
        {open && (
          <ul className="mt-2 space-y-1.5">
            {todos.map((todo, index) => (
              <li key={index} className="flex items-start gap-2 text-xs">
                {todo.status === 'completed' ? (
                  <CheckCircle2 className="mt-px size-3.5 shrink-0 text-emerald-600" aria-hidden />
                ) : todo.status === 'in-progress' ? (
                  <LoaderCircle
                    className="mt-px size-3.5 shrink-0 animate-spin text-primary"
                    aria-hidden
                  />
                ) : (
                  <Circle className="mt-px size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <span
                  className={
                    todo.status === 'completed'
                      ? 'text-muted-foreground line-through'
                      : todo.status === 'in-progress'
                        ? 'font-medium'
                        : undefined
                  }
                >
                  {todo.text}
                </span>
                <span className="sr-only">({todo.status.replace('-', ' ')})</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
