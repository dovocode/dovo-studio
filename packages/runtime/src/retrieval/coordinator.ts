import {
  createRuntimeClient,
  decode,
  mutableStruct,
  RuntimeRequestError,
  type RuntimeConnection,
  type RuntimeIcon,
} from '@dovo/protocol'
import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { Schema } from 'effect'
import { runClientEffect } from '@dovo/client-runtime'
import { retrievalContext, retrievalLocal, type RetrievalHook } from './context.js'
import { HttpError } from '../errors.js'
import { pullOperationWrites, type PullOperation, type PullPeerScope } from './pulls.js'
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
type Host = {
  peer: Peer
  id: string
  role: RuntimeIcon
  enabled?: boolean
  pullCommunication?: boolean
}
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
    createRuntimeClient(peer.connection).requestEffect(path, input, schema, {
      method: 'POST',
      timeoutMs: timeout,
    }),
  )

/** One deterministic preferred executor per connected fleet. Remote execution is always local-only,
 * so partial peer views cannot create forwarding loops. PR delegation requires an explicit preference. */
export class SharedRetrieval implements RetrievalHook {
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
  private pullLoads = new Map<string, Promise<unknown>>()
  private pullGeneration = 0
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
    db.exec('CREATE TABLE IF NOT EXISTS pull_owners (scope TEXT PRIMARY KEY, host TEXT NOT NULL)')
    db.exec(
      'CREATE TABLE IF NOT EXISTS peer_pull_cache (key TEXT PRIMARY KEY, scope TEXT NOT NULL, value TEXT NOT NULL, fetched INTEGER NOT NULL)',
    )
  }
  active() {
    return this.local().enabled !== false && this.peers().length > 0
  }
  status() {
    return {
      ...this.local(),
      enabled: this.local().enabled !== false,
      pullCommunication: true,
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
  /** PRs use this computer's configured account unless an executor is explicitly chosen.
   * A paired computer's availability says nothing about its provider permissions. */
  async pull<T, I>(
    scope: PullPeerScope,
    operation: PullOperation,
    schema: Schema.Codec<T, I>,
    load: () => Promise<T>,
  ): Promise<T> {
    if (retrievalContext()?.local) return load()
    if (this.local().enabled === false) return retrievalLocal(load)
    const self = this.local()
    // Ignore legacy automatic assignments: they could pin PRs to a machine without
    // the selected account or a token with access to this repository.
    const owner = self.preferredHost || self.id
    if (owner === self.id) return this.servePull(scope, operation, schema, load)
    let peer = this.peers().find(
      (candidate) => (candidate.connection.runtimeId ?? candidate.id) === owner,
    )
    if (!peer) {
      const host = (await this.candidates()).find((candidate) => candidate.id === owner)
      peer = this.peers().find((candidate) => candidate.id === host?.peer.id)
    }
    if (!peer)
      throw new HttpError(
        503,
        'The PR computer is unavailable. Saved PRs remain available; reconnect it or choose another preferred retrieval computer.',
      )
    const writing = pullOperationWrites(operation)
    if (writing) this.onInvalidate?.()
    try {
      const response = await this.send(
        peer,
        '/api/scm/pulls/peer',
        { owner, scope, operation, fresh: retrievalContext()?.fresh },
        mutableStruct({ host: Schema.String, value: schema }),
        65000,
      )
      if (response.host !== owner)
        throw new HttpError(
          409,
          'The paired PR computer changed. Check its pairing before continuing.',
        )
      return response.value
    } catch (error) {
      if (error instanceof RuntimeRequestError && error.status && error.status < 500)
        throw new HttpError(
          error.status,
          error.status === 404
            ? 'Update the preferred PR computer to use paired PR communication.'
            : error.message,
        )
      if (error instanceof HttpError) throw error
      throw new HttpError(
        503,
        pullOperationWrites(operation)
          ? 'The PR computer did not confirm this action. Refresh before submitting again; it may already have completed.'
          : 'Could not reach the PR computer. Saved PRs remain available; reconnect it to refresh.',
      )
    } finally {
      if (writing) this.onInvalidate?.()
    }
  }
  /** All gateways share the owner's bounded cache. Account verification happens before this call. */
  async servePull<T, I>(
    scope: PullPeerScope,
    operation: PullOperation,
    schema: Schema.Codec<T, I>,
    load: () => Promise<T>,
    fresh = retrievalContext()?.fresh === true,
  ): Promise<T> {
    const account = JSON.stringify([scope.provider, scope.instance, scope.readerIdentity])
    const invalidate = () => {
      this.pullGeneration++
      this.pullLoads.clear()
      this.db.prepare('DELETE FROM peer_pull_cache WHERE scope=?').run(account)
      this.onInvalidate?.()
    }
    if (pullOperationWrites(operation)) {
      invalidate()
      try {
        return await retrievalLocal(load)
      } finally {
        invalidate()
      }
    }
    const key = createHash('sha256')
      .update(JSON.stringify([scope, operation]))
      .digest('hex')
    if (!fresh) {
      const row = decode(
        Schema.UndefinedOr(rowSchema),
        this.db.prepare('SELECT value,fetched FROM peer_pull_cache WHERE key=?').get(key),
      )
      if (row && this.now() >= row.fetched && this.now() - row.fetched < 15000)
        return decode(schema, JSON.parse(row.value))
    }
    const existing = this.pullLoads.get(key)
    if (existing) return decode(schema, await existing)
    const generation = this.pullGeneration
    const pending = Promise.resolve()
      .then(() => retrievalLocal(load))
      .then((loaded) => {
        // Every gateway retains the owner's fetch time, so an older copy cannot look newer
        // merely because it arrived through another computer.
        const value =
          loaded !== null && typeof loaded === 'object' && operation.kind !== 'nativeStack'
            ? decode(schema, { ...loaded, cachedAt: new Date(this.now()).toISOString() })
            : loaded
        const encoded = JSON.stringify(value)
        if (generation === this.pullGeneration && Buffer.byteLength(encoded) <= 1024 * 1024) {
          this.db
            .prepare('INSERT OR REPLACE INTO peer_pull_cache VALUES(?,?,?,?)')
            .run(key, account, encoded, this.now())
          this.db
            .prepare(
              'DELETE FROM peer_pull_cache WHERE key IN (SELECT key FROM peer_pull_cache ORDER BY fetched DESC LIMIT -1 OFFSET 128)',
            )
            .run()
        }
        return value
      })
      .finally(() => {
        if (this.pullLoads.get(key) === pending) this.pullLoads.delete(key)
      })
    this.pullLoads.set(key, pending)
    return pending
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
