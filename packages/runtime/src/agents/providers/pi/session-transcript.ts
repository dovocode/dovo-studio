import { createHash } from 'node:crypto'
import { Schema } from 'effect'
import { decodeResult, type ChatMessage } from '@dovo/protocol'
import { HttpError } from '../../../errors.js'

const objectSchema = Schema.Record(Schema.String, Schema.mutableKey(Schema.Unknown))
const object = (value: unknown) => decodeResult(objectSchema, value).data ?? {}
const string = (value: unknown) => (typeof value === 'string' ? value : '')

export function piSessionMetadata(line: string) {
  try {
    const row = object(JSON.parse(line))
    const id = string(row.id),
      cwd = string(row.cwd)
    if (row.type !== 'session' || !id || id.length > 200 || !cwd) return undefined
    return { id, cwd, timestamp: string(row.timestamp) }
  } catch {
    return undefined
  }
}

/** Pi files contain abandoned branches; only the last entry's ancestry is current. */
export function parsePiTranscript(text: string) {
  const lines = text.split('\n').filter((line) => line.trim())
  const metadata = piSessionMetadata(lines[0] ?? '')
  if (!metadata) throw new HttpError(409, 'This is not a supported Pi transcript')
  const entries = lines.slice(1).map((line, index) => {
    try {
      return { row: object(JSON.parse(line)), index: index + 1 }
    } catch {
      throw new HttpError(409, 'The Pi transcript is incomplete. Close Pi and retry')
    }
  })
  const leaf = entries.at(-1)
  let branch = entries
  if (leaf && string(leaf.row.id)) {
    const byId = new Map(entries.map((entry) => [string(entry.row.id), entry]))
    branch = []
    const seen = new Set<string>()
    let entry: typeof leaf | undefined = leaf
    while (entry) {
      const id = string(entry.row.id)
      if (!id || seen.has(id))
        throw new HttpError(409, 'The Pi transcript has invalid branch links')
      seen.add(id)
      branch.push(entry)
      const parent = string(entry.row.parentId)
      if (parent && !byId.has(parent))
        throw new HttpError(409, 'The Pi transcript has missing branch links')
      entry = parent ? byId.get(parent) : undefined
    }
    branch.reverse()
  }
  const messages: ChatMessage[] = []
  for (const { row, index } of branch) {
    if (row.type !== 'message') continue
    const message = object(row.message)
    if (message.role !== 'user' && message.role !== 'assistant') continue
    const content =
      typeof message.content === 'string'
        ? message.content
        : (decodeResult(Schema.Array(objectSchema), message.content).data ?? [])
            .filter((part) => part.type === 'text')
            .map((part) => string(part.text))
            .join('\n')
    if (!content.trim()) continue
    const at = string(row.timestamp)
    messages.push({
      id: `pi:${metadata.id}:${index}`,
      role: message.role,
      text: content,
      ...(message.role === 'user' ? { source: { kind: 'system', label: 'Imported from Pi' } } : {}),
      ...(Number.isFinite(Date.parse(at)) ? { createdAt: at } : {}),
    })
    if (messages.length > 10000)
      throw new HttpError(413, 'This session exceeds the 10,000 message import limit')
  }
  const title =
    string(
      [...entries].reverse().find(({ row }) => row.type === 'session_info')?.row.name,
    ).trim() ||
    messages
      .find((message) => message.role === 'user')
      ?.text.trim()
      .slice(0, 120) ||
    ''
  return { ...metadata, messages, title, revision: createHash('sha256').update(text).digest('hex') }
}
