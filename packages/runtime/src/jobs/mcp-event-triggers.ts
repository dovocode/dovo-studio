import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import {
  mcpEventArguments,
  mcpEventBotId,
  type Automation,
  type McpEventTrigger,
} from '@dovo/protocol'
import { HttpError } from '../errors.js'
import type { McpEventsClient, McpEventType, McpOccurrence } from '../mcp-events/client.js'
import type { McpAutomationInput } from '../mcp-events/subscriptions.js'

type Binding = { botId: string; config: McpEventTrigger; signature: string }
type State = {
  signature: string
  event: McpEventType
  cursor: string | null
  nextPollAt: number
  gapObserved?: boolean
  pending: McpOccurrence[]
}
type Source = {
  identity: string
  client: Pick<McpEventsClient, 'list' | 'validateArguments' | 'poll'>
}
const prefix = 'automation-mcp-event:'

function bindings(flows: readonly Automation[]) {
  const result = new Map<string, Binding>()
  for (const flow of flows) {
    if (!flow.enabled) continue
    const node = flow.nodes.find(
      ({ data }) => data.kind === 'trigger' && data.trigger === 'mcp-event',
    )
    const botId = node && mcpEventBotId(flow)
    const config = node?.data.mcpEvent
    if (botId && config)
      result.set(flow.id, {
        botId,
        config,
        signature: JSON.stringify([botId, config]),
      })
  }
  return result
}

/** Polls with the saved Bot's source scope. Persist delivery and cursor before admitting work. */
export class McpEventTriggers {
  private enabled = new Map<string, Binding>()
  private failures = new Map<string, number>()
  private controller = new AbortController()
  private busy = false

  constructor(
    private db: Database.Database,
    private flows: () => readonly Automation[],
    private source: (botId: string, name: string) => Promise<Source>,
    private start: (
      id: string,
      key: string,
      payload: McpAutomationInput,
      commit: () => undefined,
    ) => void,
    private report: (id: string, message: string) => void,
  ) {
    this.enabled = bindings(flows())
    for (const { id } of db
      .prepare("SELECT id FROM documents WHERE id LIKE 'automation-mcp-event:%'")
      .all() as { id: string }[])
      if (!this.enabled.has(id.slice(prefix.length))) this.delete(id.slice(prefix.length))
  }

  private delete(id: string) {
    this.db.prepare('DELETE FROM documents WHERE id=?').run(prefix + id)
    this.failures.delete(id)
  }

  reconcile() {
    const next = bindings(this.flows())
    for (const [id, previous] of this.enabled) {
      const current = next.get(id)
      if (current?.signature === previous.signature) next.set(id, previous)
      else this.delete(id)
    }
    this.enabled = next
  }

  private load(id: string) {
    const row = this.db.prepare('SELECT value FROM documents WHERE id=?').get(prefix + id) as
      | { value: string }
      | undefined
    return row ? (JSON.parse(row.value) as State) : undefined
  }

  private save(id: string, state: State) {
    this.db
      .prepare(
        'INSERT INTO documents VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
      )
      .run(prefix + id, JSON.stringify(state))
  }

  private current(id: string, binding: Binding) {
    return !this.controller.signal.aborted && this.enabled.get(id) === binding
  }

  status(id: string) {
    const state = this.load(id)
    return {
      enabled: this.enabled.has(id),
      pending: state?.pending.length ?? 0,
      replayAvailable: state?.cursor != null,
      gapObserved: state?.gapObserved === true,
      nextPollAt: this.failures.get(id) ?? state?.nextPollAt,
      retrying: this.failures.has(id),
    }
  }

  private async tickOne(id: string, binding: Binding, now: number) {
    const state = this.load(id)
    if ((this.failures.get(id) ?? 0) > now) return
    if (state && !state.pending.length && state.nextPollAt > now) return
    const { botId, config } = binding
    const source = await this.source(botId, config.server)
    if (!this.current(id, binding)) return
    const signature = JSON.stringify([binding.signature, source.identity])
    let current = state?.signature === signature ? state : undefined
    const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(15000)])
    if (!current) {
      const events = await source.client.list(signal)
      const event = events?.find(
        ({ name, delivery }) => name === config.name && delivery.includes('poll'),
      )
      if (!event) throw new HttpError(400, 'Choose an MCP event that supports poll delivery.')
      source.client.validateArguments(event, mcpEventArguments(config))
      current = { signature, event, cursor: null, nextPollAt: 0, pending: [] }
    }
    if (!current.pending.length) {
      const batch = await source.client.poll(
        current.event,
        {
          name: config.name,
          arguments: mcpEventArguments(config),
          cursor: current.cursor,
        },
        signal,
      )
      if (!this.current(id, binding)) return
      if (
        (await this.source(botId, config.server)).identity !== source.identity ||
        !this.current(id, binding)
      )
        return
      if (Buffer.byteLength(JSON.stringify(batch.events)) > 512 * 1024)
        throw new HttpError(413, 'MCP event payloads exceeded the automation inbox limit.')
      current = {
        ...current,
        cursor: batch.cursor,
        pending: batch.events,
        gapObserved: current.gapObserved || batch.truncated,
        nextPollAt: batch.hasMore
          ? 0
          : now + Math.max(1000, Math.min(batch.nextPollMs, 2 ** 31 - 1)),
      }
      this.save(id, current)
      if (batch.truncated) {
        this.report(id, 'MCP event replay has a gap. Some upstream events may have been missed.')
      }
    }
    while (current.pending.length && this.current(id, binding)) {
      const [event, ...pending] = current.pending
      const key =
        'mcp-event:' +
        createHash('sha256')
          .update(JSON.stringify([signature, event.eventId]))
          .digest('hex')
      const remaining: State = { ...current, pending }
      if (this.db.prepare('SELECT 1 FROM deliveries WHERE key=?').get(`${id}:${key}`)) {
        this.save(id, remaining)
      } else {
        try {
          this.start(id, key, { source: 'mcp-event', server: config.server, event }, () => {
            this.save(id, remaining)
            return undefined
          })
        } catch (error) {
          if (error instanceof HttpError && error.status === 409) return
          throw error
        }
      }
      current = remaining
    }
  }

  async tick(now = Date.now()) {
    if (this.busy || this.controller.signal.aborted) return
    this.busy = true
    try {
      this.reconcile()
      for (const [id, binding] of this.enabled) {
        try {
          await this.tickOne(id, binding, now)
          if ((this.failures.get(id) ?? 0) <= now) this.failures.delete(id)
        } catch (error) {
          if (!this.current(id, binding)) continue
          if (!this.failures.has(id))
            this.report(
              id,
              error instanceof HttpError
                ? error.message
                : 'MCP event polling failed. Check the Bot server and event settings.',
            )
          this.failures.set(id, now + 30000)
        }
      }
    } finally {
      this.busy = false
    }
  }

  dispose() {
    this.controller.abort()
  }
}
