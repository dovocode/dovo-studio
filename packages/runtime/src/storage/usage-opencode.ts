import Database from 'better-sqlite3'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setImmediate } from 'node:timers/promises'
import type { UsageRecord } from '@dovo/protocol'
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
const count = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
export function openCodeUsage(
  value: unknown,
  fallback: { id?: string; sessionId?: string; created?: number } = {},
): UsageRecord | undefined {
  const message = object(value),
    tokens = object(message.tokens),
    cache = object(tokens.cache),
    reference = object(message.model)
  if (message.role !== undefined && message.role !== 'assistant') return
  const model = reference.id ?? reference.modelID ?? message.modelID
  const created = object(message.time).created ?? fallback.created
  const id = fallback.id ?? message.id,
    session = fallback.sessionId ?? message.sessionID
  if (
    typeof model !== 'string' ||
    typeof created !== 'number' ||
    !Number.isFinite(created) ||
    typeof id !== 'string' ||
    typeof session !== 'string'
  )
    return
  const provider = reference.providerID ?? message.providerID
  const input = count(tokens.input),
    output = count(tokens.output) + count(tokens.reasoning),
    cacheRead = count(cache.read),
    cacheWrite = count(cache.write)
  if (!input && !output && !cacheRead && !cacheWrite) return
  const cost =
    typeof message.cost === 'number' && Number.isFinite(message.cost) && message.cost > 0
      ? message.cost
      : undefined
  const timestamp = new Date(created).toISOString()
  return {
    taskId: `cli:opencode:${session}`,
    title: 'OpenCode CLI',
    sessionId: session,
    origin: 'cli',
    turn: {
      id,
      assistantId: id,
      agentId: 'cli:opencode',
      provider: 'opencode',
      model: typeof provider === 'string' ? `${provider}/${model}` : model,
      startedAt: timestamp,
      finishedAt: timestamp,
      status: 'completed',
      tokens: input + output + cacheRead + cacheWrite,
      tokenUsage: { input, output, cacheRead, cacheWrite },
      ...(cost !== undefined ? { estimatedCostUsd: cost, costSource: 'provider' } : {}),
    },
  }
}
export async function readOpenCodeUsage(root: string, since: number) {
  const records = new Map<string, UsageRecord>(),
    notices: string[] = []
  const append = (row: UsageRecord | undefined) => {
    if (row && Date.parse(row.turn.startedAt) >= since && !records.has(row.turn.id))
      records.set(row.turn.id, row)
  }
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (cause) {
    if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT')
      return { records: [], notices: [] }
    return { records: [], notices: ['OpenCode CLI history could not be read.'] }
  }
  for (const entry of entries.filter(
    (entry) => entry.isFile() && /^opencode(?:-[a-zA-Z0-9_-]+)?\.db$/.test(entry.name),
  )) {
    let db: Database.Database | undefined
    try {
      db = new Database(join(root, entry.name), {
        readonly: true,
        fileMustExist: true,
        timeout: 100,
      })
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => object(row).name)
      for (const table of ['message', 'session_message']) {
        if (!tables.includes(table)) continue
        const columns = db
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .map((row) => object(row).name)
        if (!['id', 'session_id', 'data'].every((column) => columns.includes(column))) {
          notices.push('OpenCode history schema is unsupported.')
          continue
        }
        const timestamp = columns.includes('time_created') ? 'time_created' : 'NULL'
        const where = timestamp === 'NULL' ? '' : ' WHERE time_created >= ?'
        const statement = db.prepare(
          `SELECT id,session_id,data,${timestamp} AS created FROM ${table}${where}`,
        )
        let scanned = 0
        for (const value of statement.iterate(...(timestamp === 'NULL' ? [] : [since]))) {
          const row = object(value)
          if (
            typeof row.data !== 'string' ||
            typeof row.id !== 'string' ||
            typeof row.session_id !== 'string'
          )
            continue
          try {
            append(
              openCodeUsage(JSON.parse(row.data), {
                id: row.id,
                sessionId: row.session_id,
                ...(typeof row.created === 'number' ? { created: row.created } : {}),
              }),
            )
          } catch {
            notices.push('OpenCode: skipped an unreadable history row.')
          }
          if (++scanned % 256 === 0) await setImmediate()
        }
      }
    } catch {
      notices.push('OpenCode: a live history database could not be read.')
    } finally {
      db?.close()
    }
  }
  const directories = [join(root, 'storage', 'message')]
  while (directories.length) {
    const directory = directories.pop()
    if (!directory) continue
    try {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) directories.push(path)
        else if (
          entry.isFile() &&
          entry.name.endsWith('.json') &&
          !records.has(entry.name.slice(0, -5))
        ) {
          try {
            append(openCodeUsage(JSON.parse(await readFile(path, 'utf8'))))
          } catch {
            notices.push('OpenCode: a legacy history file could not be read.')
          }
        }
      }
    } catch (cause) {
      if (!(cause instanceof Error && 'code' in cause && cause.code === 'ENOENT'))
        notices.push('OpenCode: legacy history could not be read.')
    }
  }
  return { records: [...records.values()], notices: [...new Set(notices)] }
}
