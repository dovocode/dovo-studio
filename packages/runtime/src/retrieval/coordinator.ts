import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { Schema } from 'effect'
import {
  decode,
  mutableStruct,
  runtimeRequestEffect,
  RuntimeRequestError,
  type RuntimeConnection,
  type RuntimeIcon,
} from '@dovo/protocol'
import { runClientEffect } from '@dovo/client-runtime'
import { retrievalContext } from './context.js'
import {
  hostPriority,
  retrievalFreshness,
  retrievalHostSchema,
  retrievalResultSchema,
  validateRead,
  type RetrievalRequest,
  type RetrievalResult,
} from './request.js'

type Peer = { id: string; name: string; connection: RuntimeConnection }
type Host = { peer: Peer; id: string; role: RuntimeIcon; enabled?: boolean }
const rowSchema = mutableStruct({ value: Schema.String, fetched: Schema.Number })
const scopeKey = (r: Pick<RetrievalRequest, 'provider' | 'instance' | 'reader'>) =>
  JSON.stringify([r.provider, r.instance, r.reader])
export type RetrievalTransport = <T, I>(
  peer: Peer,
  path: string,
  input: unknown,
  schema: Schema.Codec<T, I>,
  timeout: number,
) => Promise<T>
const transport: RetrievalTransport = (peer, path, input, schema, timeout) =>
  runClientEffect(
    runtimeRequestEffect(
      peer.connection,
      peer.connection.address,
      path,
      input,
      schema,
      'POST',
      timeout,
    ),
  )

/** One deterministic preferred executor per connected fleet. Remote execution is always local-only,
 * so partial peer views cannot create forwarding loops. Every read may safely fall back locally. */
export class SharedRetrieval {
  onInvalidate?: () => void
  private subscriptions = new Map<string, { request: RetrievalRequest; until: number }>()
  private timer?: ReturnType<typeof setInterval>
  private refreshing?: Promise<void>
  private stopped = false
  private refreshLoad?: (request: RetrievalRequest) => Promise<string>
  start(load: (request: RetrievalRequest) => Promise<string>) {
    if (this.timer) return
    this.stopped = false
    this.refreshLoad = load
    this.timer = setInterval(() => {
      void this.tick()
    }, 30000)
    this.timer.unref()
  }
  async stop() {
    this.stopped = true
    clearInterval(this.timer)
    this.timer = undefined
    this.subscriptions.clear()
    await this.refreshing
  }
  tick() {
    if (this.refreshing) return this.refreshing
    this.refreshing = this.refreshSubscriptions().finally(() => {
      this.refreshing = undefined
    })
    return this.refreshing
  }
  private async refreshSubscriptions() {
    for (const [key, subscription] of this.subscriptions) {
      if (this.stopped || this.local().enabled === false) {
        this.subscriptions.clear()
        break
      }
      if (subscription.until <= this.now()) {
        this.subscriptions.delete(key)
        continue
      }
      if (!this.refreshLoad) continue
      try {
        // Renew interest on a restored preferred host; only the executor maintains a lease.
        await this.read(
          { ...subscription.request, fresh: true, watch: true },
          () => this.refreshLoad!(subscription.request),
          true,
        )
      } catch {
        this.counters.refreshFailures++
      }
    }
  }
  private observe(request: RetrievalRequest, renewal = true) {
    if (!request.watch) return
    const key = this.key(request)
    const previous = this.subscriptions.get(key)
    if (!previous && this.subscriptions.size >= 64) return
    this.subscriptions.set(key, {
      request,
      until: !renewal && previous ? previous.until : this.now() + 180000,
    })
  }
  private loads = new Map<string, Promise<RetrievalResult>>()
  private generation = 0
  private hosts?: { until: number; value: Promise<Host[]> }
  private unavailable = new Map<string, number>()
  private counters = {
    local: 0,
    remote: 0,
    cached: 0,
    fallback: 0,
    refreshFailures: 0,
    invalidationFailures: 0,
  }
  constructor(
    private db: Database.Database,
    private local: () => {
      id: string
      role: RuntimeIcon
      enabled?: boolean
      preferredHost?: string
    },
    private peers: () => Peer[],
    private send: RetrievalTransport = transport,
    private now: () => number = Date.now,
  ) {
    db.exec(
      'CREATE TABLE IF NOT EXISTS shared_retrieval (key TEXT PRIMARY KEY, scope TEXT NOT NULL, value TEXT NOT NULL, fetched INTEGER NOT NULL)',
    )
  }
  active() {
    return this.local().enabled !== false && this.peers().length > 0
  }
  status() {
    return {
      ...this.local(),
      enabled: this.local().enabled !== false,
      ...this.counters,
      pending: this.loads.size,
      watches: this.subscriptions.size,
    }
  }
  private candidates() {
    if (!this.hosts || this.hosts.until < this.now()) {
      const peers = this.peers().slice(0, 100)
      this.hosts = {
        until: this.now() + 15000,
        value: Promise.all(
          peers.map(async (peer) => {
            try {
              const host = await this.send(
                peer,
                '/api/retrieval/host',
                {},
                retrievalHostSchema,
                2000,
              )
              if (peer.connection.runtimeId && host.id !== peer.connection.runtimeId)
                return undefined
              return { peer, ...host }
            } catch {
              return undefined
            }
          }),
        ).then((hosts) => hosts.filter((host): host is Host => !!host)),
      }
    }
    return this.hosts.value
  }
  async read(input: RetrievalRequest, load: () => Promise<string>, renewing = false) {
    const request = validateRead({
      ...input,
      fresh: input.fresh || retrievalContext()?.fresh,
      watch: input.watch || retrievalContext()?.watch,
    })
    const self = this.local()
    if (self.enabled === false) return load()
    if (!request.fresh && !request.watch) {
      const cached = this.cached(request)
      if (cached) {
        this.counters.cached++
        return cached.value
      }
    }
    const paired = this.peers()
    const rank = (host: { id: string; role: RuntimeIcon }) =>
      host.id === self.preferredHost ? -1 : hostPriority(host.role)
    const hosts = (await this.candidates())
      .filter(
        (host) =>
          host.enabled !== false &&
          host.id !== self.id &&
          paired.some(
            (peer) =>
              peer.id === host.peer.id &&
              peer.connection.token === host.peer.connection.token &&
              peer.connection.address === host.peer.connection.address,
          ) &&
          (rank(host) < rank(self) || (rank(host) === rank(self) && host.id < self.id)),
      )
      .sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id))
    const generation = this.generation
    const deadline = this.now() + 65000
    for (const host of hosts) {
      if (this.now() >= deadline) break
      if ((this.unavailable.get(host.id + scopeKey(request)) ?? 0) > this.now()) continue
      try {
        const result = await this.send(
          host.peer,
          '/api/retrieval/read',
          request,
          retrievalResultSchema,
          Math.max(1, deadline - this.now()),
        )
        this.counters.remote++
        this.subscriptions.delete(this.key(request))
        // Keep a local copy for disconnected operation, but never mask an upstream failure with it.
        if (generation === this.generation)
          this.store(request, result.value, Math.min(result.fetchedAt, this.now()))
        return result.value
      } catch (error) {
        // Changing executor cannot repair a rejected query or an account-wide rate limit.
        if (error instanceof RuntimeRequestError && (error.status === 429 || error.status === 422))
          throw error
        this.counters.fallback++
        this.unavailable.set(host.id + scopeKey(request), this.now() + 15000)
        if (this.unavailable.size > 128)
          this.unavailable.delete(this.unavailable.keys().next().value!)
      }
    }
    this.observe(request, !renewing)
    return (await this.serve(request, load, false)).value
  }
  private key(request: RetrievalRequest) {
    return createHash('sha256')
      .update(JSON.stringify([scopeKey(request), request.project, request.args, request.input]))
      .digest('hex')
  }
  private cached(request: RetrievalRequest) {
    const row = decode(
      Schema.UndefinedOr(rowSchema),
      this.db
        .prepare('SELECT value,fetched FROM shared_retrieval WHERE key=?')
        .get(this.key(request)),
    )
    return row &&
      this.now() >= row.fetched &&
      this.now() - row.fetched < retrievalFreshness(request)
      ? row
      : undefined
  }
  private store(request: RetrievalRequest, value: string, fetched: number) {
    // Bound both disk usage and the number of entries; large logs are retrieved without persistence.
    if (Buffer.byteLength(value) > 1024 * 1024) return
    this.db
      .prepare('INSERT OR REPLACE INTO shared_retrieval VALUES(?,?,?,?)')
      .run(this.key(request), scopeKey(request), value, fetched)
    this.db
      .prepare(
        'DELETE FROM shared_retrieval WHERE key IN (SELECT key FROM shared_retrieval ORDER BY fetched DESC LIMIT -1 OFFSET 128)',
      )
      .run()
  }
  async serve(
    input: RetrievalRequest,
    load: () => Promise<string>,
    observe = true,
  ): Promise<RetrievalResult> {
    const request = validateRead(input)
    if (this.local().enabled === false)
      throw new Error('Shared retrieval is disabled on this computer')
    if (observe) this.observe(request)
    const key = this.key(request)
    const row = !request.fresh && this.cached(request)
    if (row) {
      this.counters.cached++
      return { value: row.value, fetchedAt: row.fetched, host: this.local().id, cached: true }
    }
    const previous = this.loads.get(key)
    if (previous) return previous
    const generation = this.generation
    const pending = Promise.resolve()
      .then(load)
      .then((value) => {
        const fetchedAt = this.now()
        if (generation === this.generation) this.store(request, value, fetchedAt)
        this.counters.local++
        return { value, fetchedAt, host: this.local().id, cached: false }
      })
      .finally(() => {
        if (this.loads.get(key) === pending) this.loads.delete(key)
      })
    this.loads.set(key, pending)
    return pending
  }
  forget(provider: RetrievalRequest['provider'], instance: string, reader: string) {
    const scope = scopeKey({ provider, instance, reader })
    this.generation++
    this.db.prepare('DELETE FROM shared_retrieval WHERE scope=?').run(scope)
    // A post-write read must not join an older in-flight request.
    this.loads.clear()
    this.onInvalidate?.()
  }
  async invalidate(provider: RetrievalRequest['provider'], instance: string, reader: string) {
    this.forget(provider, instance, reader)
    await Promise.all(
      this.peers().map(async (peer) => {
        try {
          await this.send(
            peer,
            '/api/retrieval/invalidate',
            { provider, instance, reader },
            Schema.Unknown,
            2000,
          )
        } catch {
          this.counters.invalidationFailures++ // Disconnected peers expire their bounded cache naturally.
        }
      }),
    )
  }
}
