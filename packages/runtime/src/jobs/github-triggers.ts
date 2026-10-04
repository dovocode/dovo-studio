import type Database from 'better-sqlite3'
import { z } from 'zod'
import type { Automation, GithubTrigger } from '@dovo/protocol'
import { GithubEvents, githubDeliverySchema } from './github-events.js'
import { HttpError, errorMessage } from '../errors.js'

const stateSchema = z.object({
  signature: z.string(),
  since: z.iso.datetime(),
  startedAt: z.iso.datetime(),
  pending: z.array(githubDeliverySchema),
  heads: z.record(z.string(), z.string()),
})
type State = z.infer<typeof stateSchema>
const rowSchema = z.object({ value: z.string() })

/** Durable polling progress and deliveries, independent of the lifetime of a client. */
export class GithubTriggers {
  private stopped = false
  private busy = false
  private next = new Map<string, number>()
  private signatures = new Map<string, string>()
  private errors = new Map<string, string>()
  constructor(
    private db: Database.Database,
    private events: Pick<GithubEvents, 'collect'> & Partial<Pick<GithubEvents, 'dispose'>>,
    private flows: () => Automation[],
    private start: (id: string, key: string, payload: unknown) => unknown,
    private report: (id: string, message: string) => void,
  ) {}
  private save(id: string, state: State) {
    this.db
      .prepare(
        'INSERT INTO documents VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
      )
      .run(`github-trigger:${id}`, JSON.stringify(state))
  }
  private current(id: string, signature: string) {
    const flow = this.flows().find((flow) => flow.id === id && flow.enabled)
    const config = flow?.nodes.find(
      (node) => node.data.kind === 'trigger' && node.data.trigger === 'github',
    )?.data.github
    return !this.stopped && !!config && JSON.stringify(config) === signature
  }
  async tick(now = Date.now()) {
    if (this.busy || this.stopped) return
    this.busy = true
    try {
      const flows = this.flows()
      const enabled = new Set(
        flows
          .filter(
            (flow) =>
              flow.enabled &&
              flow.nodes.some(
                (node) => node.data.kind === 'trigger' && node.data.trigger === 'github',
              ),
          )
          .map((flow) => flow.id),
      )
      // Pausing or deleting a trigger discards queued external deliveries. Re-enable starts fresh.
      for (const row of this.db
        .prepare("SELECT id FROM documents WHERE id LIKE 'github-trigger:%'")
        .all()) {
        const id = z.object({ id: z.string() }).parse(row).id.slice('github-trigger:'.length)
        if (!enabled.has(id)) {
          this.db.prepare('DELETE FROM documents WHERE id=?').run(`github-trigger:${id}`)
          this.next.delete(id)
          this.signatures.delete(id)
          this.errors.delete(id)
        }
      }
      for (const flow of flows) {
        if (!enabled.has(flow.id) || this.stopped) continue
        const config = flow.nodes.find((node) => node.data.kind === 'trigger')?.data.github
        if (!config) {
          this.fail(flow.id, 'Configure the GitHub trigger before enabling it.')
          continue
        }
        const signature = JSON.stringify(config)
        if (this.signatures.get(flow.id) !== signature) {
          this.next.delete(flow.id)
          this.signatures.set(flow.id, signature)
        }
        try {
          const row = this.db
            .prepare('SELECT value FROM documents WHERE id=?')
            .get(`github-trigger:${flow.id}`)
          let state: State | undefined = row
            ? stateSchema.parse(JSON.parse(rowSchema.parse(row).value))
            : undefined
          if (!state || state.signature !== signature) {
            state = {
              signature,
              since: new Date(now).toISOString(),
              startedAt: new Date(now).toISOString(),
              pending: [],
              heads: {},
            }
            this.save(flow.id, state)
          }
          if ((this.next.get(flow.id) ?? 0) <= now) {
            this.next.set(flow.id, now + 60_000)
            try {
              await this.poll(flow.id, config, state, now)
              this.errors.delete(flow.id)
            } catch (error) {
              this.fail(flow.id, errorMessage(error))
            }
          }
          if (!this.current(flow.id, signature)) continue
          // Keep every accepted event until it can start; a busy automation cannot lose events.
          while (state.pending.length) {
            const delivery = state.pending[0]
            const key = `github:${config.host}:${config.repository}:${delivery.event}:${delivery.id}`
            if (!this.db.prepare('SELECT 1 FROM deliveries WHERE key=?').get(`${flow.id}:${key}`)) {
              try {
                this.start(flow.id, key, delivery)
              } catch (error) {
                if (error instanceof HttpError && error.status === 409) break
                throw error
              }
            }
            state.pending.shift()
            this.save(flow.id, state)
          }
        } catch (error) {
          this.fail(flow.id, errorMessage(error))
        }
      }
    } finally {
      this.busy = false
    }
  }
  private async poll(id: string, config: GithubTrigger, state: State, now: number) {
    // Overlap one minute for GitHub indexing delays; durable receipts remove duplicates.
    const since = new Date(
      Math.max(Date.parse(state.since) - 60_000, Date.parse(state.startedAt)),
    ).toISOString()
    const until = new Date(now).toISOString()
    const result = await this.events.collect(config, since, until, state.heads)
    if (!this.current(id, state.signature)) return
    const pending = new Set(state.pending.map((event) => `${event.event}:${event.id}`))
    for (const delivery of result.deliveries) {
      const key = `${delivery.event}:${delivery.id}`
      if (
        pending.has(key) ||
        this.db
          .prepare('SELECT 1 FROM deliveries WHERE key=?')
          .get(`${id}:github:${config.host}:${config.repository}:${key}`)
      )
        continue
      state.pending.push(delivery)
      pending.add(key)
    }
    state.since = until
    state.heads = result.heads
    this.save(id, state)
  }
  private fail(id: string, message: string) {
    if (this.stopped) return
    if (this.errors.get(id) !== message) this.report(id, `GitHub trigger failed: ${message}`)
    this.errors.set(id, message)
  }
  dispose() {
    this.stopped = true
    this.events.dispose?.()
  }
}
