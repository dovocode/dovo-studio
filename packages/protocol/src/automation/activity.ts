import { mutableStruct, mutableArray } from '../shared/schema.js'
import { decodeResult } from '../shared/schema.js'
import { Schema } from 'effect'
import { toolPresentation } from '../conversation/presentation/tool-presentation.js'
import { mcpAppReferences } from '../conversation/mcp-apps.js'
import { toolImages, toolImageReferences } from '../conversation/tool-images.js'
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
  messageId: Schema.optional(Schema.String),
  toolId: Schema.String,
  terminalCommand: Schema.optional(Schema.Boolean),
  status: Schema.String,
  textOffset: Schema.optional(
    Schema.Number.pipe(
      Schema.check(Schema.isFinite()),
      Schema.check(Schema.isInt()),
      Schema.check(Schema.isGreaterThanOrEqualTo(0)),
    ),
  ),
})
const record = Schema.Record(Schema.String, Schema.mutableKey(Schema.Unknown))
const object = (value: unknown) => decodeResult(record, value).data ?? {}
const pending = (status: string) =>
  ['started', 'running', 'in_progress', 'pending', 'inProgress'].includes(status)
type Event = Schema.Schema.Type<typeof activitySchema>['events'][number]
function sameActivityEvent(event: Event, other: Event) {
  return (
    event === other ||
    (event.id === other.id &&
      event.time === other.time &&
      event.kind === other.kind &&
      event.scope === other.scope &&
      event.summary === other.summary &&
      event.payload === other.payload)
  )
}

/** Preserve references on unchanged polls without ignoring same-ID tool updates. */
export function retainActivityEvents(previous: Event[], next: Event[]): Event[] {
  if (previous === next) return previous
  if (previous.length !== next.length) return next
  return previous.every((event, index) => sameActivityEvent(event, next[index]!)) ? previous : next
}

type Tool = Event & {
  startedAt?: string
  status: string
  turnId?: string
  messageId?: string
  inputPayload?: string
  textOffset?: number
}

// Claude can send several calls in one message and return their results individually.
function splitCalls(event: Event, payload?: unknown): Event[] {
  if (payload === undefined)
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
    .flatMap((event) => splitCalls(event))
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
        messageId: tool.success ? tool.data.messageId : undefined,
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
        messageId: pending(event.status)
          ? (event.messageId ?? previous.messageId)
          : previous.messageId,
      })
    }
  }
  const result = [...tools.values()]
  const commandKey = (tool: Tool) =>
    JSON.stringify([
      tool.scope,
      tool.turnId ?? '',
      toolPresentation(tool.payload, tool.summary, tool.inputPayload).input,
    ])
  const commands = new Set(
    result
      .filter((tool) => {
        try {
          return object(JSON.parse(tool.payload)).terminalCommand === true
        } catch {
          return false
        }
      })
      .map(commandKey),
  )
  if (!commands.size) return result
  // The runtime records the actual command even when a harness wraps the MCP call in JS.
  // Keep that command card instead of a second card for the direct transport invocation.
  return result.filter((tool) => {
    if (
      ['failed', 'error', 'cancelled', 'interrupted'].includes(tool.status) ||
      !commands.has(commandKey(tool))
    )
      return true
    return ![tool.payload, tool.inputPayload].some((payload) => {
      if (!payload) return false
      let envelope: Record<string, unknown>
      try {
        envelope = object(JSON.parse(payload))
      } catch {
        return false
      }
      if (envelope.terminalCommand === true) return false
      const event = object(envelope.event)
      const item = object(event.item)
      const blocks = decodeResult(mutableArray(record), object(event.message).content).data ?? []
      const names = [
        tool.summary,
        item.tool,
        object(object(event.properties).part).tool,
        ...blocks.map((block) => block.name),
      ]
      return names.some(
        (name) =>
          typeof name === 'string' &&
          /^(?:mcp__dovo_task__|dovo_task[./_])?terminal_run$/i.test(name),
      )
    })
  })
}

/** Compact thread activity retains identity, status, commands and app references, never raw provider data. */
export function compactActivityEvents(events: Event[]): Event[] {
  return events.flatMap((event) => {
    if (!['tool', 'reasoning', 'task-activity'].includes(event.kind)) return [event]
    let original: unknown
    try {
      original = JSON.parse(event.payload)
    } catch {
      original = undefined
    }
    const originalImages = toolImages(original)
    return splitCalls(event, original).map((call) => {
      const metadata: unknown = call === event ? original : JSON.parse(call.payload)
      const fields = decodeResult(toolPayload, metadata).data
      const presentation = toolPresentation(call.payload, call.summary, undefined, metadata)
      const apps = mcpAppReferences(metadata)
      const artifacts = artifactReferences(metadata)
      const images = toolImageReferences(metadata)
      if (!images.length)
        for (const image of call === event ? originalImages : toolImages(metadata)) {
          const index = originalImages.findIndex((original) => original.uri === image.uri)
          if (index >= 0) images.push({ eventId: event.id, index, mime: image.mime })
        }
      return {
        ...call,
        payload: JSON.stringify({
          ...fields,
          presentation: {
            ...presentation,
            input: presentation.kind === 'command' ? presentation.input : '',
            output: '',
            // Compact search keeps its pattern in `detail`; otherwise mark that context
            // still has to be derived from the retained raw args.
            ...(presentation.kind === 'search' && !presentation.detail ? { contextAt: 1 } : {}),
          },
          ...(apps.length ? { mcpApps: apps } : {}),
          ...(artifacts.length ? { artifacts } : {}),
          ...(images.length ? { toolImages: images } : {}),
        }),
      }
    })
  })
}

/** Owned by one subscribed scope; discarded events release their raw payloads immediately. */
export function createActivityCompactor() {
  let retained = new Map<string, { source: Event; events: Event[] }>()
  return (events: Event[]): Event[] => {
    const next = new Map<string, { source: Event; events: Event[] }>()
    const compact = events.flatMap((event) => {
      const old = retained.get(event.id)
      const entry =
        old && sameActivityEvent(old.source, event)
          ? old
          : { source: event, events: compactActivityEvents([event]) }
      next.set(event.id, entry)
      return entry.events
    })
    retained = next
    return compact
  }
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
        old.textOffset === tool.textOffset &&
        old.messageId === tool.messageId
        ? old
        : tool
    })
    if (next.length !== previous.length || next.some((tool, index) => tool !== previous[index]))
      previous = next
    return previous
  }
}
