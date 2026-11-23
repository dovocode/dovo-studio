import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import type Database from 'better-sqlite3'
import { McpError } from '@modelcontextprotocol/sdk/types.js'
import type { McpServer } from '@dovo/protocol'
import { z } from 'zod'
import { HttpError } from '../errors.js'
import { McpEventsStdio } from './stdio.js'
import {
  McpEventsClient,
  McpEventStreamTerminated,
  type McpEventBatch,
  type McpEventType,
  type McpOccurrence,
} from './client.js'

const serverName = z.string().min(1).max(80)
const subscriptionId = z.string().regex(/^[a-f0-9]{64}$/)
export const mcpEventsCommand = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('servers') }),
  z.strictObject({ action: z.literal('catalog'), server: serverName }),
  z.strictObject({ action: z.literal('subscriptions') }),
  z.strictObject({
    action: z.literal('subscribe'),
    server: serverName,
    name: z.string().min(1).max(512),
    arguments: z.record(z.string(), z.json()).default({}),
    delivery: z.enum(['poll', 'push']).optional(),
    maxAgeMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  }),
  z.strictObject({
    action: z.literal('read'),
    subscriptionId,
    after: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  }),
  z.strictObject({ action: z.literal('unsubscribe'), subscriptionId }),
])
type Command = z.infer<typeof mcpEventsCommand>

const MAX_INBOX_ITEMS = 64
const MAX_INBOX_BYTES = 512 * 1024
const MAX_REPLY_BYTES = 64 * 1024

type Item = { offset: number; event: McpOccurrence } | { offset: number; gap: true }
type Subscription = {
  id: string
  server: string
  fingerprint: string
  event: McpEventType
  arguments: Record<string, unknown>
  mode: 'push' | 'poll'
  maxAgeMs?: number
  cursor: string | null
  nextPollAt: number
  terminated?: boolean
  streamStarted?: boolean
  offset: number
  ack: number
  offered: number
  inbox: Item[]
  recent: string[]
}
type Source = { server: McpServer; fingerprint: string; cwd: string }
type Stream = { taskId: string; controller: AbortController; active: boolean; done?: Promise<void> }
type Scope = {
  taskId: string
  servers: string[]
  source: (name: string) => Source
  signal: AbortSignal
  streamSignal: AbortSignal
  authorize: () => void
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, child]) => JSON.stringify(key) + ':' + canonical(child))
        .join(',') +
      '}'
    )
  return JSON.stringify(value)
}

const isTerminal = (error: unknown) =>
  error instanceof McpEventStreamTerminated ||
  (error instanceof McpError && [-32023, -32024, -32026].includes(error.code))

/** Owns thread-scoped cursors and inboxes. Cursor and data commit in the same SQLite write. */
export class McpEventSubscriptions {
  private streams = new Map<string, Stream>()
  private busy = new Set<string>()
  private streamProblems = new Map<string, string>()
  private stdio = new Map<
    string,
    {
      taskId: string
      connection: McpEventsStdio
      usedAt: number
      closing?: Promise<void>
    }
  >()

  constructor(private db: Database.Database) {
    db.exec(`CREATE TABLE IF NOT EXISTS mcp_event_subscriptions (
      task_id TEXT NOT NULL,
      id TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (task_id, id)
    )`)
  }

  private load(taskId: string, id: string) {
    const row = this.db
      .prepare('SELECT value FROM mcp_event_subscriptions WHERE task_id=? AND id=?')
      .get(taskId, id) as { value: string } | undefined
    return row ? (JSON.parse(row.value) as Subscription) : undefined
  }

  private list(taskId: string) {
    const rows = this.db
      .prepare('SELECT value FROM mcp_event_subscriptions WHERE task_id=? ORDER BY rowid')
      .all(taskId) as Array<{ value: string }>
    return rows.map((row) => JSON.parse(row.value) as Subscription)
  }

  private save(taskId: string, sub: Subscription) {
    this.db
      .prepare(`INSERT INTO mcp_event_subscriptions (task_id, id, value) VALUES (?, ?, ?)
      ON CONFLICT (task_id, id) DO UPDATE SET value=excluded.value`)
      .run(taskId, sub.id, JSON.stringify(sub))
  }

  private key(taskId: string, id: string) {
    return JSON.stringify([taskId, id])
  }

  private status(taskId: string, sub: Subscription) {
    const key = this.key(taskId, sub.id)
    return {
      subscriptionId: sub.id,
      server: sub.server,
      name: sub.event.name,
      delivery: sub.mode,
      replayAvailable: sub.cursor !== null,
      queued: sub.inbox.length,
      status: sub.terminated
        ? 'terminated'
        : sub.mode === 'poll'
          ? 'poll-on-read'
          : this.streams.get(key)?.active
            ? 'streaming'
            : this.streams.has(key)
              ? 'connecting'
              : 'paused',
      problem: this.streamProblems.get(key),
    }
  }

  private source(scope: Scope, sub: Subscription) {
    const source = scope.source(sub.server)
    if (source.fingerprint !== sub.fingerprint)
      throw new HttpError(
        409,
        'The MCP event source changed. Remove the old subscription before using the new source.',
      )
    return source
  }

  private async client(scope: Scope, source: Source) {
    if (source.server.transport === 'http') return new McpEventsClient(source.server)
    const key = this.key(scope.taskId, source.fingerprint)
    let closing: Promise<void> | undefined
    if (!this.stdio.has(key) && this.stdio.size >= 32) {
      const oldest = [...this.stdio.entries()]
        .filter(([, entry]) => !entry.closing && entry.connection.idle)
        .sort(([, a], [, b]) => a.usedAt - b.usedAt)[0]
      if (!oldest) throw new HttpError(429, 'All MCP event connections are in use')
      this.stdio.delete(oldest[0])
      closing = oldest[1].connection.close()
    }
    const entry = this.stdio.get(key) ?? {
      taskId: scope.taskId,
      connection: new McpEventsStdio(source.server, source.cwd),
      usedAt: Date.now(),
      closing,
    }
    entry.usedAt = Date.now()
    this.stdio.set(key, entry)
    try {
      await entry.closing
    } finally {
      entry.closing = undefined
    }
    scope.authorize()
    return new McpEventsClient(source.server, entry.connection)
  }

  private apply(sub: Subscription, batch: McpEventBatch) {
    const queued: Item[] = []
    const recent = new Set(sub.recent)
    let offset = sub.offset
    if (batch.truncated) queued.push({ offset: ++offset, gap: true })
    for (const event of batch.events) {
      if (recent.has(event.eventId)) continue
      if (Buffer.byteLength(JSON.stringify(event)) > MAX_REPLY_BYTES - 1024)
        throw new HttpError(
          413,
          'MCP event exceeds the supported payload size. The cursor did not advance.',
        )
      queued.push({ offset: ++offset, event })
      recent.add(event.eventId)
    }
    const inbox = [...sub.inbox, ...queued]
    if (
      inbox.length > MAX_INBOX_ITEMS ||
      Buffer.byteLength(JSON.stringify(inbox)) > MAX_INBOX_BYTES
    )
      return false
    sub.inbox = inbox
    sub.offset = offset
    sub.recent = [...recent].slice(-2048)
    sub.cursor = batch.cursor
    sub.nextPollAt = batch.hasMore
      ? 0
      : Date.now() + Math.max(1000, Math.min(batch.nextPollMs, 2 ** 31 - 1))
    return true
  }

  private params(sub: Subscription) {
    return {
      name: sub.event.name,
      arguments: sub.arguments,
      cursor: sub.cursor,
      ...(sub.maxAgeMs === undefined ? {} : { maxAgeMs: sub.maxAgeMs }),
    }
  }

  private async poll(scope: Scope, sub: Subscription, client: McpEventsClient) {
    const batch = await client.poll(sub.event, this.params(sub), scope.signal)
    scope.authorize()
    this.source(scope, sub)
    if (!this.apply(sub, batch))
      throw new HttpError(
        413,
        'MCP event batch exceeds the inbox limit. The cursor did not advance.',
      )
  }

  private startStream(scope: Scope, sub: Subscription, client: McpEventsClient) {
    const key = this.key(scope.taskId, sub.id)
    if (sub.terminated || this.streams.has(key)) return
    if (this.streams.size >= 32) throw new HttpError(429, 'All MCP event streams are in use')
    const stream: Stream = {
      taskId: scope.taskId,
      controller: new AbortController(),
      active: false,
    }
    this.streams.set(key, stream)
    this.streamProblems.delete(key)
    const signal = AbortSignal.any([scope.streamSignal, stream.controller.signal])
    const receive = async () => {
      let retryMs = 1000
      while (!signal.aborted) {
        const saved = this.load(scope.taskId, sub.id)
        if (!saved || saved.terminated) return
        scope.authorize()
        this.source(scope, saved)
        let full = false
        stream.active = false
        try {
          await client.stream(saved.event, this.params(saved), signal, (batch) => {
            signal.throwIfAborted()
            scope.authorize()
            const current = this.load(scope.taskId, sub.id)
            if (!current || this.streams.get(key) !== stream) return false
            this.source(scope, current)
            const reconnectGap = !stream.active && current.streamStarted && current.cursor === null
            full = !this.apply(current, {
              ...batch,
              truncated: batch.truncated || reconnectGap === true,
            })
            if (full) {
              this.streamProblems.set(
                key,
                'Inbox is full. Read and acknowledge queued events to resume.',
              )
              return false
            }
            current.streamStarted = true
            this.save(scope.taskId, current)
            this.streamProblems.delete(key)
            stream.active = true
            retryMs = 1000
            return true
          })
        } catch (error) {
          if (signal.aborted || this.streams.get(key) !== stream) return
          if (isTerminal(error)) {
            const current = this.load(scope.taskId, sub.id)
            if (current) this.save(scope.taskId, { ...current, terminated: true })
            this.streamProblems.set(
              key,
              'The server terminated the subscription. Discover events before subscribing again.',
            )
            return
          }
          this.streamProblems.set(
            key,
            'MCP stream disconnected. Reconnecting from the saved cursor.',
          )
        }
        if (full || signal.aborted) return
        stream.active = false
        await delay(retryMs + Math.random() * 250, undefined, { signal, ref: false }).catch(
          (error: unknown) => {
            if (!signal.aborted) throw error
          },
        )
        retryMs = Math.min(retryMs * 2, 30_000)
      }
    }
    stream.done = receive().finally(() => {
      if (this.streams.get(key) === stream) this.streams.delete(key)
    })
    void stream.done.catch((error: unknown) => {
      console.error(
        'MCP event stream could not save its final status',
        error instanceof Error ? error.name : 'Unknown error',
      )
    })
  }

  async command(scope: Scope, command: Command) {
    scope.authorize()
    if (command.action === 'servers') return { servers: scope.servers }
    if (command.action === 'subscriptions')
      return { subscriptions: this.list(scope.taskId).map((sub) => this.status(scope.taskId, sub)) }
    if (command.action === 'catalog') {
      const source = scope.source(command.server)
      const events = await (await this.client(scope, source)).list(scope.signal)
      scope.authorize()
      if (scope.source(command.server).fingerprint !== source.fingerprint)
        throw new HttpError(409, 'The MCP event source changed during discovery')
      return { supported: events !== undefined, events: events ?? [] }
    }
    if (command.action === 'subscribe') return this.subscribe(scope, command)
    const key = this.key(scope.taskId, command.subscriptionId)
    if (this.busy.has(key))
      throw new HttpError(409, 'Another operation is in progress for this subscription')
    if (command.action === 'unsubscribe') {
      this.streams.get(key)?.controller.abort()
      this.streams.delete(key)
      this.streamProblems.delete(key)
      const deleted = this.db
        .prepare('DELETE FROM mcp_event_subscriptions WHERE task_id=? AND id=?')
        .run(scope.taskId, command.subscriptionId)
      return { removed: deleted.changes > 0 }
    }
    const initial = this.load(scope.taskId, command.subscriptionId)
    if (!initial) throw new HttpError(404, 'MCP event subscription not found in this thread')
    this.busy.add(key)
    try {
      const client = await this.client(scope, this.source(scope, initial))
      scope.authorize()
      // A live push stream can commit while the stdio transport is being acquired.
      const sub = this.load(scope.taskId, command.subscriptionId)
      if (!sub) throw new HttpError(404, 'MCP event subscription not found in this thread')
      this.source(scope, sub)
      if (command.after !== undefined && command.after > sub.offered)
        throw new HttpError(400, 'Acknowledge only an offset returned by this subscription')
      if (command.after !== undefined && command.after > sub.ack) {
        sub.ack = command.after
        sub.inbox = sub.inbox.filter(({ offset }) => offset > sub.ack)
        this.save(scope.taskId, sub)
      }
      if (
        !sub.terminated &&
        sub.mode === 'poll' &&
        !sub.inbox.length &&
        sub.nextPollAt <= Date.now()
      ) {
        try {
          await this.poll(scope, sub, client)
        } catch (error) {
          if (!isTerminal(error)) throw error
          scope.authorize()
          this.source(scope, sub)
          sub.terminated = true
          this.streamProblems.set(
            key,
            'The server ended the subscription. Discover events before subscribing again.',
          )
        }
      }
      scope.authorize()
      this.source(scope, sub)
      if (sub.mode === 'push' && !sub.inbox.length) this.startStream(scope, sub, client)
      const items: Item[] = []
      let bytes = 0
      for (const item of sub.inbox) {
        const size = Buffer.byteLength(JSON.stringify(item))
        if (bytes + size > MAX_REPLY_BYTES) break
        bytes += size
        items.push(item)
      }
      const nextOffset = items.at(-1)?.offset ?? sub.ack
      sub.offered = Math.max(sub.offered, nextOffset)
      this.save(scope.taskId, sub)
      return {
        ...this.status(scope.taskId, sub),
        items,
        nextOffset,
        hasMore: items.length < sub.inbox.length || (sub.mode === 'poll' && sub.nextPollAt === 0),
        retryAfterMs: sub.mode === 'poll' ? Math.max(0, sub.nextPollAt - Date.now()) : 1000,
      }
    } finally {
      this.busy.delete(key)
    }
  }

  private async subscribe(scope: Scope, command: Extract<Command, { action: 'subscribe' }>) {
    const source = scope.source(command.server)
    const id = createHash('sha256')
      .update(canonical([source.fingerprint, command.name, command.arguments]))
      .digest('hex')
    const key = this.key(scope.taskId, id)
    if (this.busy.has(key))
      throw new HttpError(409, 'Another operation is in progress for this subscription')
    this.busy.add(key)
    try {
      const previous = this.load(scope.taskId, id)
      const client = await this.client(scope, source)
      scope.authorize()
      if (previous) {
        if (
          (command.delivery && command.delivery !== previous.mode) ||
          (command.maxAgeMs !== undefined && command.maxAgeMs !== previous.maxAgeMs)
        )
          throw new HttpError(
            409,
            'Remove the existing subscription before changing its delivery settings',
          )
        if (previous.mode === 'push') this.startStream(scope, previous, client)
        return this.status(scope.taskId, previous)
      }
      if (this.list(scope.taskId).length >= 16)
        throw new HttpError(429, 'This thread already has 16 MCP event subscriptions')
      const events = await client.list(scope.signal)
      const event = events?.find((entry) => entry.name === command.name)
      if (!event) throw new HttpError(404, 'MCP event type is not advertised by this server')
      const mode = command.delivery ?? (event.delivery.includes('poll') ? 'poll' : 'push')
      if (!event.delivery.includes(mode))
        throw new HttpError(
          409,
          'The server does not offer poll or push for this event. Webhook-only events need an HTTPS relay.',
        )
      client.validateArguments(event, command.arguments)
      const sub: Subscription = {
        id,
        server: command.server,
        fingerprint: source.fingerprint,
        event,
        arguments: command.arguments,
        mode,
        maxAgeMs: command.maxAgeMs,
        cursor: null,
        nextPollAt: 0,
        offset: 0,
        ack: 0,
        offered: 0,
        inbox: [],
        recent: [],
      }
      if (mode === 'poll') await this.poll(scope, sub, client)
      scope.authorize()
      this.source(scope, sub)
      if (this.list(scope.taskId).length >= 16)
        throw new HttpError(429, 'This thread already has 16 MCP event subscriptions')
      this.save(scope.taskId, sub)
      if (mode === 'push') this.startStream(scope, sub, client)
      return this.status(scope.taskId, sub)
    } finally {
      this.busy.delete(key)
    }
  }

  async reconcile(live: ReadonlySet<string>) {
    const rows = this.db
      .prepare('SELECT DISTINCT task_id FROM mcp_event_subscriptions')
      .all() as Array<{ task_id: string }>
    for (const { task_id } of rows) {
      if (live.has(task_id)) continue
      for (const sub of this.list(task_id)) {
        const key = this.key(task_id, sub.id)
        this.streams.get(key)?.controller.abort()
        this.streams.delete(key)
        this.streamProblems.delete(key)
      }
      this.db.prepare('DELETE FROM mcp_event_subscriptions WHERE task_id=?').run(task_id)
    }
    const closing = []
    for (const [key, entry] of this.stdio) {
      if (live.has(entry.taskId) && (!entry.connection.idle || Date.now() - entry.usedAt < 600_000))
        continue
      this.stdio.delete(key)
      closing.push(entry.connection.close())
    }
    await Promise.all(closing)
  }

  pauseTask(taskId: string) {
    for (const stream of this.streams.values())
      if (stream.taskId === taskId) stream.controller.abort()
  }

  async dispose() {
    const streams = [...this.streams.values()]
    for (const stream of streams) stream.controller.abort()
    this.streams.clear()
    const connections = [...this.stdio.values()]
    this.stdio.clear()
    await Promise.allSettled([
      ...streams.map(({ done }) => done),
      ...connections.map(({ connection }) => connection.close()),
    ])
  }
}
