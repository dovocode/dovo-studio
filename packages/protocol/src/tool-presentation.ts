import { z } from 'zod'
import type { recentTools } from './activity.js'

const record = z.record(z.string(), z.unknown())
const object = (value: unknown) => record.safeParse(value).data ?? {}
const parse = (value: string): unknown => {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}
const text = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('\n')
  const data = object(value)
  if (typeof data.text === 'string') return data.text
  if (data.content !== undefined) return text(data.content)
  return ''
}
const argument = (value: unknown) => object(typeof value === 'string' ? parse(value) : value)
export type ToolKind = 'computer' | 'command' | 'web' | 'file' | 'tool' | 'reasoning'
export type ToolPresentation = { title: string; input: string; output: string; kind: ToolKind }

/** Extract displayable tool data without exposing transport envelopes or image blobs. */
export function toolPresentation(
  payload: string,
  summary: string,
  inputPayload?: string,
): ToolPresentation {
  const parsed = parse(payload)
  if (parsed === undefined) return { title: summary, input: '', output: payload, kind: 'tool' }
  const envelope = object(parsed)
  const reasoning = object(envelope.reasoning)
  if (typeof reasoning.text === 'string')
    return { title: 'Reasoning', input: '', output: reasoning.text, kind: 'reasoning' }
  const event = object(envelope.event)
  const item = object(event.item)
  const part = object(object(event.properties).part)
  const state = object(part.state)
  const update = object(event.update)
  const blocks = z.array(record).safeParse(object(event.message).content).data ?? []
  const tool = blocks.find((block) => block.type === 'tool_use')
  const args = {
    ...argument(item.arguments),
    ...argument(item.input),
    ...object(tool?.input),
    ...object(state.input),
    ...object(update.rawInput),
  }
  const name = text(item.tool) || text(tool?.name) || text(part.tool) || summary
  const command = text(item.command) || text(args.command) || text(args.cmd)
  const query = text(item.query) || text(args.query) || text(args.q)
  const path = text(args.file_path) || text(args.path) || text(args.filePath)
  const computer =
    /(?:computer|cua[_./]|cua$|browser[_./](?:click|type|navigate|snapshot)|playwright)/i.test(
      `${text(item.server)} ${name}`,
    )
  const kind: ToolKind = computer
    ? 'computer'
    : command ||
        item.type === 'commandExecution' ||
        /^(?:bash|exec_command|run_command|shell)$/i.test(name)
      ? 'command'
      : item.type === 'webSearch' || /(?:web[_ ]?search|search_query|web_fetch)/i.test(name)
        ? 'web'
        : item.type === 'fileChange' ||
            /^(?:read|edit|write|apply_patch|read_file|edit_file|write_file)$/i.test(name)
          ? 'file'
          : 'tool'
  const changes = z.array(z.object({ path: z.string() })).safeParse(item.changes).data
  const output =
    text(item.aggregatedOutput) ||
    text(item.output) ||
    text(item.result) ||
    text(state.output) ||
    text(update.content) ||
    text(update.rawOutput) ||
    blocks
      .filter((block) => block.type === 'tool_result')
      .map((block) => text(block.content))
      .join('\n') ||
    changes?.map((change) => change.path).join('\n') ||
    text(item.error) ||
    text(state.error)
  const explicitTitle =
    text(args.title) || text(args.description) || text(state.title) || text(update.title)
  const title =
    explicitTitle || command || query || path || (kind === 'computer' ? 'Computer Use' : name)
  const input =
    command ||
    query ||
    path ||
    text(args.code) ||
    text(args.url) ||
    text(args.patch) ||
    text(args.input)
  const result = { title, input, output, kind }
  if (!inputPayload || inputPayload === payload) return result
  const start = toolPresentation(inputPayload, summary)
  return {
    ...result,
    title:
      explicitTitle ||
      (start.title !== 'Tool result' && start.title !== 'Tool update' ? start.title : title),
    kind: kind === 'tool' ? start.kind : kind,
    input: input || start.input,
  }
}

export function activitySummary(tools: ReturnType<typeof recentTools>): string {
  const counts: Record<ToolKind, number> = {
    computer: 0,
    command: 0,
    web: 0,
    file: 0,
    tool: 0,
    reasoning: 0,
  }
  for (const tool of tools)
    counts[toolPresentation(tool.payload, tool.summary, tool.inputPayload).kind]++
  const clauses = [
    counts.computer ? 'used Computer Use' : '',
    counts.command ? `ran ${counts.command} command${counts.command === 1 ? '' : 's'}` : '',
    counts.web ? `searched the web ${counts.web} time${counts.web === 1 ? '' : 's'}` : '',
    counts.file ? `${counts.file} file operation${counts.file === 1 ? '' : 's'}` : '',
    counts.tool ? `used ${counts.tool} tool${counts.tool === 1 ? '' : 's'}` : '',
  ].filter(Boolean)
  const sentence =
    clauses.length > 2
      ? `${clauses.slice(0, -1).join(', ')}, and ${clauses.at(-1)}`
      : clauses.join(' and ')
  return sentence
    ? sentence[0]!.toUpperCase() + sentence.slice(1)
    : counts.reasoning
      ? 'Reasoning'
      : 'Activity'
}
