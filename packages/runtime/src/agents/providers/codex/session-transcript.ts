import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { Schema } from 'effect'
import { decodeResult, type ChatMessage } from '@dovo/protocol'
import { HttpError } from '../../../errors.js'

const objectSchema = Schema.Record(Schema.String, Schema.mutableKey(Schema.Unknown))
const object = (value: unknown) => decodeResult(objectSchema, value).data ?? {}
const string = (value: unknown) => (typeof value === 'string' ? value : '')
const textParts = (value: unknown) => {
  const parts = decodeResult(Schema.Array(objectSchema), value).data ?? []
  return parts
    .filter((part) => ['input_text', 'output_text', 'text'].includes(string(part.type)))
    .map((part) => string(part.text))
    .filter(Boolean)
    .join('\n')
}

export function codexSessionMetadata(line: string) {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return undefined
  }
  const row = object(value),
    payload = object(row.payload)
  if (row.type !== 'session_meta') return undefined
  const id = string(payload.id),
    cwd = string(payload.cwd)
  if (!/^[a-zA-Z0-9-]{1,200}$/.test(id) || !cwd) return undefined
  // Native child and Dovo app-server sessions already have an owning conversation.
  if (typeof payload.source !== 'string' || !['cli', 'exec'].includes(payload.source))
    return undefined
  if (string(payload.originator).toLowerCase().includes('dovo')) return undefined
  return { id, cwd, timestamp: string(row.timestamp) }
}

/** Discovery stops at the metadata line; it never parses conversation records. */
export const readCodexSessionHeader = (path: string) => readCodexFile(path, 'header')
/** Only the explicitly selected session is eligible for a complete transcript read. */
export const readCodexTranscript = (path: string) => readCodexFile(path, 'transcript')

async function readCodexFile(path: string, mode: 'header' | 'transcript') {
  const header = mode === 'header'
  const limit = header ? 64 * 1024 : 16 * 1024 * 1024
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const info = await file.stat()
    if (!info.isFile()) throw new HttpError(409, 'The Codex transcript is not a regular file')
    if (!header && info.size > limit)
      throw new HttpError(413, 'This Codex transcript exceeds the 16 MiB import limit')
    const buffer = Buffer.alloc(Math.min(info.size + 1, limit))
    let bytesRead = 0
    let newline = -1
    while (bytesRead < buffer.length) {
      const length = header ? Math.min(1024, buffer.length - bytesRead) : buffer.length - bytesRead
      const chunk = await file.read(buffer, bytesRead, length, bytesRead)
      if (!chunk.bytesRead) break
      if (header) newline = buffer.indexOf(10, bytesRead)
      bytesRead += chunk.bytesRead
      if (header && newline >= 0 && newline < bytesRead) break
    }
    const after = await file.stat()
    if (!header && (after.size !== info.size || after.mtimeMs !== info.mtimeMs))
      throw new HttpError(409, 'The Codex transcript changed. Close Codex and preview it again')
    // A header that fills the budget without a newline is incomplete, not valid metadata.
    const end = header && newline >= 0 ? newline : bytesRead
    return {
      text: header && newline < 0 && after.size > bytesRead ? '' : buffer.toString('utf8', 0, end),
      info: after,
    }
  } finally {
    await file.close()
  }
}

export function parseCodexTranscript(text: string) {
  const lines = text.split('\n').filter((line) => line.trim())
  const metadata = codexSessionMetadata(lines[0] ?? '')
  if (!metadata) throw new HttpError(409, 'This is not a supported terminal Codex transcript')
  const messages: ChatMessage[] = []
  let model = '',
    title = '',
    reasoning: string | undefined,
    interrupted = false
  // Canonical user events and response items can appear in either order. Deduplicate
  // their matching copies within each turn while keeping repeated real user prompts.
  let canonical = new Map<string, number>()
  let responseCopies = new Map<string, ChatMessage[]>()
  for (const [index, line] of lines.entries()) {
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      throw new HttpError(409, 'The Codex transcript is incomplete. Close Codex and retry')
    }
    const row = object(value),
      payload = object(row.payload)
    if (row.type === 'turn_context') {
      model = string(payload.model) || model
      reasoning = string(payload.effort) || string(payload.reasoning_effort) || reasoning
    }
    if (row.type === 'event_msg' && payload.type === 'task_started') {
      interrupted = true
      canonical = new Map()
      responseCopies = new Map()
    }
    if (
      row.type === 'event_msg' &&
      ['task_complete', 'turn_aborted'].includes(string(payload.type))
    )
      interrupted = false
    const eventUser = row.type === 'event_msg' && payload.type === 'user_message'
    const response = row.type === 'response_item' && payload.type === 'message'
    if (!eventUser && !response) continue
    const role = eventUser ? 'user' : payload.role
    if (role !== 'user' && role !== 'assistant') continue
    const text = eventUser ? string(payload.message) : textParts(payload.content)
    if (!text.trim()) continue
    const normalized = text.trim()
    if (eventUser && !title) title = normalized.slice(0, 120)
    if (role === 'user') {
      if (eventUser) {
        const copy = responseCopies.get(normalized)?.shift()
        if (copy) messages.splice(messages.indexOf(copy), 1)
        else canonical.set(normalized, (canonical.get(normalized) ?? 0) + 1)
      } else {
        const copies = canonical.get(normalized) ?? 0
        if (copies) {
          canonical.set(normalized, copies - 1)
          continue
        }
      }
    }
    const at = string(row.timestamp)
    const message: ChatMessage = {
      id: `codex:${metadata.id}:${index}`,
      role,
      text,
      ...(role === 'user' ? { source: { kind: 'system', label: 'Imported from Codex' } } : {}),
      ...(Number.isFinite(Date.parse(at)) ? { createdAt: at } : {}),
    }
    messages.push(message)
    if (messages.length > 10000)
      throw new HttpError(413, 'This session exceeds the 10,000 message import limit')
    if (role === 'user' && !eventUser) {
      const copies = responseCopies.get(normalized) ?? []
      copies.push(message)
      responseCopies.set(normalized, copies)
    }
    if (role === 'assistant') {
      canonical.clear()
      responseCopies.clear()
    }
  }
  return {
    ...metadata,
    messages,
    title:
      title ||
      messages
        .find((message) => message.role === 'user')
        ?.text.trim()
        .slice(0, 120) ||
      '',
    model,
    reasoning,
    interrupted,
    revision: createHash('sha256').update(text).digest('hex'),
  }
}
