import { Schema } from 'effect'
import { decodeResult } from '../../shared/schema.js'
import type { Agent, Task } from '../../workspace.js'

export type NativeTodo = NonNullable<Task['nativeTodos']>[number]
const object = (value: unknown) =>
  decodeResult(Schema.Record(Schema.String, Schema.Unknown), value).data ?? {}
const text = (value: unknown) => (typeof value === 'string' ? value.trim().slice(0, 2000) : '')
const status = (value: unknown): NativeTodo['status'] | undefined =>
  value === 'completed'
    ? 'completed'
    : value === 'inProgress' || value === 'in-progress' || value === 'in_progress'
      ? 'in-progress'
      : value === 'pending'
        ? 'pending'
        : undefined
const claudeId = (value: unknown) =>
  typeof value === 'string' && value ? `claude:${value}`.slice(0, 200) : undefined
function list(value: unknown, field: string, identity?: string): NativeTodo[] | undefined {
  if (!Array.isArray(value)) return
  return value.slice(0, 100).flatMap((entry) => {
    const item = object(entry)
    const label = text(item[field])
    const state = status(item.status)
    const id =
      identity && typeof item.id === 'string' && item.id
        ? `${identity}:${item.id}`.slice(0, 200)
        : undefined
    return label && state ? [{ text: label, status: state, ...(id ? { id } : {}) }] : []
  })
}

/** Latest native progress only; undefined means this event does not change the checklist.
 * Child-session events must never replace the parent thread's progress. */
export function nativeTodos(
  name: string,
  payload: unknown,
  provider: Agent['provider'] = 'muse',
  current: NativeTodo[] = [],
  sessionId?: string,
): NativeTodo[] | undefined {
  if (
    !(
      (provider === 'muse' && name === 'session/todoListChanged') ||
      (provider === 'codex' && name === 'turn/plan/updated') ||
      (provider === 'claude' && name === 'claude/checklist') ||
      (provider === 'opencode' && name === 'todo.updated') ||
      ((provider === 'acp' || provider === 'grok') && name === 'plan') ||
      (provider === 'vibe' && name === 'vibe/effect')
    )
  )
    return
  const data = object(payload)
  if (provider === 'muse' && name === 'session/todoListChanged') return list(data.items, 'text')
  if (provider === 'codex' && name === 'turn/plan/updated') {
    if (sessionId && data.threadId !== sessionId) return
    return list(data.plan, 'step')
  }
  if (provider === 'opencode') {
    const properties = object(data.properties)
    if (!sessionId || properties.sessionID !== sessionId) return
    return list(properties.todos, 'content')
  }
  if (provider === 'acp' || provider === 'grok') {
    if (!sessionId || data.sessionId !== sessionId) return
    const update = object(data.update)
    if (update.sessionUpdate !== 'plan') return
    return list(update.entries, 'content')
  }
  if (provider === 'vibe') {
    const entry = object(data.entry)
    const state = object(entry.state)
    if (
      !sessionId ||
      entry.sessionId !== sessionId ||
      entry.type !== 'effect' ||
      object(entry.detail).kind !== 'todo' ||
      state.status !== 'completed'
    )
      return
    return list(object(state.output).todos, 'content', 'vibe')
  }
  // PostToolUse hooks run only after successful native tool execution, rather than
  // interpreting assistant tool requests or partial argument deltas as completed writes.
  if (provider !== 'claude' || name !== 'claude/checklist' || data.agent_id) return
  const input = object(data.tool_input)
  const output = object(data.tool_response)
  if (data.tool_name === 'TodoWrite') return list(output.newTodos, 'content')
  if (data.tool_name === 'TaskList') return list(output.tasks, 'subject', 'claude')
  if (data.tool_name === 'TaskCreate' || data.tool_name === 'TaskGet') {
    const task = object(output.task)
    const id = claudeId(task.id)
    const label = text(task.subject)
    const state = data.tool_name === 'TaskCreate' ? 'pending' : status(task.status)
    if (!id || !label || !state) return
    if (data.tool_name === 'TaskCreate' && current.some((item) => item.id === id)) return current
    const todo: NativeTodo = { id, text: label, status: state }
    return current.some((item) => item.id === id)
      ? current.map((item) => (item.id === id ? todo : item))
      : [...current, todo].slice(-100)
  }
  if (data.tool_name === 'TaskUpdate' && output.success === true) {
    const id = claudeId(output.taskId)
    if (!id || !current.some((item) => item.id === id)) return
    const fields = Array.isArray(output.updatedFields) ? output.updatedFields : []
    const nextStatus = object(output.statusChange).to ?? input.status
    const statusChanged = fields.includes('status') || object(output.statusChange).to !== undefined
    if (statusChanged && nextStatus === 'deleted') return current.filter((item) => item.id !== id)
    return current.map((item) =>
      item.id !== id
        ? item
        : {
            ...item,
            text: fields.includes('subject') ? text(input.subject) || item.text : item.text,
            status: statusChanged ? (status(nextStatus) ?? item.status) : item.status,
          },
    )
  }
}

/** Progress counts for the todo summary line; undefined when there is no list to show. */
export function nativeTodoSummary(
  task: Pick<Task, 'nativeTodos' | 'status'>,
): { total: number; completed: number; unfinished: boolean; active?: string } | undefined {
  const todos = task.nativeTodos
  if (!todos?.length) return undefined
  const completed = todos.filter((todo) => todo.status === 'completed').length
  const running = task.status === 'running'
  return {
    total: todos.length,
    completed,
    unfinished: !running && completed < todos.length,
    active: running ? todos.find((todo) => todo.status === 'in-progress')?.text : undefined,
  }
}
