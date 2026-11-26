import Database from 'better-sqlite3'
import protobuf from 'protobufjs'
import { createHash } from 'node:crypto'
import { lstatSync, realpathSync } from 'node:fs'
import { opendir } from 'node:fs/promises'
import { join } from 'node:path'
import { setImmediate } from 'node:timers/promises'
import type { UsageRecord } from '@dovo/protocol'
import { antigravitySessionId } from '../agents/providers/acp/antigravity-profile.js'

type Fields = Map<number, (number | Uint8Array)[]>
function fields(bytes: Uint8Array): Fields {
  const reader = protobuf.Reader.create(bytes)
  const result: Fields = new Map()
  while (reader.pos < reader.len) {
    const tag = reader.uint32()
    const field = tag >>> 3
    const wire = tag & 7
    if (!field || wire === 3 || wire === 4) throw new Error('Unsupported metadata field')
    if (wire !== 0 && wire !== 2) {
      reader.skipType(wire)
      continue
    }
    const value = wire === 0 ? Number(reader.uint64()) : reader.bytes()
    const values = result.get(field)
    if (values) values.push(value)
    else result.set(field, [value])
  }
  return result
}

const numberAt = (data: Fields, field: number) => {
  const value = data.get(field)?.[0]
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}
const bytesAt = (data: Fields, field: number) => {
  const value = data.get(field)?.[0]
  return value instanceof Uint8Array ? value : undefined
}
const nested = (data: Fields, field: number) => fields(bytesAt(data, field) ?? new Uint8Array())
const textAt = (data: Fields, field: number) => {
  const bytes = bytesAt(data, field)
  return bytes && bytes.length <= 300 ? Buffer.from(bytes).toString('utf8').trim() : ''
}

type Candidate = {
  slot: string
  aliases: string[]
  at: number
  preciseTime: boolean
  model: string
  usage: NonNullable<UsageRecord['turn']['tokenUsage']>
}

function usageCandidates(data: Buffer, step: boolean, idx: number, fallback: number): Candidate[] {
  const envelope = fields(data)
  const metadata = step ? envelope : nested(envelope, 1)
  const timestamp = step ? nested(metadata, 8) : nested(nested(metadata, 9), 4)
  const seconds = numberAt(timestamp, 1)
  const at = seconds ? seconds * 1000 + Math.floor(numberAt(timestamp, 2) / 1e6) : fallback
  const model = step ? nested(metadata, 24) : metadata
  const modelName = textAt(model, step ? 12 : 19) || textAt(model, step ? 8 : 21)
  const main = bytesAt(metadata, step ? 9 : 4)
  const retries = metadata.get(step ? 28 : 17) ?? []
  if (retries.length > 64) throw new Error('Too many attempts in one metadata row')
  return [
    main,
    ...retries.map((retry) =>
      retry instanceof Uint8Array ? bytesAt(fields(retry), 2) : undefined,
    ),
  ].flatMap((payload, ordinal) => {
    if (!payload || !Number.isFinite(new Date(at).valueOf())) return []
    const counters = fields(payload)
    const reasoning = numberAt(counters, 9)
    const usage = {
      input: numberAt(counters, 2),
      output: Math.max(numberAt(counters, 3), reasoning + numberAt(counters, 10)),
      cacheRead: numberAt(counters, 5),
      cacheWrite: numberAt(counters, 4),
    }
    if (!Object.values(usage).some(Boolean)) return []
    const modelId = numberAt(counters, 1)
    const metadataModelId = numberAt(model, step ? 1 : 3)
    return [
      {
        slot: `${idx}:${ordinal}`,
        aliases: [11, 12, 7].flatMap((field) => {
          const identity = textAt(counters, field)
          return identity ? [`${field}:${identity}`] : []
        }),
        at,
        preciseTime: seconds > 0,
        model:
          (modelId && metadataModelId && modelId !== metadataModelId ? '' : modelName)
            .toLowerCase()
            .replace(/\s*\((?:extra[- ]low|low|medium|high)\)\s*$/i, '')
            .replace(/\s+/g, '-') ||
          (modelId ? `antigravity-model-${modelId}` : 'antigravity-unknown'),
        usage,
      },
    ]
  })
}

const warning = 'Antigravity: some usage metadata could not be read.'
const conversationRows = 4096
const profileRecords = 16000
const pagePayloadBytes = 128 * 1024
const maxPayloadBytes = 1024 * 1024
const sql = [
  ['gen_metadata', 'data', false],
  ['steps', 'metadata', true],
] as const
const storageInfo = (path: string) => {
  const info = lstatSync(path, { throwIfNoEntry: false })
  if (
    info &&
    (!info.isFile() ||
      info.nlink !== 1 ||
      (process.getuid && info.uid !== process.getuid()) ||
      realpathSync(path) !== path)
  )
    throw new Error('Unowned Antigravity conversation database')
  return info
}

async function databaseUsage(path: string) {
  const info = storageInfo(path)
  const entries: Candidate[] = []
  let partial = false
  if (!info) return { entries, partial }
  for (const sidecar of ['-wal', '-shm', '-journal']) storageInfo(path + sidecar)
  const db = new Database(path, { readonly: true, fileMustExist: true, timeout: 0 })
  try {
    const opened = storageInfo(path)
    if (opened?.ino !== info.ino || opened.dev !== info.dev) return { entries: [], partial: true }
    db.pragma('trusted_schema = OFF')
    const hasTable = db.prepare(
      "SELECT 1 FROM pragma_table_list(?) WHERE type='table' AND schema='main'",
    )
    tables: for (const [table, column, step] of sql) {
      if (!hasTable.get(table)) continue
      const query =
        db.prepare(`SELECT rowid AS scan_rowid, idx, CASE WHEN length(${column}) <= ${pagePayloadBytes} THEN ${column} END AS payload,
        length(${column}) AS bytes FROM ${table} WHERE rowid < ? ORDER BY rowid DESC LIMIT 64`)
      const readLargePayload = db
        .prepare(`SELECT ${column} FROM ${table} WHERE rowid = ? AND length(${column}) <= ?`)
        .pluck()
      let before = Number.MAX_SAFE_INTEGER
      for (let page = 0; page < 64; page++) {
        const rows = query.all(before) as {
          scan_rowid: number
          idx: number
          payload: unknown
          bytes: number | null
        }[]
        for (const row of rows) {
          if (!row.bytes) continue
          try {
            const payload =
              row.bytes > pagePayloadBytes && row.bytes <= maxPayloadBytes
                ? readLargePayload.get(row.scan_rowid, maxPayloadBytes)
                : row.payload
            if (!Buffer.isBuffer(payload) || !Number.isSafeInteger(row.idx))
              throw new Error('Invalid metadata row')
            const reported = usageCandidates(payload, step, row.idx, info.mtimeMs)
            const available = conversationRows - entries.length
            entries.push(...reported.slice(0, available))
            if (entries.length >= conversationRows) {
              partial = true
              break tables
            }
          } catch {
            partial = true
          }
        }
        if (rows.length < 64) break
        if (page === 63) partial = true
        before = rows.at(-1)!.scan_rowid
        await setImmediate()
      }
    }
    const after = storageInfo(path)
    if (after?.ino !== info.ino || after.dev !== info.dev) return { entries: [], partial: true }
    return { entries, partial }
  } finally {
    db.close()
  }
}

function threadRecords(session: string, candidates: Candidate[], since: number) {
  const chosen = new Map<string, Candidate>()
  const aliases = new Map<string, string>()
  for (const candidate of candidates) {
    const matching = candidate.aliases.map((alias) => aliases.get(alias)).find(Boolean)
    const slot = chosen.get(candidate.slot)
    // A common slot is a fallback when either table omitted the request identity.
    const key =
      matching ??
      (slot?.aliases.length && candidate.aliases.length
        ? `${candidate.slot}:${candidate.aliases[0]}`
        : candidate.slot)
    const previous = chosen.get(key)
    chosen.set(
      key,
      previous
        ? {
            ...previous,
            aliases: [...new Set([...previous.aliases, ...candidate.aliases])],
            ...(candidate.preciseTime && !previous.preciseTime
              ? { at: candidate.at, preciseTime: true }
              : {}),
            model: previous.model.startsWith('antigravity-') ? candidate.model : previous.model,
            usage: {
              input: Math.max(previous.usage.input, candidate.usage.input),
              output: Math.max(previous.usage.output, candidate.usage.output),
              cacheRead: Math.max(previous.usage.cacheRead, candidate.usage.cacheRead),
              cacheWrite: Math.max(previous.usage.cacheWrite, candidate.usage.cacheWrite),
            },
          }
        : candidate,
    )
    for (const alias of candidate.aliases) aliases.set(alias, key)
  }
  return [...chosen].flatMap(([slot, entry]): UsageRecord[] => {
    if (entry.at < since) return []
    const id = createHash('sha256')
      .update(JSON.stringify(['antigravity', session, slot]))
      .digest('hex')
    const at = new Date(entry.at).toISOString()
    return [
      {
        taskId: `cli:antigravity:${session}`,
        title: 'Antigravity CLI',
        sessionId: session,
        origin: 'cli',
        turn: {
          id,
          assistantId: id,
          provider: 'acp',
          agentId: 'cli:antigravity',
          model: entry.model,
          startedAt: at,
          finishedAt: at,
          status: 'completed',
          tokenUsage: entry.usage,
          tokens:
            entry.usage.input + entry.usage.output + entry.usage.cacheRead + entry.usage.cacheWrite,
        },
      },
    ]
  })
}

export async function readAntigravityUsage(
  root: string,
  since: number,
  owned: ReadonlySet<string>,
) {
  const records: UsageRecord[] = []
  let partial = false
  const directory = await opendir(root)
  let files = 0
  for await (const entry of directory) {
    const session = entry.name.endsWith('.db') ? entry.name.slice(0, -3) : ''
    if (!entry.isFile() || !antigravitySessionId.test(session) || owned.has(`acp:${session}`))
      continue
    if (++files > 512 || records.length >= profileRecords) {
      partial = true
      break
    }
    try {
      const result = await databaseUsage(join(root, entry.name))
      partial ||= result.partial
      const imported = threadRecords(session, result.entries, since)
      const available = profileRecords - records.length
      partial ||= imported.length > available
      records.push(...imported.slice(0, available))
    } catch {
      partial = true
    }
    await setImmediate()
  }
  return { records, notices: partial ? [warning] : [] }
}
