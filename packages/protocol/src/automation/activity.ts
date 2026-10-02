import { mutableStruct, mutableArray } from '../shared/schema.js'
import { decodeResult } from '../shared/schema.js'
import { Schema } from 'effect'
import { toolPresentation } from '../conversation/presentation/tool-presentation.js'
import { mcpAppReferences } from '../conversation/mcp-apps.js'
import { artifactReferences } from '../conversation/artifacts.js'
export const activityEventSchema = mutableStruct({
  id: Schema.String,
  time: Schema.String,
  kind: Schema.String,
  scope: Schema.String,
  summary: Schema.String,
  payload: Schema.String,
})
export const activitySchema = mutableStruct({ events: mutableArray(activityEventSchema) })
const toolPayload = mutableStruct({
  turnId: Schema.String,
  toolId: Schema.String,
  status: Schema.String,
  textOffset: Schema.optional(
    Schema.Number.pipe(Schema.finite(), Schema.int(), Schema.nonNegative()),
  ),
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

/** Preserve references on unchanged polls without ignoring same-ID tool updates. */
export function retainActivityEvents(previous: Event[], next: Event[]): Event[] {
  if (previous === next) return previous
  if (previous.length !== next.length) return next
  return previous.every((event, index) => {
    const other = next[index]!
    return (
      event.id === other.id &&
      event.time === other.time &&
      event.kind === other.kind &&
      event.scope === other.scope &&
      event.summary === other.summary &&
      event.payload === other.payload
    )
  })
    ? previous
    : next
}

type Tool = Event & {
  startedAt?: string
  status: string
  turnId?: string
  inputPayload?: string
  textOffset?: number
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
        textOffset: tool.success ? tool.data.textOffset : undefined,
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
    if (!previous) tools.set(key, { ...event, startedAt: event.time })
    else {
      const summary =
        ['Tool result', 'Tool update'].includes(previous.summary) &&
        !['Tool result', 'Tool update'].includes(event.summary)
          ? event.summary
          : previous.summary
      tools.set(key, {
        ...previous,
        startedAt:
          event.time < (previous.startedAt ?? previous.time)
            ? event.time
            : (previous.startedAt ?? previous.time),
        summary,
        inputPayload: pending(event.status) ? event.payload : previous.inputPayload,
        textOffset: pending(event.status)
          ? (event.textOffset ?? previous.textOffset)
          : previous.textOffset,
      })
    }
  }
  return [...tools.values()]
}

/** Compact thread activity retains identity, status, commands and app references, never raw provider data. */
export function compactActivityEvents(events: Event[]): Event[] {
  return events.flatMap((event) => {
    if (!['tool', 'reasoning', 'task-activity'].includes(event.kind)) return [event]
    return splitCalls(event).map((call) => {
      let metadata: unknown
      try {
        metadata = JSON.parse(call.payload)
      } catch {
        metadata = {}
      }
      const fields = decodeResult(toolPayload, metadata).data
      const presentation = toolPresentation(call.payload, call.summary)
      const apps = mcpAppReferences(call.payload)
      const artifacts = artifactReferences(metadata)
      return {
        ...call,
        payload: JSON.stringify({
          ...fields,
          presentation: {
            ...presentation,
            input: presentation.kind === 'command' ? presentation.input : '',
            output: '',
          },
          ...(apps.length ? { mcpApps: apps } : {}),
          ...(artifacts.length ? { artifacts } : {}),
        }),
      }
    })
  })
}

/** Reuse unchanged tool records across text streaming and incremental activity updates. */
export function createRecentTools() {
  let input: Event[] | undefined
  let previous: Tool[] = []
  return (events: Event[]): Tool[] => {
    if (input === events) return previous
    input = events
    const retained = new Map(
      previous.map((tool) => [JSON.stringify([tool.scope, tool.turnId, tool.id]), tool]),
    )
    const next = recentTools(events).map((tool) => {
      const old = retained.get(JSON.stringify([tool.scope, tool.turnId, tool.id]))
      return old &&
        old.time === tool.time &&
        old.kind === tool.kind &&
        old.summary === tool.summary &&
        old.payload === tool.payload &&
        old.startedAt === tool.startedAt &&
        old.status === tool.status &&
        old.inputPayload === tool.inputPayload &&
        old.textOffset === tool.textOffset
        ? old
        : tool
    })
    if (next.length !== previous.length || next.some((tool, index) => tool !== previous[index]))
      previous = next
    return previous
  }
}
