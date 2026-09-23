import { mutableArray } from '@dovo/protocol'
import { decodeResult } from '@dovo/protocol'
import { Schema } from 'effect'
import type { Agent } from '@dovo/protocol'
const record = Schema.mutable(
  Schema.Record({
    key: Schema.String,
    value: Schema.Unknown,
  }),
)
const object = (value: unknown) => decodeResult(record, value).data ?? {}
const string = (value: unknown) => (typeof value === 'string' ? value : '')
export function toolEvent(provider: Agent['provider'], name: string, payload: unknown) {
  const data = object(payload)
  if (provider === 'codex' && ['item/started', 'item/completed'].includes(name)) {
    const item = object(data.item),
      type = string(item.type)
    if (
      !['commandExecution', 'fileChange', 'mcpToolCall', 'webSearch', 'dynamicToolCall'].includes(
        type,
      )
    )
      return
    return {
      toolId: string(item.id),
      title: string(item.command) || string(item.tool) || type,
      status: name.endsWith('completed') ? string(item.status) || 'completed' : 'running',
    }
  }
  if (provider === 'claude') {
    const blocks = decodeResult(mutableArray(record), object(data.message).content).data ?? []
    const tools = blocks.filter((b) => b.type === 'tool_use' || b.type === 'tool_result')
    if (!tools.length) return
    return {
      toolId: tools.map((b) => string(b.id) || string(b.tool_use_id)).join(','),
      title: tools.map((b) => string(b.name) || 'Tool result').join(', '),
      status: tools.some((b) => b.is_error === true)
        ? 'failed'
        : tools[0].type === 'tool_use'
          ? 'running'
          : 'completed',
    }
  }
  if (provider === 'acp') {
    const update = object(data.update)
    if (!['tool_call', 'tool_call_update'].includes(string(update.sessionUpdate))) return
    return {
      toolId: string(update.toolCallId),
      title: string(update.title) || 'Tool update',
      status: string(update.status) || 'running',
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
