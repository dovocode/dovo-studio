import { mutableArray, mutableStruct } from '../../shared/schema.js'
import { decodeResult } from '../../shared/schema.js'
import { Schema } from 'effect'
import type { recentTools } from '../../automation/activity.js'
const record = Schema.Record(Schema.String, Schema.mutableKey(Schema.Unknown))
const object = (value: unknown) => decodeResult(record, value).data ?? {}
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
export type ToolKind = 'computer' | 'command' | 'web' | 'search' | 'file' | 'tool' | 'reasoning'
export type ToolPresentation = Readonly<{
  title: string
  input: string
  output: string
  kind: ToolKind
  /** One-line context beside the title: bash description, read range, edit diff counts, search pattern. */
  detail?: string
  /** Unified diff text for file edits, when the harness recorded one. */
  diff?: string
}>

// Shared by rows, group summaries and reasoning classification on desktop and mobile.
// Bound both entry count and retained strings; large tool output is never retained here.
const MAX_PRESENTATIONS = 256
const MAX_PRESENTATION_CHARS = 2_000_000
const presentations = new Map<
  string,
  {
    summary: string
    inputPayload?: string
    result: ToolPresentation
    size: number
  }
>()
let presentationChars = 0

/** Extract displayable tool data without exposing transport envelopes or image blobs. */
export function toolPresentation(
  payload: string,
  summary: string,
  inputPayload?: string,
  parsed?: unknown,
): ToolPresentation {
  const cached = presentations.get(payload)
  if (cached?.summary === summary && cached.inputPayload === inputPayload) {
    presentations.delete(payload)
    presentations.set(payload, cached)
    return cached.result
  }
  if (cached) {
    presentations.delete(payload)
    presentationChars -= cached.size
  }
  const result = Object.freeze(computePresentation(payload, summary, inputPayload, parsed))
  const size =
    payload.length +
    summary.length +
    (inputPayload?.length ?? 0) +
    result.title.length +
    result.input.length +
    result.output.length +
    (result.detail?.length ?? 0) +
    (result.diff?.length ?? 0)
  if (size > MAX_PRESENTATION_CHARS) return result
  while (
    presentations.size >= MAX_PRESENTATIONS ||
    presentationChars + size > MAX_PRESENTATION_CHARS
  ) {
    const oldest = presentations.keys().next().value
    if (oldest === undefined) break
    presentationChars -= presentations.get(oldest)!.size
    presentations.delete(oldest)
  }
  presentations.set(payload, { summary, inputPayload, result, size })
  presentationChars += size
  return result
}

function computePresentation(
  payload: string,
  summary: string,
  inputPayload?: string,
  parsed: unknown = parse(payload),
): ToolPresentation {
  if (parsed === undefined)
    return {
      title: summary,
      input: '',
      output: payload,
      kind: 'tool',
    }
  const envelope = object(parsed)
  const compact = decodeResult(
    mutableStruct({
      title: Schema.String,
      input: Schema.String,
      output: Schema.String,
      kind: Schema.Literals(['computer', 'command', 'web', 'search', 'file', 'tool', 'reasoning']),
      detail: Schema.optional(Schema.String),
      diff: Schema.optional(Schema.String),
      contextAt: Schema.optional(
        Schema.Number.pipe(Schema.check(Schema.isFinite()), Schema.check(Schema.isInt())),
      ),
    }),
    envelope.presentation,
  ).data
  if (compact) {
    // Compacted starts lose the raw args; deriving context again is only safe while the
    // full raw payload is retained. The marker keeps later raw updates on this path.
    if (compact.kind === 'search' && !compact.contextAt) return computePresentation(payload, summary)
    if (!inputPayload || inputPayload === payload) return compact
    const start = toolPresentation(inputPayload, summary)
    return {
      ...compact,
      title: ['Tool result', 'Tool update'].includes(compact.title) ? start.title : compact.title,
      kind: compact.kind === 'tool' ? start.kind : compact.kind,
      input: compact.input || start.input,
      detail: compact.detail ?? start.detail,
      diff: compact.diff ?? start.diff,
    }
  }
  const reasoning = object(envelope.reasoning)
  if (typeof reasoning.text === 'string')
    return recomputeFromInput(
      {
        title: 'Reasoning',
        input: '',
        output: reasoning.text,
        kind: 'reasoning',
      },
      payload,
      summary,
      inputPayload,
    )
  const event = object(envelope.event)
  const item = object(event.item)
  const part = object(object(event.properties).part)
  const state = object(part.state)
  const update = object(event.update)
  const blocks = decodeResult(mutableArray(record), object(event.message).content).data ?? []
  const tool = blocks.find((block) => block.type === 'tool_use')
  const args = {
    ...argument(item.arguments),
    ...argument(item.args),
    ...argument(item.input),
    ...object(tool?.input),
    ...object(state.input),
    ...object(update.rawInput),
  }
  const name = text(item.tool) || text(tool?.name) || text(part.tool) || summary
  const command = text(item.command) || text(args.command) || text(args.cmd)
  const paths = Array.isArray(args.paths)
    ? args.paths.filter((value): value is string => typeof value === 'string')
    : []
  const path =
    text(args.file_path) || text(args.path) || text(args.filePath) || paths.join(', ')
  const computer =
    /(?:computer|cua[_./]|cua$|browser[_./](?:click|type|navigate|snapshot)|playwright)/i.test(
      `${text(item.server)} ${name}`,
    )
  const search =
    /^(?:search|grep|glob|find|list_files|list_dir|find_files)$/i.test(name) ||
    (typeof args.pattern === 'string' && !command && !path)
  const query =
    text(item.query) ||
    text(args.query) ||
    text(args.q) ||
    text(args.pattern) ||
    text(args.glob) ||
    (search ? text(args.search) : '')
  const kind: ToolKind = computer
    ? 'computer'
    : command || item.type === 'commandExecution' || /^(?:bash|exec_command|run_command|shell)$/i.test(name)
      ? 'command'
      : item.type === 'webSearch' || /(?:web[_ ]?search|search_query|web_fetch)/i.test(name)
        ? 'web'
        : search
          ? 'search'
          : item.type === 'fileChange' ||
              /^(?:read|edit|write|apply_patch|read_file|edit_file|write_file)$/i.test(name)
            ? 'file'
            : 'tool'
  const changes = decodeResult(
    mutableArray(
      mutableStruct({
        path: Schema.String,
      }),
    ),
    item.changes,
  ).data
  const patch = decodeResult(
    mutableStruct({
      added: Schema.Number,
      files: Schema.Number,
      removed: Schema.Number,
    }),
    item.patchSummary,
  ).data
  const patchCounts = patch
    ? `${patch.added ? `+${patch.added}` : ''}${patch.added && patch.removed ? ' ' : ''}${patch.removed ? `−${patch.removed}` : ''}`
    : ''
  // Explicit provider titles and tool `description` arguments describe intent. On a
  // command they describe the run itself, so they never displace the command text.
  const explicitTitle =
    text(item.fallbackText) ||
    text(args.title) ||
    text(state.title) ||
    text(update.title) ||
    (kind === 'command' ? '' : text(args.description))
  // A read reports the lines it returned; an edit reports its diff. Neither is an argument.
  const visible = text(item.visibleOutput)
  let detail: string | undefined
  let diff: string | undefined
  let suppressOutput = false
  if (kind === 'command') detail = text(args.description) || undefined
  else if (search) detail = query || undefined
  else if (kind === 'file' && path) {
    const numbered = visible.match(/^\s*\d+\|/gm)
    const firstLine = /^.*?^\s*(\d+)\|/ms.exec(visible)?.[1]
    if (firstLine && numbered?.length)
      detail = `${path} · lines ${firstLine}–${Number(firstLine) + numbered.length - 1}`
    const lines = visible.split('\n')
    const hunk = lines.findIndex((line) => line.startsWith('@@'))
    if (
      item.kind === 'toolCall' &&
      hunk > 0 &&
      /^(?:edited|updated|edit applied)\b/i.test(visible) &&
      lines.slice(0, hunk).some((line) => line.startsWith('--- ')) &&
      lines.slice(0, hunk).some((line) => line.startsWith('+++ '))
    ) {
      diff = lines.slice(hunk).join('\n')
      suppressOutput = true
    }
    if (diff) detail = `${path}${patchCounts ? ` · ${patchCounts}` : ''}`
    else if (!detail && item.kind === 'toolCall')
      detail = `${path}${patchCounts ? ` · ${patchCounts}` : ''}`
    if (typeof args.content === 'string') {
      const count = args.content.split('\n').length
      detail = `${path} · ${count} line${count === 1 ? '' : 's'}`
    }
  }
  const output = suppressOutput
    ? ''
    : text(item.aggregatedOutput) ||
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
      text(state.error) ||
      visible
  const title =
    kind === 'computer'
      ? explicitTitle || 'Computer Use'
      : kind === 'command'
        ? command || name
        : search
          ? query
            ? `Search ${truncate(query)}`
            : 'Search'
          : kind === 'file' && path
            ? /edit|patch/i.test(name)
              ? `Edit ${baseName(path)}`
              : /write/i.test(name)
                ? `Write ${baseName(path)}`
                : `Read ${baseName(path)}`
            : explicitTitle || command || query || path || name
  const input =
    command ||
    query ||
    path ||
    text(args.code) ||
    text(args.url) ||
    text(args.patch) ||
    text(args.input)
  return recomputeFromInput({ title, input, output, kind, detail, diff }, payload, summary, inputPayload)
}

function recomputeFromInput(
  result: ToolPresentation,
  payload: string,
  summary: string,
  inputPayload?: string,
): ToolPresentation {
  if (!inputPayload || inputPayload === payload) return result
  const start = toolPresentation(inputPayload, summary)
  const generic =
    result.title === 'Tool result' ||
    result.title === 'Tool update' ||
    result.kind === 'tool' ||
    result.title === 'Reasoning'
  return {
    ...result,
    title:
      result.kind === 'command' && start.title
        ? start.title
        : generic && start.title !== 'Tool result' && start.title !== 'Tool update'
          ? start.title
          : result.title,
    kind: result.kind === 'tool' ? start.kind : result.kind,
    input: result.input || start.input,
    detail: result.detail ?? start.detail,
    diff: result.diff ?? start.diff,
  }
}

function baseName(filePath: string) {
  return filePath.split(/[\\/]/).at(-1) || filePath
}

function truncate(value: string) {
  return value.length > 120 ? `${value.slice(0, 117)}…` : value
}
export function activitySummary(tools: ReturnType<typeof recentTools>): string {
  const counts: Record<ToolKind, number> = {
    computer: 0,
    command: 0,
    web: 0,
    search: 0,
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
    counts.search ? `searched ${counts.search} time${counts.search === 1 ? '' : 's'}` : '',
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
