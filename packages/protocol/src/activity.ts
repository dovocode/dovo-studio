import { mutableStruct, mutableArray } from './schema.js'
import { decodeResult } from './schema.js'
import { Schema } from 'effect'
export const activitySchema = mutableStruct({
  events: mutableArray(
    mutableStruct({
      id: Schema.String,
      time: Schema.String,
      kind: Schema.String,
      scope: Schema.String,
      summary: Schema.String,
      payload: Schema.String,
    }),
  ),
})
const toolPayload = mutableStruct({
  turnId: Schema.String,
  toolId: Schema.String,
  status: Schema.String,
})
const record = Schema.mutable(
  Schema.Record({
    key: Schema.String,
    value: Schema.Unknown,
  }),
)
const object = (value: unknown) => decodeResult(record, value).data ?? {}
const pending = (status: string) =>
  ['started', 'running', 'in_progress', 'pending', 'inProgress'].includes(status)
type Event = Schema.Schema.Type<typeof activitySchema>['events'][number]
type Tool = Event & {
  status: string
  turnId?: string
  inputPayload?: string
}

// Claude can send several calls in one message and return their results individually.
function splitCalls(event: Event): Event[] {
  let payload: unknown
  try {
    payload = JSON.parse(event.payload)
  } catch {
    return [event]
  }
  const envelope = object(payload)
  const data = object(envelope.event)
  const message = object(data.message)
  const blocks = decodeResult(mutableArray(record), message.content).data ?? []
  const calls = blocks.filter((block) => block.type === 'tool_use' || block.type === 'tool_result')
  if (!calls.length) return [event]
  return calls.map((block) => {
    const id = block.type === 'tool_use' ? block.id : block.tool_use_id
    if (typeof id !== 'string' || !id) return event
    return {
      ...event,
      id: `${event.id}:${id}`,
      summary: typeof block.name === 'string' ? block.name : 'Tool result',
      payload: JSON.stringify({
        ...envelope,
        toolId: id,
        status:
          block.type === 'tool_use' ? 'running' : block.is_error === true ? 'failed' : 'completed',
        event: {
          ...data,
          message: {
            ...message,
            content: [block],
          },
        },
      }),
    }
  })
}
export function recentTools(events: Event[]): Tool[] {
  const parsed = events
    .flatMap(splitCalls)
    .map((event) => {
      let payload: unknown
      try {
        payload = JSON.parse(event.payload)
      } catch {
        payload = {}
      }
      const tool = decodeResult(toolPayload, payload)
      return {
        ...event,
        key:
          tool.success && tool.data.toolId ? `${tool.data.turnId}:${tool.data.toolId}` : event.id,
        status: tool.success ? tool.data.status : 'recorded',
        turnId: tool.success ? tool.data.turnId : undefined,
      }
    })
    .sort(
      (a, b) =>
        (Date.parse(b.time) || 0) - (Date.parse(a.time) || 0) ||
        Number(pending(a.status)) - Number(pending(b.status)),
    )
  const tools = new Map<string, Tool>()
  for (const { key, ...event } of parsed) {
    const previous = tools.get(key)
    if (!previous) tools.set(key, event)
    else {
      const summary =
        ['Tool result', 'Tool update'].includes(previous.summary) &&
        !['Tool result', 'Tool update'].includes(event.summary)
          ? event.summary
          : previous.summary
      tools.set(key, {
        ...previous,
        summary,
        inputPayload: pending(event.status) ? event.payload : previous.inputPayload,
      })
    }
  }
  return [...tools.values()]
}
