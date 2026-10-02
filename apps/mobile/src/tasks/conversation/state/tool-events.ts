import { mutableStruct } from '@dovo/protocol'
import { decodeResult } from '@dovo/protocol'
import { recentTools, createRecentTools, type activitySchema, type Task } from '@dovo/protocol'
import { Schema } from 'effect'
export type ToolEvents = Schema.Schema.Type<typeof activitySchema>['events']
export type TaskToolEvent = ReturnType<typeof recentTools>[number]
export const pendingActivity = (status: string) =>
  ['started', 'running', 'in_progress', 'pending', 'inProgress'].includes(status)

/** A provider may omit the last tool event when the enclosing turn ends. */
export function taskToolEvents(
  task: Pick<Task, 'id' | 'status' | 'turns'>,
  events: ToolEvents,
  projectTools = recentTools,
): TaskToolEvent[] {
  const activeTurnId =
    task.status === 'running'
      ? [...(task.turns ?? [])].reverse().find((turn) => turn.status === 'running')?.id
      : undefined
  const turnsById = new Map(task.turns?.map((turn) => [turn.id, turn]))
  return projectTools(events.filter((event) => event.scope === task.id)).map((event) => {
    const turn = event.turnId ? turnsById.get(event.turnId) : undefined
    const status = toolEventStatus(event, turn, task.status, activeTurnId)
    return status === event.status ? event : { ...event, status }
  })
}
export function activityIdentity(event: TaskToolEvent) {
  try {
    const data = decodeResult(
      mutableStruct({
        toolId: Schema.String,
      }),
      JSON.parse(event.payload),
    ).data
    return data ? `${event.turnId ?? ''}:${data.toolId}` : event.id
  } catch {
    return event.id
  }
}
export function activityOutcome(events: TaskToolEvent[]) {
  const failed = events.filter((event) => ['failed', 'error'].includes(event.status)).length
  const cancelled = events.filter((event) => event.status === 'cancelled').length
  const interrupted = events.filter((event) => event.status === 'interrupted').length
  return [
    failed ? `${failed} failed` : '',
    cancelled ? `${cancelled} cancelled` : '',
    interrupted ? `${interrupted} interrupted` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Streaming text does not require reparsing the same native tool history. */
export function createTaskToolEvents() {
  const project = createRecentTools()
  const interrupted = new WeakMap<TaskToolEvent, { status: string; tool: TaskToolEvent }>()
  let filtered: { id: string; input: ToolEvents; events: ToolEvents } | undefined
  return (task: Pick<Task, 'id' | 'status' | 'turns'>, events: ToolEvents) => {
    if (filtered?.id !== task.id || filtered.input !== events)
      filtered = {
        id: task.id,
        input: events,
        events: events.filter((event) => event.scope === task.id),
      }
    const raw = project(filtered.events)
    const turns = new Map(task.turns?.map((turn) => [turn.id, turn]))
    const activeTurnId =
      task.status === 'running'
        ? [...(task.turns ?? [])].reverse().find((turn) => turn.status === 'running')?.id
        : undefined
    return raw.map((source) => {
      const turn = source.turnId ? turns.get(source.turnId) : undefined
      const status = toolEventStatus(source, turn, task.status, activeTurnId)
      if (status === source.status) return source
      const previous = interrupted.get(source)
      if (previous?.status === status) return previous.tool
      const tool = { ...source, status }
      interrupted.set(source, { status, tool })
      return tool
    })
  }
}

function toolEventStatus(
  event: TaskToolEvent,
  turn: NonNullable<Task['turns']>[number] | undefined,
  taskStatus: Task['status'],
  activeTurnId: string | undefined,
) {
  if (!pendingActivity(event.status) || (turn?.id === activeTurnId && turn?.status === 'running'))
    return event.status
  return turn?.status === 'cancelled' || (turn?.status === 'running' && taskStatus === 'cancelled')
    ? 'cancelled'
    : 'interrupted'
}
