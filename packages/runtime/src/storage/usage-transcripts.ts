import { setImmediate } from 'node:timers/promises'
import { readOpenCodeUsage } from './usage-opencode.js'
import { createReadStream } from 'node:fs'
import { readdir, open, realpath, type FileHandle } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { type Agent, type UsageRecord } from '@dovo/protocol'
import { processEnvironment } from '../process.js'
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
const count = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
const codexCounters = [
  'input_tokens',
  'cached_input_tokens',
  'cache_write_input_tokens',
  'output_tokens',
  'reasoning_output_tokens',
  'total_tokens',
] as const
type CodexCounter = (typeof codexCounters)[number]
type CodexUsage = Record<CodexCounter, number>
type CodexTotal = Partial<CodexUsage> & { total_tokens: number }
function codexTotal(value: Record<string, unknown>): CodexTotal | undefined {
  if (typeof value.total_tokens !== 'number') return
  const counters: Partial<CodexUsage> = {}
  for (const key of codexCounters) {
    const counter = value[key]
    if (counter === undefined) continue
    if (typeof counter !== 'number' || !Number.isSafeInteger(counter) || counter < 0) return
    counters[key] = counter
  }
  const {
    input_tokens: input,
    output_tokens: output,
    cached_input_tokens: cached,
    cache_write_input_tokens: cacheWrite,
    reasoning_output_tokens: reasoning,
  } = counters
  // An impossible snapshot cannot establish a baseline: doing so can make all
  // subsequent real counters look stale and suppress the rest of a session.
  if (
    (input !== undefined && output !== undefined && input + output !== value.total_tokens) ||
    (input !== undefined && input > value.total_tokens) ||
    (output !== undefined && output > value.total_tokens) ||
    (cached ?? 0) + (cacheWrite ?? 0) > (input ?? value.total_tokens) ||
    (reasoning !== undefined && reasoning > (output ?? value.total_tokens))
  )
    return
  return { ...counters, total_tokens: value.total_tokens }
}
function codexUsage(value: Record<string, unknown>): CodexUsage | undefined {
  if (typeof value.input_tokens !== 'number' || typeof value.output_tokens !== 'number') return
  const counters = codexTotal({
    cached_input_tokens: 0,
    cache_write_input_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: value.input_tokens + value.output_tokens,
    ...value,
  })
  if (!counters) return
  const usage: CodexUsage = {
    input_tokens: value.input_tokens,
    output_tokens: value.output_tokens,
    cached_input_tokens: counters.cached_input_tokens ?? 0,
    cache_write_input_tokens: counters.cache_write_input_tokens ?? 0,
    reasoning_output_tokens: counters.reasoning_output_tokens ?? 0,
    total_tokens: counters.total_tokens,
  }
  if (
    usage.total_tokens !== usage.input_tokens + usage.output_tokens ||
    usage.cached_input_tokens + usage.cache_write_input_tokens > usage.input_tokens ||
    usage.reasoning_output_tokens > usage.output_tokens
  )
    return
  return usage
}
type ParserState = {
  session: string
  model: string
  lastTotal?: CodexTotal
  lastUsage?: CodexUsage
  lastTotalAt?: string
}
function createTranscriptUsage(
  provider: 'codex' | 'claude',
  fallbackSession: string,
  since = 0,
  initial?: ParserState,
) {
  const rows = new Map<string, UsageRecord>()
  // Keep later copies only for promotion when the first notification ages out.
  const duplicates = new Map<string, UsageRecord[]>()
  let lastRowId: string | undefined
  let session = initial?.session ?? fallbackSession,
    model = initial?.model ?? ''
  let lastTotal = initial?.lastTotal
  let lastUsage = initial?.lastUsage
  let lastTotalAt = initial?.lastTotalAt
  let invalidTotalAt: number | undefined
  const issues = new Map<string, number>()
  const notices = () => [...issues].filter(([, at]) => at >= since).map(([notice]) => notice)
  return {
    accept(line: unknown) {
      const value = record(line),
        payload = record(value.payload)
      if (provider === 'codex' && value.type === 'session_meta' && typeof payload.id === 'string') {
        if (session !== payload.id) {
          lastTotal = undefined
          lastUsage = undefined
          lastRowId = undefined
        }
        session = payload.id
      }
      if (
        provider === 'codex' &&
        value.type === 'turn_context' &&
        typeof payload.model === 'string'
      )
        model = payload.model
      const timestamp = typeof value.timestamp === 'string' ? value.timestamp : undefined
      if (!timestamp || !Number.isFinite(Date.parse(timestamp)) || Date.parse(timestamp) < since)
        return
      if (provider === 'codex') {
        if (value.type !== 'event_msg' || payload.type !== 'token_count') return
        const info = record(payload.info),
          rawTotal = record(info.total_token_usage),
          total = codexTotal(rawTotal),
          usage = codexUsage(record(info.last_token_usage))
        const inconsistent = () =>
          issues.set(
            'codex: skipped inconsistent token counters in CLI history.',
            Date.parse(timestamp),
          )
        if (Object.keys(rawTotal).length && !total) {
          inconsistent()
          return
        }
        // A request-only event does not establish a new billable request, even
        // before the first baseline. Its paired notification may arrive later.
        if (!total) {
          if (usage)
            issues.set(
              'codex: excluded CLI records without cumulative token counters; usage may be incomplete.',
              Date.parse(timestamp),
            )
          return
        }
        const previousTotal = lastTotal,
          acceptedUsage = lastUsage
        // A stale snapshot must never move the baseline backwards.
        if (
          total &&
          previousTotal &&
          codexCounters.some((key) => {
            const previous = previousTotal[key],
              current = total[key]
            return previous !== undefined && current !== undefined && current < previous
          })
        )
          return
        const duplicate =
          !!total &&
          !!previousTotal &&
          codexCounters.every((key) => total[key] === previousTotal[key])
        if (duplicate && !lastRowId) return
        if (!duplicate) {
          lastTotal = total
          lastTotalAt = timestamp
          lastRowId = undefined
        }
        if (!usage) {
          inconsistent()
          if (!duplicate && lastTotal)
            invalidTotalAt = Math.min(invalidTotalAt ?? Infinity, Date.parse(timestamp))
          return
        }
        if (
          duplicate &&
          (!acceptedUsage || codexCounters.some((key) => usage[key] !== acceptedUsage[key]))
        )
          return
        if (
          !duplicate &&
          total &&
          codexCounters.some((key) => {
            const current = total[key],
              previous = previousTotal?.[key]
            if (current === undefined) return false
            return previous === undefined ? current < usage[key] : current - previous !== usage[key]
          })
        ) {
          inconsistent()
          invalidTotalAt = Math.min(invalidTotalAt ?? Infinity, Date.parse(timestamp))
          return
        }
        if (!total || codexCounters.some((key) => total[key] === undefined))
          issues.set(
            'codex: CLI history has partial token counters; reconciliation is limited.',
            Date.parse(timestamp),
          )
        const cacheRead = usage.cached_input_tokens,
          cacheWrite = usage.cache_write_input_tokens,
          input = usage.input_tokens - cacheRead - cacheWrite,
          output = usage.output_tokens
        const id = createHash('sha256')
          .update(JSON.stringify([session, total, usage, timestamp]))
          .digest('hex')
        const row: UsageRecord = {
          taskId: `cli:codex:${session}`,
          title: 'Codex CLI',
          sessionId: session,
          origin: 'cli',
          turn: {
            id,
            assistantId: id,
            agentId: 'cli:codex',
            provider,
            model,
            startedAt: timestamp,
            finishedAt: timestamp,
            status: 'completed',
            tokens: input + output + cacheRead + cacheWrite,
            tokenUsage: { input, output, cacheRead, cacheWrite },
          },
        }
        if (duplicate && lastRowId) {
          const copies = duplicates.get(lastRowId) ?? []
          // Exact retransmissions need no additional retained state.
          if (
            row.turn.id !== rows.get(lastRowId)?.turn.id &&
            row.turn.id !== copies.at(-1)?.turn.id
          )
            copies.push(row)
          if (copies.length) duplicates.set(lastRowId, copies)
        } else {
          rows.set(id, row)
          lastRowId = id
          lastUsage = usage
        }
      } else {
        if (value.type !== 'assistant') return
        const message = record(value.message),
          usage = record(message.usage)
        if (
          typeof message.id !== 'string' ||
          typeof usage.input_tokens !== 'number' ||
          typeof usage.output_tokens !== 'number'
        )
          return
        const id = JSON.stringify([message.id, value.requestId ?? ''])
        if (typeof value.sessionId === 'string') session = value.sessionId
        const input = count(usage.input_tokens),
          output = count(usage.output_tokens),
          cacheRead = count(usage.cache_read_input_tokens),
          cacheWrite = count(usage.cache_creation_input_tokens)
        rows.set(id, {
          taskId: `cli:claude:${session}`,
          title: 'Claude CLI',
          sessionId: session,
          origin: 'cli',
          turn: {
            id,
            assistantId: message.id,
            agentId: 'cli:claude',
            provider,
            model: typeof message.model === 'string' ? message.model : '',
            startedAt: timestamp,
            finishedAt: timestamp,
            status: 'completed',
            tokens: input + output + cacheRead + cacheWrite,
            tokenUsage: { input, output, cacheRead, cacheWrite },
          },
        })
      }
    },
    // A malformed cumulative baseline can suppress later valid copies. Once it
    // expires, rebuild this unusual file so those copies become eligible again.
    requiresRescan: (cutoff: number) => invalidTotalAt !== undefined && invalidTotalAt < cutoff,
    advance(cutoff: number) {
      since = cutoff
      for (const [id, row] of rows) {
        const copies = (duplicates.get(id) ?? []).filter(
          (copy) => Date.parse(copy.turn.startedAt) >= since,
        )
        if (Date.parse(row.turn.startedAt) < since) {
          const replacement = copies.shift()
          if (replacement) rows.set(id, replacement)
          else rows.delete(id)
        }
        if (copies.length) duplicates.set(id, copies)
        else duplicates.delete(id)
      }
      if (lastRowId && rows.has(lastRowId)) lastTotalAt = rows.get(lastRowId)!.turn.startedAt
      if (lastTotalAt && Date.parse(lastTotalAt) < since) {
        lastTotal = undefined
        lastUsage = undefined
        lastRowId = undefined
      }
    },
    preview(line: unknown): { records: UsageRecord[]; notices: string[] } {
      const preview = createTranscriptUsage(provider, fallbackSession, since, {
        session,
        model,
        lastTotal,
        lastUsage,
        lastTotalAt,
      })
      preview.accept(line)
      return { records: preview.records(), notices: preview.notices() }
    },
    records: (): UsageRecord[] => [...rows.values()],
    notices,
  }
}
export function transcriptUsage(
  provider: 'codex' | 'claude',
  lines: readonly unknown[],
  fallbackSession: string,
): UsageRecord[] {
  const parser = createTranscriptUsage(provider, fallbackSession)
  for (const line of lines) parser.accept(line)
  return parser.records()
}
async function* files(directory: string): AsyncGenerator<string> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) yield* files(path)
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) yield path
  }
}
type TranscriptScan = {
  provider: 'codex' | 'claude'
  device: number
  inode: number
  size: number
  mtime: number
  ctime: number
  prefix: Buffer
  suffix: Buffer
  parser: ReturnType<typeof createTranscriptUsage>
  trailing: Buffer[]
  incomplete: boolean
}
async function sample(file: FileHandle, position: number, length: number) {
  const buffer = Buffer.alloc(length)
  const { bytesRead } = await file.read(buffer, 0, length, position)
  if (bytesRead !== length) throw new Error('Transcript changed during scan')
  return buffer
}
function acceptText(scan: TranscriptScan, text: string) {
  if (scan.provider === 'codex' && !/"(?:session_meta|turn_context|token_count)"/.test(text)) return
  if (scan.provider === 'claude' && !/"type"\s*:\s*"assistant"/.test(text)) return
  try {
    const value: unknown = JSON.parse(text)
    scan.parser.accept(value)
  } catch {
    scan.incomplete = true
  }
}
async function appendTranscript(file: FileHandle, scan: TranscriptScan, size: number) {
  if (size <= scan.size) return
  let scanned = 0
  let bytes = scan.size
  // Read only this snapshot's bytes; concurrent appends are picked up next time.
  const stream = createReadStream('', {
    fd: file.fd,
    autoClose: false,
    start: scan.size,
    end: size - 1,
  })
  for await (const chunk of stream) {
    if (!Buffer.isBuffer(chunk)) throw new Error('Unexpected transcript stream encoding')
    bytes += chunk.length
    let start = 0
    for (let i = 0; i < chunk.length; i++) {
      if (chunk[i] !== 10 && chunk[i] !== 13) continue
      scan.trailing.push(chunk.subarray(start, i))
      acceptText(scan, Buffer.concat(scan.trailing).toString('utf8'))
      scan.trailing = []
      start = i + 1
      if (++scanned % 256 === 0) await setImmediate()
    }
    if (start < chunk.length) scan.trailing.push(chunk.subarray(start))
  }
  if (bytes !== size) throw new Error('Transcript changed during scan')
  scan.size = size
}
/** Cached per-file scans run only on the explicit usage path, never during chat streaming. */
export class UsageTranscripts {
  private readonly cache = new Map<string, TranscriptScan>()
  private pending?: Promise<{ records: UsageRecord[]; notices: string[] }>
  private pendingKey?: string
  private completed?: {
    at: number
    key: string
    result: { records: UsageRecord[]; notices: string[] }
  }
  async read(
    agents: readonly Agent[],
    knownSessions: ReadonlySet<string>,
    force = false,
  ): Promise<{ records: UsageRecord[]; notices: string[] }> {
    const directories = new Map<string, 'codex' | 'claude' | 'opencode'>()
    for (const agent of agents) {
      if (
        agent.provider !== 'codex' &&
        agent.provider !== 'claude' &&
        agent.provider !== 'opencode'
      )
        continue
      if (agent.provider === 'opencode' && /^https?:\/\//.test(agent.endpoint)) continue
      const env = processEnvironment(agent.env),
        home = env.HOME || homedir()
      const configured =
        agent.provider === 'opencode'
          ? env.OPENCODE_DATA_DIR ||
            join(env.XDG_DATA_HOME || join(home, '.local', 'share'), 'opencode')
          : agent.provider === 'codex'
            ? env.CODEX_HOME || join(home, '.codex')
            : env.CLAUDE_CONFIG_DIR || join(home, '.claude')
      const base = configured.startsWith('~/')
        ? join(home, configured.slice(2))
        : resolve(configured)
      const directory =
        agent.provider === 'opencode'
          ? base
          : join(base, agent.provider === 'codex' ? 'sessions' : 'projects')
      directories.set(`${agent.provider}:${directory}`, agent.provider)
    }
    const key = JSON.stringify([...directories.keys(), ...[...knownSessions].sort()])
    if (this.pending) {
      if (this.pendingKey === key) return this.pending
      await this.pending
      return this.read(agents, knownSessions, force)
    }
    if (!force && this.completed?.key === key && Date.now() - this.completed.at < 300000)
      return this.completed.result
    this.pendingKey = key
    this.pending = (async () => {
      const records = new Map<string, UsageRecord>(),
        notices: string[] = [],
        seen = new Set<string>(),
        scannedFiles = new Set<string>()
      const since = Date.now() - 90 * 86400000
      for (const [source, provider] of directories) {
        const directory = source.slice(provider.length + 1)
        try {
          const canonical = await realpath(directory)
          if (seen.has(canonical)) continue
          seen.add(canonical)
          if (provider === 'opencode') {
            const result = await readOpenCodeUsage(canonical, Date.now() - 90 * 86400000)
            notices.push(...result.notices)
            for (const row of result.records)
              if (!row.sessionId || !knownSessions.has(`opencode:${row.sessionId}`))
                records.set(`opencode:${row.turn.id}`, row)
            continue
          }
          for await (const path of files(canonical)) {
            scannedFiles.add(path)
            try {
              const file = await open(path, 'r')
              let rows: UsageRecord[]
              try {
                const info = await file.stat()
                let scan = this.cache.get(path)
                if (
                  scan &&
                  (scan.parser.requiresRescan(since) ||
                    scan.provider !== provider ||
                    scan.device !== info.dev ||
                    scan.inode !== info.ino ||
                    info.size < scan.size ||
                    (info.size === scan.size &&
                      (info.mtimeMs !== scan.mtime || info.ctimeMs !== scan.ctime)))
                )
                  scan = undefined
                // Provider histories are append-only. These bounded anchors also
                // catch ordinary truncate/regrow operations between refreshes.
                if (scan && info.size > scan.size) {
                  const prefix = await sample(file, 0, scan.prefix.length)
                  const suffix = await sample(
                    file,
                    scan.size - scan.suffix.length,
                    scan.suffix.length,
                  )
                  if (!prefix.equals(scan.prefix) || !suffix.equals(scan.suffix)) scan = undefined
                }
                scan ??= {
                  provider,
                  device: info.dev,
                  inode: info.ino,
                  size: 0,
                  mtime: info.mtimeMs,
                  ctime: info.ctimeMs,
                  prefix: Buffer.alloc(0),
                  suffix: Buffer.alloc(0),
                  parser: createTranscriptUsage(provider, path, since),
                  trailing: [],
                  incomplete: false,
                }
                scan.parser.advance(since)
                const changed = scan.size !== info.size || !scan.prefix.length
                await appendTranscript(file, scan, info.size)
                if (changed) {
                  scan.prefix = await sample(file, 0, Math.min(info.size, 256))
                  scan.suffix = await sample(
                    file,
                    Math.max(0, info.size - 256),
                    Math.min(info.size, 256),
                  )
                }
                scan.mtime = info.mtimeMs
                scan.ctime = info.ctimeMs
                rows = scan.parser.records()
                // Preserve valid unterminated final records without committing parser state:
                // a writer can still extend that line, including a UTF-8 code point.
                if (scan.trailing.length) {
                  let value: unknown
                  try {
                    value = JSON.parse(Buffer.concat(scan.trailing).toString('utf8'))
                  } catch {
                    // A partial final line belongs to the next refresh.
                  }
                  if (value !== undefined) {
                    const preview = scan.parser.preview(value)
                    const ids = new Set(preview.records.map((row) => row.turn.id))
                    rows = rows.filter((row) => !ids.has(row.turn.id)).concat(preview.records)
                    notices.push(...preview.notices)
                  }
                }
                notices.push(...scan.parser.notices())
                if (scan.incomplete)
                  notices.push(`${provider}: skipped an incomplete transcript row.`)
                this.cache.set(path, scan)
              } finally {
                await file.close()
              }
              for (const row of rows) {
                if (row.sessionId && knownSessions.has(`${provider}:${row.sessionId}`)) continue
                records.set(`${provider}:${row.turn.id}`, row)
              }
            } catch {
              this.cache.delete(path)
              notices.push(`${provider}: a transcript could not be read.`)
            }
          }
        } catch (cause) {
          if (!(cause instanceof Error && 'code' in cause && cause.code === 'ENOENT'))
            notices.push(`${provider}: CLI history could not be read.`)
        }
      }
      for (const path of this.cache.keys()) if (!scannedFiles.has(path)) this.cache.delete(path)
      return { records: [...records.values()], notices: [...new Set(notices)] }
    })()
    try {
      const result = await this.pending
      this.completed = { at: Date.now(), key, result }
      return result
    } finally {
      this.pending = undefined
      this.pendingKey = undefined
    }
  }
}
