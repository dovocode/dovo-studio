import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { Effect, Schema } from 'effect'
import { runClientEffect, startPolling } from '@dovo/client-runtime'
import {
  DO_LIMITS,
  decode,
  doDiscoverReplySchema,
  doRemoteDispatchReplySchema,
  doRemoteInspectReplySchema,
  doRemoteStopReplySchema,
  doRunSchema,
  mutableArray,
  mutableStruct,
  runtimeRequestEffect,
  RuntimeRequestError,
  type DoDiscoverReply,
  type DoItem,
  type DoItemState,
  type DoItemStatus,
  type DoPlanItem,
  type DoRemoteDispatchRequest,
  type DoRun,
  type DoRunSummary,
  type DoSaveRequest,
  type DoThreadObservation,
} from '@dovo/protocol'
import type { Services } from '../services.js'
import { HttpError, errorMessage } from '../errors.js'
import type { DoPeers } from './peers.js'
import { doItemPrompt } from './prompt.js'
import type { DoThreads } from './threads.js'

type DoServices = Pick<Services, 'store' | 'preferences' | 'activity' | 'runtimeId'>
type Observation = DoThreadObservation | { unavailable: string }

const rowsSchema = mutableArray(mutableStruct({ value: Schema.String }))
const rowSchema = Schema.UndefinedOr(mutableStruct({ value: Schema.String }))
const LOCAL = 'local'
/** Dispatch may prepare a checkout on the target; observing and stopping are quick. */
const DISPATCH_TIMEOUT = 30_000
const REMOTE_TIMEOUT = 10_000
/** Runs reconciling at once. Each run waits only on its own paired computers. */
const MAX_RECONCILING = 8
/** Paired computers one run observes or stops at once. */
const PEER_CONCURRENCY = 4
/** Dispatches in flight across all runs; each run is also bounded by its `maxConcurrency`. */
const MAX_DISPATCHES = 16
const DISABLED = 'Experimental Do is turned off on this computer. Turn it on to continue this item.'
const active = new Set<DoItemStatus>(['dispatching', 'running', 'waiting', 'blocked'])
const now = () => new Date().toISOString()
const reason = (text: string) => text.slice(0, DO_LIMITS.reason)
/** Items outside a worktree share their project's checkout, so they run one at a time. */
const checkout = (item: DoItem) =>
  item.target.execution === 'worktree'
    ? undefined
    : JSON.stringify([item.target.runtimeId, item.target.repositoryId])
const byRuntime = (items: DoItem[]) => {
  const groups = new Map<string, DoItem[]>()
  for (const item of items)
    groups.set(item.target.runtimeId, [...(groups.get(item.target.runtimeId) ?? []), item])
  return groups
}

/** Runs `work` for each value with at most `limit` in flight. */
async function pooled<T>(values: T[], limit: number, work: (value: T) => Promise<void>) {
  let next = 0
  const worker = async () => {
    while (next < values.length) await work(values[next++])
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker))
}

/** A paired computer is unregistered, unreachable or refused; work items report `blocked`. */
class DoUnavailable extends Error {}

const planItem = ({ id, title, instructions, dependsOn, target }: DoPlanItem) => ({
  id,
  title,
  instructions,
  dependsOn,
  target: {
    runtimeId: target.runtimeId,
    repositoryId: target.repositoryId,
    agentId: target.agentId,
    execution: target.execution,
    linkedCheckouts: target.linkedCheckouts,
  },
})
const samePlan = (
  run: DoRun,
  plan: Pick<DoRun, 'title' | 'goal' | 'maxConcurrency'> & { items: DoPlanItem[] },
) =>
  JSON.stringify([run.title, run.goal, run.maxConcurrency, run.items.map(planItem)]) ===
  JSON.stringify([plan.title, plan.goal, plan.maxConcurrency, plan.items.map(planItem)])

/**
 * Experimental Do runs. Intent is persisted before every side effect, and each work item owns
 * one stable thread key, so polling, retries and restarts reconcile instead of rerunning work.
 */
export class DoRuns {
  private poller?: ReturnType<typeof startPolling>
  private reconciling = new Map<string, Promise<void>>()
  /** Keyed by run, item and attempt, so a slow dispatch is never sent twice concurrently. */
  private dispatches = new Map<string, Promise<void>>()
  private stopped = false
  private controller = new AbortController()
  constructor(
    private db: Database.Database,
    private s: DoServices,
    private threads: DoThreads,
    private peers: DoPeers,
  ) {
    db.exec(
      'CREATE TABLE IF NOT EXISTS do_runs (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, value TEXT NOT NULL)',
    )
  }
  enabled() {
    return this.s.preferences.get().enableDo
  }
  requireEnabled() {
    if (!this.enabled())
      throw new HttpError(403, 'Enable experimental Do in this computer’s settings first')
  }
  private load(id: string) {
    const row = decode(rowSchema, this.db.prepare('SELECT value FROM do_runs WHERE id=?').get(id))
    return row ? decode(doRunSchema, JSON.parse(row.value)) : undefined
  }
  private run(id: string) {
    const run = this.load(id)
    if (!run) throw new HttpError(404, 'Do run not found')
    return run
  }
  private runs(statuses?: DoRun['status'][]) {
    const rows = statuses
      ? this.db
          .prepare(
            `SELECT value FROM do_runs WHERE json_extract(value, '$.status') IN (${statuses.map(() => '?').join(',')}) ORDER BY created_at DESC`,
          )
          .all(...statuses)
      : this.db
          .prepare('SELECT value FROM do_runs ORDER BY created_at DESC LIMIT ?')
          .all(DO_LIMITS.runs)
    return decode(rowsSchema, rows).map((row) => decode(doRunSchema, JSON.parse(row.value)))
  }
  private write(run: DoRun) {
    const next = decode(doRunSchema, { ...run, updatedAt: now() })
    this.db
      .prepare(
        'INSERT INTO do_runs (id, created_at, value) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
      )
      .run(next.id, next.createdAt, JSON.stringify(next))
    return next
  }
  /** Re-reads before every write: HTTP actions can change a run while a tick awaits a peer. */
  private mutate(id: string, change: (run: DoRun) => DoRun | undefined) {
    const run = this.load(id)
    const next = run && change(run)
    return next ? this.write(next) : run
  }
  private item(run: DoRun, id: string, change: (item: DoItem) => Partial<DoItemState>): DoRun {
    return {
      ...run,
      items: run.items.map((item) =>
        item.id === id
          ? { ...item, state: { ...item.state, ...change(item), updatedAt: now() } }
          : item,
      ),
    }
  }
  private key(run: Pick<DoRun, 'id'>, item: Pick<DoItem, 'id'>) {
    return `${this.s.runtimeId}:${run.id}:${item.id}`
  }
  private messageId(run: Pick<DoRun, 'id'>, item: Pick<DoItem, 'id'>, attempt: number) {
    return `do:${run.id}:${item.id}:${attempt}`
  }
  private validateTargets(items: DoPlanItem[]) {
    const workspace = this.s.store.get()
    for (const item of items) {
      if (item.target.runtimeId !== LOCAL) continue
      if (!workspace.repositories.some((repo) => repo.id === item.target.repositoryId))
        throw new HttpError(400, `${item.id}: project not found on this computer`)
      if (
        item.target.agentId &&
        !this.s.store
          .agentsFor(item.target.repositoryId)
          .some((agent) => agent.id === item.target.agentId)
      )
        throw new HttpError(400, `${item.id}: configured agent not found for this project`)
    }
  }

  list(): DoRunSummary[] {
    return this.runs().map((run) => {
      const items: Record<DoItemStatus, number> = {
        pending: 0,
        dispatching: 0,
        running: 0,
        waiting: 0,
        blocked: 0,
        completed: 0,
        failed: 0,
        cancelling: 0,
        cancelled: 0,
      }
      for (const item of run.items) items[item.state.status]++
      return {
        id: run.id,
        revision: run.revision,
        title: run.title,
        status: run.status,
        items,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
      }
    })
  }
  read(id: string) {
    return this.run(id)
  }
  save(input: DoSaveRequest) {
    this.requireEnabled()
    const existing = this.load(input.id)
    const plan = {
      title: input.title,
      goal: input.goal,
      maxConcurrency:
        input.maxConcurrency ?? existing?.maxConcurrency ?? DO_LIMITS.defaultConcurrency,
      // The owning runtime's own ID and `local` name the same computer.
      items: input.items.map((item) =>
        item.target.runtimeId === this.s.runtimeId
          ? { ...item, target: { ...item.target, runtimeId: LOCAL } }
          : item,
      ),
    }
    if (!input.expectedRevision && existing) {
      if (existing.status === 'draft' && samePlan(existing, plan)) return existing
      throw new HttpError(409, 'A Do run with this ID already exists')
    }
    if (input.expectedRevision) {
      if (!existing) throw new HttpError(404, 'Do run not found')
      if (existing.revision !== input.expectedRevision)
        throw new HttpError(409, 'This Do plan changed. Read it again before saving.')
      if (existing.status !== 'draft') throw new HttpError(409, 'Only draft Do runs can be edited')
    } else if (
      decode(Schema.Number, this.db.prepare('SELECT COUNT(*) FROM do_runs').pluck().get()) >=
      DO_LIMITS.runs
    )
      throw new HttpError(409, `Delete finished Do runs first (limit ${DO_LIMITS.runs})`)
    this.validateTargets(plan.items)
    const at = now()
    const run = this.write({
      id: input.id,
      revision: randomUUID(),
      ...plan,
      status: 'draft',
      items: plan.items.map((item) => ({
        ...item,
        state: { status: 'pending', attempt: 0, updatedAt: at },
      })),
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
    })
    return run
  }
  /** A human approves exactly the reviewed plan revision. Retrying that start is a no-op. */
  start(id: string, expectedRevision: string) {
    this.requireEnabled()
    const run = this.run(id)
    if (run.revision !== expectedRevision)
      throw new HttpError(409, 'This Do plan changed. Review it again before starting.')
    if (run.status !== 'draft') {
      if (run.startedAt) return run
      throw new HttpError(409, 'Only draft Do runs can be started')
    }
    this.validateTargets(run.items)
    const started = this.write({ ...run, status: 'running', startedAt: now() })
    this.s.activity.add('task', id, `Do run started: ${run.title}`, { runId: id })
    this.wake()
    return started
  }
  /** Stops only this run's threads; `cancelled` only once every stop is confirmed. */
  cancel(id: string) {
    const run = this.run(id)
    if (run.status === 'cancelled' || run.status === 'cancelling') return run
    if (run.status === 'completed')
      throw new HttpError(409, 'Completed Do runs cannot be cancelled')
    const at = now()
    const items = run.items.map((item): DoItem => {
      const status = item.state.status
      // Attempted items stop by key: a lost dispatch reply may still have created a thread.
      if (active.has(status) || (status === 'pending' && item.state.attempt > 0))
        return { ...item, state: { ...item.state, status: 'cancelling', updatedAt: at } }
      if (status === 'pending')
        return { ...item, state: { ...item.state, status: 'cancelled', updatedAt: at } }
      return item
    })
    const stopping = items.some((item) => item.state.status === 'cancelling')
    const next = this.write({
      ...run,
      items,
      status: stopping ? 'cancelling' : 'cancelled',
      finishedAt: stopping ? undefined : at,
    })
    this.s.activity.add('task', id, `Do run cancel requested: ${run.title}`, { runId: id })
    this.wake()
    return next
  }
  /** Failed and cancelled items continue in their original thread; completed work is kept. */
  retry(id: string, itemIds?: string[]) {
    this.requireEnabled()
    const run = this.run(id)
    if (!['running', 'attention', 'cancelled'].includes(run.status))
      throw new HttpError(409, 'Only running, attention or cancelled Do runs can retry items')
    const retryable = new Set<DoItemStatus>(['failed', 'blocked', 'cancelled'])
    const selected =
      itemIds ?? run.items.filter((item) => retryable.has(item.state.status)).map((item) => item.id)
    if (!selected.length)
      throw new HttpError(409, 'There are no failed, blocked or cancelled items')
    for (const itemId of selected) {
      const item = run.items.find((candidate) => candidate.id === itemId)
      if (!item) throw new HttpError(400, `Unknown item ${itemId}`)
      if (!retryable.has(item.state.status))
        throw new HttpError(
          409,
          `${itemId} is ${item.state.status}; only failed, blocked or cancelled items can retry`,
        )
    }
    let next: DoRun = { ...run, status: 'running', finishedAt: undefined }
    for (const itemId of selected)
      next = this.item(next, itemId, (item) => ({
        // Blocked attempts repeat the same idempotent dispatch; others start a new attempt.
        // The last error stays until the new attempt runs; its follow-up message names it.
        status: item.state.status === 'blocked' ? 'dispatching' : 'pending',
        blockedReason: undefined,
        attention: undefined,
        result: undefined,
        finishedAt: undefined,
      }))
    const saved = this.write(next)
    this.wake()
    return saved
  }
  /** Final human review. Records the decision only; nothing is merged or published. */
  /** Records a decision only, so it stays available while Do is off. */
  complete(id: string, decision: 'accepted' | 'rejected', note?: string) {
    const run = this.run(id)
    if (run.status === 'completed' && run.review?.decision === decision) return run
    if (run.status !== 'review')
      throw new HttpError(409, 'Only Do runs whose items all completed can be reviewed')
    const at = now()
    const saved = this.write({
      ...run,
      status: 'completed',
      review: { decision, note: note?.trim() || undefined, reviewedAt: at },
      finishedAt: at,
    })
    this.s.activity.add('task', id, `Do run ${decision}: ${run.title}`, { runId: id })
    return saved
  }
  /** Drafts and finished runs only; available while Do is off. */
  delete(id: string, expectedRevision: string) {
    const run = this.run(id)
    if (run.revision !== expectedRevision)
      throw new HttpError(409, 'This Do plan changed. Read it again before deleting.')
    if (!['draft', 'cancelled', 'completed'].includes(run.status))
      throw new HttpError(409, 'Cancel this Do run before deleting it')
    this.db.prepare('DELETE FROM do_runs WHERE id=?').run(id)
    return { ok: true as const }
  }
  async discover(runtimeId?: string, repositoryId?: string): Promise<DoDiscoverReply> {
    this.requireEnabled()
    if (!runtimeId || runtimeId === LOCAL) {
      const workspace = this.s.store.get()
      if (repositoryId && !workspace.repositories.some((repo) => repo.id === repositoryId))
        throw new HttpError(404, 'Project not found')
      return {
        runtimeId: LOCAL,
        computers: [
          { id: LOCAL, name: 'This computer', local: true },
          ...(await this.peers.list(this.controller.signal)).map(({ id, name }) => ({
            id,
            name,
            local: false,
          })),
        ],
        projects: workspace.repositories.map(({ id, name }) => ({ id, name })),
        agents: this.s.store
          .agentsFor(repositoryId)
          .map(({ id, name, provider }) => ({ id, name, provider })),
      }
    }
    try {
      const reply = await this.remote(
        runtimeId,
        '/api/do/discover',
        { repositoryId },
        doDiscoverReplySchema,
      )
      return { ...reply, runtimeId, computers: undefined }
    } catch (error) {
      if (error instanceof DoUnavailable) throw new HttpError(503, error.message)
      throw error
    }
  }

  private async remote<S extends Schema.Codec<unknown, unknown>>(
    runtimeId: string,
    path: string,
    input: unknown,
    schema: S,
    timeout = REMOTE_TIMEOUT,
  ): Promise<S['Type']> {
    const peers = await this.peers.list(this.controller.signal)
    const peer = peers.find((candidate) => candidate.id === runtimeId)
    if (!peer)
      throw new DoUnavailable(
        'Paired computer unavailable. Keep Studio open and connected on this computer.',
      )
    try {
      return await runClientEffect(
        runtimeRequestEffect(
          peer.connection,
          peer.connection.address,
          path,
          input,
          schema,
          'POST',
          timeout,
        ),
        this.controller.signal,
      )
    } catch (error) {
      if (!(error instanceof RuntimeRequestError)) throw error
      throw new DoUnavailable(
        reason(
          `${peer.name}: ${
            error.status === 404 && error.message === 'Endpoint not found'
              ? 'update this paired runtime to use Do.'
              : error.message
          }`,
        ),
      )
    }
  }
  private async observeAll(run: DoRun, items: DoItem[]) {
    const observations = new Map<string, Observation>()
    // Paired computers are observed concurrently; one slow computer delays no other.
    const observeGroup = async (runtimeId: string, group: DoItem[]) => {
      if (runtimeId === LOCAL) {
        for (const item of group)
          observations.set(item.id, this.threads.observe(LOCAL, this.key(run, item)))
        return
      }
      try {
        const reply = await this.remote(
          runtimeId,
          '/api/do/remote/inspect',
          { runtimeId, keys: group.map((item) => this.key(run, item)) },
          doRemoteInspectReplySchema,
        )
        for (const item of group) {
          const observation = reply.observations.find((value) => value.key === this.key(run, item))
          observations.set(
            item.id,
            observation ?? { unavailable: 'The paired computer did not report this item' },
          )
        }
      } catch (error) {
        if (!(error instanceof DoUnavailable)) throw error
        for (const item of group) observations.set(item.id, { unavailable: error.message })
      }
    }
    const groups = [...byRuntime(items)]
    // Local observation is synchronous, so it never waits behind a paired computer.
    for (const [runtimeId, group] of groups)
      if (runtimeId === LOCAL) await observeGroup(runtimeId, group)
    await pooled(
      groups.filter(([runtimeId]) => runtimeId !== LOCAL),
      PEER_CONCURRENCY,
      ([runtimeId, group]) => observeGroup(runtimeId, group),
    )
    return observations
  }
  /** Maps a thread observation for the item's current attempt onto its state. */
  private observed(item: DoItem, observation: DoThreadObservation): Partial<DoItemState> {
    const at = now()
    const taskId = observation.taskId ?? item.state.taskId
    if (observation.status === 'queued' || observation.status === 'working')
      return {
        status: 'running',
        taskId,
        attention: undefined,
        blockedReason: undefined,
        error: undefined,
      }
    if (observation.status === 'waiting')
      return {
        status: 'waiting',
        taskId,
        attention: observation.attention,
        blockedReason: undefined,
        error: observation.error,
      }
    if (observation.status === 'finished')
      return {
        status: 'completed',
        taskId,
        attention: undefined,
        blockedReason: undefined,
        error: undefined,
        result: observation.result,
        finishedAt: at,
      }
    if (observation.status === 'failed')
      return {
        status: 'failed',
        taskId,
        attention: undefined,
        blockedReason: undefined,
        error: observation.error ?? 'The thread failed',
        result: observation.result,
        finishedAt: at,
      }
    return {
      status: 'failed',
      taskId,
      attention: undefined,
      blockedReason: undefined,
      error: 'The work item thread no longer exists',
      finishedAt: at,
    }
  }
  private async dispatch(runId: string, itemId: string, attempt: number) {
    const run = this.load(runId)
    const item = run?.items.find((candidate) => candidate.id === itemId)
    if (!run || !item || item.state.status !== 'dispatching' || item.state.attempt !== attempt)
      return
    const request: DoRemoteDispatchRequest = {
      runtimeId: item.target.runtimeId === LOCAL ? this.s.runtimeId : item.target.runtimeId,
      key: this.key(run, item),
      messageId: this.messageId(run, item, attempt),
      title: item.title,
      text: doItemPrompt(run, item, attempt),
      repositoryId: item.target.repositoryId,
      agentId: item.target.agentId,
      execution: item.target.execution,
      linkedCheckouts: item.target.linkedCheckouts,
    }
    let outcome: Observation
    try {
      outcome =
        item.target.runtimeId === LOCAL
          ? (await this.threads.dispatch(LOCAL, request)).observation
          : (
              await this.remote(
                item.target.runtimeId,
                '/api/do/remote/dispatch',
                request,
                doRemoteDispatchReplySchema,
                DISPATCH_TIMEOUT,
              )
            ).observation
    } catch (error) {
      if (!(error instanceof DoUnavailable || error instanceof HttpError)) throw error
      outcome = { unavailable: reason(error.message) }
    }
    this.mutate(runId, (latest) => {
      const current = latest.items.find((candidate) => candidate.id === itemId)
      if (!current || current.state.attempt !== attempt) return undefined
      if (current.state.status !== 'dispatching') {
        // Cancelled meanwhile: remember the thread so the stop can name it.
        if ('unavailable' in outcome || !outcome.taskId || current.state.taskId) return undefined
        const taskId = outcome.taskId
        return this.item(latest, itemId, () => ({ taskId }))
      }
      if ('unavailable' in outcome)
        return this.item(latest, itemId, () => ({
          status: 'blocked',
          blockedReason: outcome.unavailable,
        }))
      if (outcome.messageId !== request.messageId)
        return this.item(latest, itemId, () => ({
          status: 'blocked',
          taskId: outcome.taskId,
          blockedReason: 'The target did not confirm this attempt’s message',
        }))
      return this.item(latest, itemId, (value) => this.observed(value, outcome))
    })
    if (!('unavailable' in outcome) && outcome.taskId)
      this.s.activity.add('task', runId, `Do item ${itemId} dispatched (attempt ${attempt})`, {
        runId,
        itemId,
        runtimeId: item.target.runtimeId,
        taskId: outcome.taskId,
      })
  }
  /** While Do is off, owned threads are still observed but nothing new is sent. */
  private async reconcileRun(runId: string) {
    const run = this.load(runId)
    if (!run || (run.status !== 'running' && run.status !== 'attention')) return
    const enabled = this.enabled()
    // Retried items are pending with an earlier attempt; observe it before starting another.
    const watched = run.items.filter(
      (item) =>
        item.state.attempt > 0 &&
        (active.has(item.state.status) || item.state.status === 'pending'),
    )
    const observations = await this.observeAll(run, watched)
    const redispatch: { id: string; attempt: number }[] = []
    /** Retried items whose previous attempt was observed idle, so a new one may start. */
    const settled = new Set<string>()
    this.mutate(runId, (latest) => {
      // Cancelled, reviewed or completed while observing: these results are stale.
      if (latest.status !== 'running' && latest.status !== 'attention') return undefined
      let next = latest
      for (const before of watched) {
        const item = next.items.find((candidate) => candidate.id === before.id)
        const observation = observations.get(before.id)
        if (
          !item ||
          !observation ||
          item.state.status !== before.state.status ||
          item.state.attempt !== before.state.attempt
        )
          continue
        const expected = this.messageId(next, item, item.state.attempt)
        if ('unavailable' in observation) {
          const blockedReason = observation.unavailable
          next = this.item(next, item.id, (value) =>
            value.state.status === 'dispatching' || value.state.status === 'blocked'
              ? { status: 'blocked', blockedReason }
              : value.state.status === 'pending'
                ? { blockedReason }
                : { blockedReason: `${blockedReason} Status unknown until it reconnects.` },
          )
          continue
        }
        if (item.state.status === 'pending') {
          // A retried item whose previous attempt is still working is adopted, not resent.
          if (
            observation.messageId === expected &&
            ['queued', 'working', 'waiting'].includes(observation.status)
          )
            next = this.item(next, item.id, (value) => this.observed(value, observation))
          else {
            next = this.item(next, item.id, () => ({ blockedReason: undefined }))
            settled.add(item.id)
          }
          continue
        }
        if (observation.messageId !== expected) {
          // Unknown outcome or refused: re-send the same attempt. Its key and message ID make
          // that idempotent; the intent is saved before the request.
          if (item.state.status === 'dispatching' || item.state.status === 'blocked') {
            if (!enabled) {
              next = this.item(next, item.id, () => ({
                status: 'blocked',
                blockedReason: DISABLED,
              }))
              continue
            }
            next = this.item(next, item.id, () => ({ status: 'dispatching' }))
            redispatch.push({ id: item.id, attempt: item.state.attempt })
            continue
          }
          // The thread no longer carries this attempt: it was deleted or replaced.
          next = this.item(next, item.id, (value) =>
            this.observed(value, { ...observation, status: 'missing' }),
          )
          continue
        }
        next = this.item(next, item.id, (value) => this.observed(value, observation))
      }
      // Admit ready items up to the concurrency bound; intent is saved before dispatching.
      const occupied = next.items.filter((item) => active.has(item.state.status))
      const checkouts = new Set(occupied.map(checkout))
      let running = occupied.length
      for (const item of next.items) {
        if (!enabled || running >= next.maxConcurrency) break
        const lane = checkout(item)
        if (
          item.state.status !== 'pending' ||
          // An unobserved earlier attempt may still be working; never start a second one.
          (item.state.attempt > 0 && !settled.has(item.id)) ||
          (lane !== undefined && checkouts.has(lane)) ||
          !item.dependsOn.every(
            (id) =>
              next.items.find((candidate) => candidate.id === id)?.state.status === 'completed',
          )
        )
          continue
        const attempt = item.state.attempt + 1
        next = this.item(next, item.id, (value) => ({
          status: 'dispatching',
          attempt,
          startedAt: value.state.startedAt ?? now(),
          blockedReason: undefined,
        }))
        redispatch.push({ id: item.id, attempt })
        checkouts.add(lane)
        running++
      }
      return next
    })
    // Dispatches outlive this pass: a slow paired computer must not delay observing the rest.
    for (const { id, attempt } of redispatch) this.startDispatch(runId, id, attempt)
    this.mutate(runId, (latest) => {
      if (latest.status !== 'running' && latest.status !== 'attention') return undefined
      const status = this.progress(latest)
      return status === latest.status ? undefined : { ...latest, status }
    })
  }
  /** Intent is already saved as `dispatching`; an item not started now is sent on a later pass. */
  private startDispatch(runId: string, itemId: string, attempt: number) {
    const key = JSON.stringify([runId, itemId, attempt])
    if (this.stopped || this.dispatches.has(key) || this.dispatches.size >= MAX_DISPATCHES) return
    this.dispatches.set(
      key,
      this.dispatch(runId, itemId, attempt)
        .catch((error: unknown) => {
          // Shutdown aborts in-flight peer requests; intent is already persisted for restart.
          if (this.stopped) return
          console.error('Do dispatch failed', error)
          const message = reason(errorMessage(error))
          this.mutate(runId, (latest) =>
            latest.error === message ? undefined : { ...latest, error: message },
          )
        })
        .finally(() => {
          this.dispatches.delete(key)
          this.wake()
        }),
    )
  }
  private progress(run: DoRun): DoRun['status'] {
    if (run.items.every((item) => item.state.status === 'completed')) return 'review'
    const done = (id: string) =>
      run.items.find((item) => item.id === id)?.state.status === 'completed'
    // Blocked items keep their slots.
    const slots = run.items.filter((item) => active.has(item.state.status)).length
    const progressing =
      run.items.some((item) => ['dispatching', 'running', 'waiting'].includes(item.state.status)) ||
      // Ready items progress only while Do is on and a slot is free.
      (this.enabled() &&
        slots < run.maxConcurrency &&
        run.items.some(
          (item) =>
            item.state.status === 'pending' &&
            // Held back until an unreachable earlier attempt can be observed.
            !item.state.blockedReason &&
            item.dependsOn.every(done),
        ))
    return progressing ? 'running' : 'attention'
  }
  private async reconcileCancel(runId: string) {
    const run = this.load(runId)
    if (!run || run.status !== 'cancelling') return
    const stopping = run.items.filter((item) => item.state.status === 'cancelling')
    const results = new Map<string, 'confirmed' | 'requested' | { unavailable: string }>()
    const stopGroup = async (runtimeId: string, group: DoItem[]) => {
      const stops = group.map((item) => ({
        key: this.key(run, item),
        messageId: this.messageId(run, item, item.state.attempt),
      }))
      if (runtimeId === LOCAL) {
        for (const [index, item] of group.entries())
          results.set(item.id, this.threads.stop(LOCAL, stops[index].key, stops[index].messageId))
        return
      }
      try {
        const reply = await this.remote(
          runtimeId,
          '/api/do/remote/stop',
          { runtimeId, stops },
          doRemoteStopReplySchema,
        )
        for (const item of group)
          results.set(
            item.id,
            reply.stops.find((stop) => stop.key === this.key(run, item))?.stop ?? {
              unavailable: 'The paired computer did not confirm this stop',
            },
          )
      } catch (error) {
        if (!(error instanceof DoUnavailable)) throw error
        for (const item of group) results.set(item.id, { unavailable: error.message })
      }
    }
    const groups = [...byRuntime(stopping)]
    for (const [runtimeId, group] of groups)
      if (runtimeId === LOCAL) await stopGroup(runtimeId, group)
    await pooled(
      groups.filter(([runtimeId]) => runtimeId !== LOCAL),
      PEER_CONCURRENCY,
      ([runtimeId, group]) => stopGroup(runtimeId, group),
    )
    this.mutate(runId, (latest) => {
      if (latest.status !== 'cancelling') return undefined
      let next = latest
      for (const [itemId, result] of results) {
        if (next.items.find((item) => item.id === itemId)?.state.status !== 'cancelling') continue
        next = this.item(next, itemId, () =>
          result === 'confirmed'
            ? {
                status: 'cancelled',
                blockedReason: undefined,
                attention: undefined,
                finishedAt: now(),
              }
            : {
                blockedReason:
                  result === 'requested'
                    ? 'Stop requested; waiting for the thread to stop.'
                    : `${result.unavailable} Stop not confirmed.`,
              },
        )
      }
      return next.items.some((item) => item.state.status === 'cancelling')
        ? next
        : { ...next, status: 'cancelled', finishedAt: now() }
    })
  }
  private async reconcile(run: DoRun) {
    try {
      if (run.status === 'cancelling') await this.reconcileCancel(run.id)
      else await this.reconcileRun(run.id)
    } catch (error) {
      // Shutdown aborts in-flight peer requests; intent is already persisted for restart.
      if (this.stopped) return
      const message = reason(errorMessage(error))
      console.error('Do run reconciliation failed', error)
      this.mutate(run.id, (latest) =>
        latest.error === message ? undefined : { ...latest, error: message },
      )
      return
    }
    this.mutate(run.id, (latest) => (latest.error ? { ...latest, error: undefined } : undefined))
  }
  /**
   * Starts reconciling active runs that are not already in flight. Runs proceed independently,
   * so a paired computer that times out delays only the runs waiting on it.
   */
  private schedule() {
    if (this.stopped) return
    // Disabling Do pauses dispatch only; owned threads are still observed and stopped.
    for (const run of this.runs(['running', 'attention', 'cancelling'])) {
      if (this.reconciling.size >= MAX_RECONCILING) break
      if (this.reconciling.has(run.id)) continue
      this.reconciling.set(
        run.id,
        this.reconcile(run)
          .catch((error: unknown) => console.error('Do run reconciliation failed', error))
          .finally(() => this.reconciling.delete(run.id)),
      )
    }
  }
  /** Schedules, then waits for every run and dispatch in flight. */
  async tick() {
    this.schedule()
    await Promise.all(this.reconciling.values())
    await Promise.all(this.dispatches.values())
  }
  wake() {
    this.poller?.refresh()
  }
  startScheduler() {
    if (this.poller || this.stopped) return
    this.poller = startPolling(
      Effect.try(() => this.schedule()),
      { interval: 5_000, onError: (error) => console.error('Do runs failed', error) },
    )
  }
  async dispose() {
    this.stopped = true
    this.controller.abort(new Error('Runtime shutting down'))
    await this.poller?.stop()
    await Promise.all(this.reconciling.values())
    await Promise.all(this.dispatches.values())
  }
}
