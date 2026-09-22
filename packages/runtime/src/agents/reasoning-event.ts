import { z } from 'zod'
import type { Agent } from '@dovo/protocol'

const record = z.record(z.string(), z.unknown())
const object = (value: unknown) => record.safeParse(value).data ?? {}
const string = (value: unknown) => (typeof value === 'string' ? value : '')
const MAX_TEXT = 64000
export type ReasoningActivityRow = {
  toolId: string
  status: 'running' | 'completed'
  reasoning: { text: string }
}
type Entry = { text: string; status: ReasoningActivityRow['status']; parts?: Map<number, string> }

/** Collect only the provider's exposed summary/thinking text, never opaque reasoning data. */
export class ReasoningEvents {
  private entries = new Map<string, Entry>()
  private dirty = new Set<string>()
  private timer?: ReturnType<typeof setTimeout>
  private claudeMessages = new Map<string, string>()
  private acpGroup = 0
  private acpActive = false
  constructor(
    private provider: Agent['provider'],
    private emit: (row: ReasoningActivityRow) => void,
  ) {}

  private set(id: string, text: string, status: Entry['status'], parts?: Map<number, string>) {
    const previous = this.entries.get(id)
    text = text.slice(0, MAX_TEXT)
    status = previous?.status === 'completed' ? 'completed' : status
    this.entries.set(id, { text, status, ...(parts ? { parts } : {}) })
    if (previous?.text === text && previous.status === status) return
    this.dirty.add(id)
    if (status === 'completed') this.flush()
    else this.timer ??= setTimeout(() => this.flush(), 100)
  }
  private append(id: string, text: string) {
    const previous = this.entries.get(id)
    this.set(id, (previous?.text ?? '') + text, previous?.status ?? 'running')
  }
  private complete(id: string) {
    const previous = this.entries.get(id)
    if (previous) this.set(id, previous.text, 'completed', previous.parts)
  }
  private flush() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    for (const id of this.dirty) {
      const entry = this.entries.get(id)!
      if (entry.text.trim())
        this.emit({
          toolId: `reasoning:${id}`,
          status: entry.status,
          reasoning: { text: entry.text },
        })
    }
    this.dirty.clear()
  }
  finish() {
    for (const [id, entry] of this.entries) {
      if (entry.status === 'running') {
        entry.status = 'completed'
        this.dirty.add(id)
      }
    }
    this.flush()
  }

  /** True means this event is reasoning-only and should not become a raw activity row. */
  accept(name: string, value: unknown): boolean {
    const data = object(value)
    if (this.provider === 'codex') {
      const item = object(data.item)
      if (['item/started', 'item/completed'].includes(name) && item.type === 'reasoning') {
        const itemId = string(item.id)
        if (!itemId) return true
        const id = `codex:${itemId}`
        const summary = z.array(z.string()).safeParse(item.summary).data
        if (summary?.length)
          this.set(
            id,
            summary.join('\n\n'),
            name === 'item/completed' ? 'completed' : 'running',
            new Map(summary.map((text, index) => [index, text])),
          )
        else if (name === 'item/completed') this.complete(id)
        return true
      }
      if (name === 'item/reasoning/summaryTextDelta') {
        const parsed = z
          .object({
            itemId: z.string().min(1),
            summaryIndex: z.number().int().min(0).max(1000),
            delta: z.string(),
          })
          .safeParse(data)
        if (parsed.success) {
          const { itemId, summaryIndex, delta } = parsed.data
          const id = `codex:${itemId}`
          const parts = new Map(this.entries.get(id)?.parts)
          parts.set(summaryIndex, ((parts.get(summaryIndex) ?? '') + delta).slice(0, MAX_TEXT))
          this.set(
            id,
            [...parts.entries()]
              .sort(([a], [b]) => a - b)
              .map(([, text]) => text)
              .join('\n\n'),
            'running',
            parts,
          )
        }
        return true
      }
      // Raw content deltas and encrypted data are not user-visible summaries.
      return name.startsWith('item/reasoning/')
    }
    if (this.provider === 'claude') {
      const parent = string(data.parent_tool_use_id)
      const event = object(data.event)
      if (name === 'stream_event') {
        if (event.type === 'message_start') {
          const messageId = string(object(event.message).id)
          if (messageId) this.claudeMessages.set(parent, messageId)
        }
        const messageId = this.claudeMessages.get(parent)
        const index = typeof event.index === 'number' ? event.index : undefined
        const id = messageId && index !== undefined ? `claude:${parent}:${messageId}:${index}` : ''
        const block = object(event.content_block)
        const delta = object(event.delta)
        if (
          event.type === 'content_block_start' &&
          ['thinking', 'redacted_thinking'].includes(string(block.type))
        ) {
          if (id && block.type === 'thinking') this.set(id, string(block.thinking), 'running')
          return true
        }
        if (
          event.type === 'content_block_delta' &&
          ['thinking_delta', 'signature_delta'].includes(string(delta.type))
        ) {
          if (id && delta.type === 'thinking_delta' && this.entries.has(id))
            this.append(id, string(delta.thinking))
          return true
        }
        if (event.type === 'content_block_stop' && id && this.entries.has(id)) {
          this.complete(id)
          return true
        }
        if (event.type === 'message_stop' && messageId) {
          for (const key of this.entries.keys())
            if (key.startsWith(`claude:${parent}:${messageId}:`)) this.complete(key)
          this.claudeMessages.delete(parent)
        }
      }
      if (name === 'assistant') {
        const message = object(data.message)
        const blocks = z.array(record).safeParse(message.content).data ?? []
        const messageId = string(message.id)
        blocks.forEach((block, index) => {
          if (block.type !== 'thinking' || !messageId || typeof block.thinking !== 'string') return
          const prefix = `claude:${parent}:${messageId}:`
          const existing = [...this.entries.entries()].find(
            ([key, entry]) =>
              key.startsWith(prefix) &&
              typeof block.thinking === 'string' &&
              block.thinking.slice(0, MAX_TEXT) === entry.text,
          )
          const id = existing?.[0] ?? `${prefix}final:${string(data.uuid)}:${index}`
          this.set(id, block.thinking, 'completed')
        })
        return (
          blocks.length > 0 &&
          blocks.every((block) => ['thinking', 'redacted_thinking'].includes(string(block.type)))
        )
      }
    }
    if (this.provider === 'acp') {
      const update = object(data.update)
      if (update.sessionUpdate === 'agent_thought_chunk') {
        const content = object(update.content)
        if (!this.acpActive) {
          this.acpGroup++
          this.acpActive = true
        }
        if (content.type === 'text') this.append(`acp:${this.acpGroup}`, string(content.text))
        return true
      }
      if (
        this.acpActive &&
        ['agent_message_chunk', 'tool_call'].includes(string(update.sessionUpdate))
      ) {
        this.complete(`acp:${this.acpGroup}`)
        this.acpActive = false
      }
    }
    if (this.provider === 'opencode') {
      const properties = object(data.properties)
      const part = object(properties.part)
      if (name === 'message.part.updated' && part.type === 'reasoning') {
        const id = string(part.id)
        if (id)
          this.set(
            `opencode:${id}`,
            string(part.text),
            typeof object(part.time).end === 'number' ? 'completed' : 'running',
          )
        return true
      }
      const id = `opencode:${string(properties.partID)}`
      if (name === 'message.part.delta' && properties.field === 'text' && this.entries.has(id)) {
        this.append(id, string(properties.delta))
        return true
      }
    }
    return false
  }
}

/** Raw diagnostics may contain mixed tool/thinking blocks; strip private opaque fields. */
export function safeReasoningEvent(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(safeReasoningEvent)
  if (!value || typeof value !== 'object') return value
  const data = object(value)
  if (data.type === 'redacted_thinking') return { type: data.type }
  return Object.fromEntries(
    Object.entries(data)
      .filter(
        ([key]) =>
          !['signature', 'encrypted_content', 'encryptedContent'].includes(key) &&
          !(data.type === 'reasoning' && key === 'content'),
      )
      .map(([key, item]) => [key, safeReasoningEvent(item)]),
  )
}
