import type { Task } from '../../workspace.js'

export type NativeTodo = NonNullable<Task['nativeTodos']>[number]

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

/** The provider's native todo list from an event, or undefined when the event is not one.
 * An empty array clears the list. Muse reports `session/todoListChanged` with
 * `{ items: [{ text, status }] }`; cancelled entries are dropped. */
export function nativeTodos(name: string, payload: unknown): NativeTodo[] | undefined {
  if (name !== 'session/todoListChanged') return undefined
  const items = record(payload).items
  if (!Array.isArray(items)) return undefined
  const todos: NativeTodo[] = []
  for (const entry of items) {
    const item = record(entry)
    const text = typeof item.text === 'string' ? item.text.trim() : ''
    const status =
      item.status === 'completed'
        ? 'completed'
        : item.status === 'inProgress' || item.status === 'in-progress'
          ? 'in-progress'
          : item.status === 'pending'
            ? 'pending'
            : undefined
    if (!text || !status) continue
    todos.push({ text: text.slice(0, 2000), status })
    if (todos.length >= 100) break
  }
  return todos
}

/** Progress counts for the todo summary line; undefined when there is no list to show. */
export function nativeTodoSummary(
  task: Pick<Task, 'nativeTodos'>,
): { total: number; completed: number; active?: string } | undefined {
  const todos = task.nativeTodos
  if (!todos?.length) return undefined
  return {
    total: todos.length,
    completed: todos.filter((todo) => todo.status === 'completed').length,
    active: todos.find((todo) => todo.status === 'in-progress')?.text,
  }
}
