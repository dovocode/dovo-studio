import { decodeResult, mutableArray, type NativeThreadEntry } from '@dovo/protocol'
import { Schema } from 'effect'

const record = Schema.Record(Schema.String, Schema.mutableKey(Schema.Unknown))
const object = (value: unknown) => decodeResult(record, value).data ?? {}
const items = (value: unknown) => decodeResult(mutableArray(record), value).data ?? []
const text = (value: unknown) => (typeof value === 'string' ? value : '')
const bounded = (value: string) => (value.length > 16000 ? `${value.slice(0, 16000)}\n…` : value)

/** Provider transcripts are read on demand, never added to workspace snapshots. */
export function codexThreadEntries(value: unknown): NativeThreadEntry[] {
  const thread = object(object(value).thread)
  return items(thread.turns).flatMap((turn) =>
    items(turn.items).flatMap((item, index) => {
      const id = text(item.id) || `${text(turn.id)}:${index}`
      const entry = (role: NativeThreadEntry['role'], value: string, label?: string) =>
        value ? [{ id, role, text: bounded(value), ...(label ? { label } : {}) }] : []
      if (item.type === 'userMessage')
        return entry(
          'user',
          items(item.content)
            .map((part) => text(part.text))
            .filter(Boolean)
            .join('\n'),
        )
      if (item.type === 'agentMessage') return entry('assistant', text(item.text))
      if (item.type === 'reasoning') {
        const summary = decodeResult(mutableArray(Schema.String), item.summary).data ?? []
        return entry('reasoning', summary.join('\n'))
      }
      if (item.type === 'commandExecution')
        return entry(
          'tool',
          [text(item.command), text(item.aggregatedOutput)].filter(Boolean).join('\n'),
          'Command',
        )
      if (item.type === 'fileChange')
        return entry(
          'tool',
          items(item.changes)
            .map((change) => [text(change.path), text(change.diff)].filter(Boolean).join('\n'))
            .filter(Boolean)
            .join('\n'),
          'File changes',
        )
      if (item.type === 'mcpToolCall' || item.type === 'dynamicToolCall') {
        const result = object(item.result)
        const output = [
          text(result.text),
          ...items(result.content ?? item.contentItems).map((part) => text(part.text)),
          text(object(item.error).message),
        ]
          .filter(Boolean)
          .join('\n')
        const name = [text(item.server), text(item.tool) || text(item.toolName)]
          .filter(Boolean)
          .join(' / ')
        return entry(
          'tool',
          [item.arguments === undefined ? '' : JSON.stringify(item.arguments), output]
            .filter(Boolean)
            .join('\n') || name,
          name || 'Tool call',
        )
      }
      return []
    }),
  )
}

export function claudeThreadEntries(
  messages: readonly { uuid: string; type: string; message: unknown }[],
): NativeThreadEntry[] {
  return messages
    .flatMap((message) => {
      const content = object(message.message).content
      if (typeof content === 'string')
        return [
          {
            id: message.uuid,
            role: message.type === 'user' ? ('user' as const) : ('assistant' as const),
            text: bounded(content),
          },
        ]
      return items(content).flatMap((block, index): NativeThreadEntry[] => {
        const id = `${message.uuid}:${index}`
        if (block.type === 'text')
          return [
            {
              id,
              role: message.type === 'user' ? 'user' : 'assistant',
              text: bounded(text(block.text)),
            },
          ]
        if (block.type === 'thinking')
          return [{ id, role: 'reasoning', text: bounded(text(block.thinking)) }]
        if (block.type === 'tool_use')
          return [
            {
              id,
              role: 'tool',
              label: text(block.name),
              text: bounded(JSON.stringify(block.input ?? {})),
            },
          ]
        if (block.type === 'tool_result') {
          const value =
            typeof block.content === 'string'
              ? block.content
              : items(block.content)
                  .map((part) => text(part.text))
                  .join('\n')
          return [{ id, role: 'tool', label: 'Tool result', text: bounded(value) }]
        }
        return []
      })
    })
    .filter((entry) => entry.text)
}

export function opencodeThreadEntries(value: unknown): NativeThreadEntry[] {
  return items(value)
    .flatMap((message, index) => {
      const info = object(message.info)
      const id = text(message.id) || text(info.id) || String(index)
      if (message.type === 'user' && text(message.text))
        return [{ id, role: 'user' as const, text: bounded(text(message.text)) }]
      const role = info.role === 'user' || message.type === 'user' ? 'user' : 'assistant'
      return items(message.parts ?? message.content).flatMap((part, index): NativeThreadEntry[] => {
        const entryId = text(part.id) || `${id}:${index}`
        if (part.type === 'text' || part.type === 'reasoning')
          return [
            {
              id: entryId,
              role: part.type === 'reasoning' ? 'reasoning' : role,
              text: bounded(text(part.text)),
            },
          ]
        if (part.type === 'tool') {
          const state = object(part.state)
          return [
            {
              id: entryId,
              role: 'tool',
              label: text(part.tool) || 'Tool',
              text: bounded(
                [
                  JSON.stringify(state.input ?? part.input ?? {}),
                  text(state.output) || text(state.error),
                ]
                  .filter(Boolean)
                  .join('\n'),
              ),
            },
          ]
        }
        return []
      })
    })
    .filter((entry) => entry.text)
}
