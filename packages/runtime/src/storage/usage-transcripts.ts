import { setImmediate } from 'node:timers/promises'
import { readOpenCodeUsage } from './usage-opencode.js'
import { createReadStream } from 'node:fs'
import { readdir, stat, realpath } from 'node:fs/promises'
import { createInterface } from 'node:readline'
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
export function createTranscriptUsage(
  provider: 'codex' | 'claude',
  fallbackSession: string,
  since = 0,
) {
  const rows = new Map<string, UsageRecord>()
  let session = fallbackSession,
    model = ''
  let lastTotal: number | undefined
  return {
    accept(line: unknown) {
      const value = record(line),
        payload = record(value.payload)
      if (provider === 'codex' && value.type === 'session_meta' && typeof payload.id === 'string')
        session = payload.id
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
          total = record(info.total_token_usage),
          usage = record(info.last_token_usage)
        if (typeof total.total_tokens === 'number' && total.total_tokens === lastTotal) return
        lastTotal = typeof total.total_tokens === 'number' ? total.total_tokens : undefined
        if (typeof usage.input_tokens !== 'number' || typeof usage.output_tokens !== 'number')
          return
        const cacheRead = count(usage.cached_input_tokens),
          input = Math.max(0, count(usage.input_tokens) - cacheRead),
          output = count(usage.output_tokens)
        const id = createHash('sha256')
          .update(JSON.stringify([session, total, usage, timestamp]))
          .digest('hex')
        rows.set(id, {
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
            tokens: input + output + cacheRead,
            tokenUsage: { input, output, cacheRead, cacheWrite: 0 },
          },
        })
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
    records: () => [...rows.values()],
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
/** Cached per-file scans run only on the explicit usage path, never during chat streaming. */
export class UsageTranscripts {
  private readonly cache = new Map<string, { size: number; mtime: number; rows: UsageRecord[] }>()
  private pending?: Promise<{ records: UsageRecord[]; notices: string[] }>
  private completed?: {
    at: number
    key: string
    result: { records: UsageRecord[]; notices: string[] }
  }
  async read(agents: readonly Agent[], knownSessions: ReadonlySet<string>, force = false) {
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
    if (this.pending) return this.pending
    if (!force && this.completed?.key === key && Date.now() - this.completed.at < 300000)
      return this.completed.result
    this.pending = (async () => {
      const records = new Map<string, UsageRecord>(),
        notices: string[] = [],
        seen = new Set<string>()
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
            try {
              const info = await stat(path),
                old = this.cache.get(path)
              let rows = old?.rows
              if (!old || old.size !== info.size || old.mtime !== info.mtimeMs) {
                const parser = createTranscriptUsage(provider, path, Date.now() - 90 * 86400000)
                let scanned = 0
                for await (const text of createInterface({
                  input: createReadStream(path),
                  crlfDelay: Infinity,
                })) {
                  if (++scanned % 256 === 0) await setImmediate()
                  if (
                    provider === 'codex' &&
                    !/"(?:session_meta|turn_context|token_count)"/.test(text)
                  )
                    continue
                  if (provider === 'claude' && !/"type"\s*:\s*"assistant"/.test(text)) continue
                  try {
                    const value: unknown = JSON.parse(text)
                    parser.accept(value)
                  } catch {
                    notices.push(`${provider}: skipped an incomplete transcript row.`)
                  }
                }
                rows = parser.records()
                this.cache.set(path, { size: info.size, mtime: info.mtimeMs, rows })
              }
              for (const row of rows ?? []) {
                if (row.sessionId && knownSessions.has(`${provider}:${row.sessionId}`)) continue
                if (Date.parse(row.turn.startedAt) < Date.now() - 90 * 86400000) continue
                records.set(`${provider}:${row.turn.id}`, row)
              }
            } catch {
              notices.push(`${provider}: a transcript could not be read.`)
            }
          }
        } catch (cause) {
          if (!(cause instanceof Error && 'code' in cause && cause.code === 'ENOENT'))
            notices.push(`${provider}: CLI history could not be read.`)
        }
      }
      return { records: [...records.values()], notices: [...new Set(notices)] }
    })()
    try {
      const result = await this.pending
      this.completed = { at: Date.now(), key, result }
      return result
    } finally {
      this.pending = undefined
    }
  }
}
