import { mutableArray, claudeToolStatus } from '@dovo/protocol'
import { decodeResult } from '@dovo/protocol'
import { Schema } from 'effect'
import type { Agent } from '@dovo/protocol'
const record = Schema.Record(Schema.String, Schema.mutableKey(Schema.Unknown))
const object = (value: unknown) => decodeResult(record, value).data ?? {}
const string = (value: unknown) => (typeof value === 'string' ? value : '')
function parseArgs(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return object(value)
  try {
    return object(JSON.parse(value))
  } catch {
    return {}
  }
}
const argText = (value: unknown) => (typeof value === 'string' ? value : '')
const truncate = (value: string) => (value.length > 120 ? `${value.slice(0, 117)}…` : value)
export function toolEvent(provider: Agent['provider'], name: string, payload: unknown) {
  const data = object(payload)
  if (provider === 'codex' && ['item/started', 'item/completed'].includes(name)) {
    const item = object(data.item),
      type = string(item.type)
    if (
      ![
        'commandExecution',
        'fileChange',
        'mcpToolCall',
        'webSearch',
        'dynamicToolCall',
        'imageGeneration',
        'imageView',
      ].includes(type)
    )
      return
    return {
      toolId: string(item.id),
      title:
        type === 'imageGeneration'
          ? 'Generate image'
          : type === 'imageView'
            ? 'View image'
            : string(item.command) || string(item.tool) || type,
      status: name.endsWith('completed')
        ? item.failure
          ? 'failed'
          : string(item.status) || 'completed'
        : 'running',
    }
  }
  if (provider === 'vibe' && name === 'vibe/effect') {
    const entry = object(data.entry)
    const state = object(entry.state)
    return {
      toolId: string(entry.id),
      title: string(entry.title) || string(object(entry.detail).toolName) || 'Vibe tool',
      status: string(state.status) || 'running',
    }
  }
  if (provider === 'cursor' && name === 'cursor/tool_call')
    return {
      toolId: string(data.call_id),
      title: string(data.name) || 'Cursor tool',
      status: data.status === 'error' ? 'failed' : string(data.status) || 'running',
    }
  if (provider === 'claude') {
    const blocks = decodeResult(mutableArray(record), object(data.message).content).data ?? []
    const tools = blocks.filter((b) => claudeToolStatus(b) !== undefined)
    if (!tools.length) return
    return {
      toolId: tools.map((b) => string(b.id) || string(b.tool_use_id)).join(','),
      title: tools.map((b) => string(b.name) || 'Tool result').join(', '),
      status: tools.some((b) => claudeToolStatus(b) === 'failed')
        ? 'failed'
        : claudeToolStatus(tools[0]) === 'running'
          ? 'running'
          : 'completed',
    }
  }
  if (provider === 'acp' || provider === 'grok') {
    const update = object(data.update)
    if (!['tool_call', 'tool_call_update'].includes(string(update.sessionUpdate))) return
    return {
      toolId: string(update.toolCallId),
      title: string(update.title) || 'Tool update',
      status: string(update.status) || 'running',
    }
  }
  if (provider === 'hermes' && ['tool.start', 'tool.complete'].includes(name))
    return {
      toolId: string(data.tool_id),
      title: string(data.name) || 'Hermes tool',
      status:
        name === 'tool.start' ? 'running' : object(data.result).error ? 'failed' : 'completed',
    }
  if (provider === 'copilot' && ['tool.execution_start', 'tool.execution_complete'].includes(name))
    return {
      toolId: string(data.toolCallId),
      title: string(data.toolName) || 'Copilot tool',
      status:
        name === 'tool.execution_start'
          ? 'running'
          : data.success === false
            ? 'failed'
            : 'completed',
    }
  if (provider === 'muse' && ['item/started', 'item/updated', 'item/completed'].includes(name)) {
    const item = object(data.item)
    if (!['toolCall', 'userShell', 'subagent', 'workflow'].includes(string(item.kind))) return
    const tool = string(item.tool)
    // Muse tool items carry their arguments as JSON in `item.args` and never set an
    // explicit title, so derive the row label from the call's own context here; the
    // client re-derives the same context from the retained payload for detail rows.
    const args = parseArgs(item.args)
    const command = argText(item.commandText) || argText(args.command) || argText(args.cmd)
    const target =
      argText(args.file_path) ||
      argText(args.path) ||
      argText(args.filePath) ||
      (Array.isArray(args.paths)
        ? args.paths.filter((value): value is string => typeof value === 'string').join(', ')
        : '')
    const base = target ? target.split(/[\\/]/).at(-1) || target : ''
    const title = command
      ? command
      : /^(?:search|grep|glob)$/i.test(tool)
        ? `Search ${truncate(argText(args.pattern) || argText(args.query) || argText(args.glob) || tool)}`
        : base
          ? `${/edit|patch/i.test(tool) ? 'Edit' : /write/i.test(tool) ? 'Write' : 'Read'} ${base}`
          : tool || string(item.fallbackText) || string(item.kind)
    return {
      toolId: string(item.itemId),
      title,
      status:
        item.status === 'inProgress'
          ? 'running'
          : item.status === 'failed' || item.failureKind
            ? 'failed'
            : string(item.status) || 'completed',
    }
  }
  if (provider === 'opencode' && name === 'message.part.updated') {
    const part = object(object(data.properties).part),
      state = object(part.state)
    if (part.type !== 'tool') return
    return {
      toolId: string(part.callID) || string(part.id),
      title: string(state.title) || string(part.tool) || 'Tool',
      status: string(state.status) || 'running',
    }
  }
}
