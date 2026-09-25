import { mutableStruct } from '@dovo/protocol'
import { decodeResult } from '@dovo/protocol'
import { recentTools, type activitySchema, type Task } from '@dovo/protocol'
import { Schema } from 'effect'
export type ToolEvents = Schema.Schema.Type<typeof activitySchema>['events']
export type TaskToolEvent = ReturnType<typeof recentTools>[number]
export const pendingActivity = (status: string) =>
  ['started', 'running', 'in_progress', 'pending', 'inProgress'].includes(status)

/** A provider may omit the last tool event when the enclosing turn ends. */
export function taskToolEvents(task: Task, events: ToolEvents): TaskToolEvent[] {
  const activeTurnId =
    task.status === 'running'
      ? [...(task.turns ?? [])].reverse().find((turn) => turn.status === 'running')?.id
      : undefined
  return recentTools(events.filter((event) => event.scope === task.id)).map((event) => {
    if (!pendingActivity(event.status)) return event
    const turn = task.turns?.find((turn) => turn.id === event.turnId)
    if (turn?.id === activeTurnId && turn?.status === 'running') return event
    return {
      ...event,
      status:
        turn?.status === 'cancelled' || (turn?.status === 'running' && task.status === 'cancelled')
          ? 'cancelled'
          : 'interrupted',
    }
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
