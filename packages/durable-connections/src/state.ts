import { compareVersions, mergeLatest, nextRevision, type VersionStamp } from './register.js'

export const STATE_MAX_BATCH_BYTES = 8 * 1024 * 1024
// A batch is nested in an exchange with bounded source IDs and a target runtime ID.
export const STATE_MAX_EXCHANGE_BYTES = STATE_MAX_BATCH_BYTES + 16 * 1024

export type StateVersion<T> = VersionStamp &
  ({ deleted: false; value: T } | { deleted: true; value: null })
export interface StateChange<T> {
  sequence: number
  version: StateVersion<T>
}
export interface StateBatch<T> {
  protocol: 1
  channel: string
  source: string
  after: number
  through: number
  changes: StateChange<T>[]
  more: boolean
}
export interface StateRequest<T> {
  batch: StateBatch<T>
  pull: { source?: string; after: number }
}
export interface StateResponse<T> {
  batch: StateBatch<T>
  accepted: { source: string; through: number }
}
export interface StateSnapshot<T> {
  protocol: 1
  channel: string
  replicaId: string
  journal: StateChange<T>[]
  checkpoints: Record<string, number>
  /** Stable paired peer IDs mapped to their last accepted journal actor. */
  sources?: Record<string, string>
}
/** save must atomically replace the snapshot, and resolve only after it is durable.
 * Multiple owners of one key must provide update; use separate keys for independent channels. */
export interface StateStorage {
  load(): unknown
  save(snapshot: unknown): void | Promise<void>
  /** Serializable read/modify/write for stores shared by windows or processes. The callback
   * runs synchronously inside the transaction; resolve with the committed snapshot. */
  update?(change: (current: unknown) => unknown): Promise<unknown>
  /** Optional append-only store. readChanges returns a snapshot envelope with `after`
   * and only journal entries beyond that sequence. The store must reject truncation.
   * append must atomically check the expected sequence and commit records, checkpoints and sources.
   * Do not combine this single-writer interface with update. */
  readChanges?(after: number): unknown
  append?(
    after: number,
    changes: readonly StateChange<unknown>[],
    checkpoints: Readonly<Record<string, number>>,
    sources?: Readonly<Record<string, string>>,
  ): void | Promise<void>
  /** Stable content identity for immutable snapshots (for example the stored JSON string). */
  contentKey?(snapshot: unknown): unknown
}
export interface DurableStateOptions<T> {
  channel: string
  replicaId: string
  storage: StateStorage
  /** Validate JSON without adding, removing or changing data in an existing version.
   * Schema changes need a compatible decoder or a channel migration. */
  decode(value: unknown): T
  /** Validate without changing the version, including its identity. */
  validateVersion?: (version: StateVersion<T>) => void
  validateState?: (latest: readonly StateVersion<T>[]) => void
  /** Ignore echoed records which this replica cannot accept as authoritative. They still
   * advance the sender checkpoint. Keep this decision stable for replayed versions. */
  acceptVersion?: (version: StateVersion<T>) => boolean
  /** Pure domain recovery: append extra versions in the same transaction as an incoming
   * batch and its checkpoint. Called only after batch and replay validation succeeds. */
  additionalVersions?: (
    received: readonly StateVersion<T>[],
    latest: readonly StateVersion<T>[],
  ) => readonly StateVersion<T>[]
  onListenerError?: (error: unknown) => void
  now?: () => number
  batchSize?: number
  maxBatchBytes?: number
}
export class StateProtocolError extends Error {
  override name = 'StateProtocolError'
}
export class StateGapError extends StateProtocolError {
  override name = 'StateGapError'
  constructor(readonly expected: number) {
    super(`State batch has a gap; resume after ${expected}`)
  }
}
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const fail = (message: string): never => {
  throw new StateProtocolError(message)
}
function text(value: unknown): string {
  return typeof value === 'string' && value.length > 0 && value.length <= 1000
    ? value
    : fail('Invalid state identifier')
}
function counter(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : fail('Invalid state sequence')
}
/** Canonical JSON also rejects values which would change silently during persistence. */
function json(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(json).join(',')}]`
  if (object(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)))
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${json(value[key])}`)
      .join(',')}}`
  return fail('State values must be JSON data')
}
const identity = (entry: VersionStamp) =>
  JSON.stringify([entry.key, entry.updatedAt, entry.changeId])
function byteLength(value: string) {
  let size = 0
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0
    size += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4
  }
  return size
}

/** A durable, per-key last-writer-wins register with retained versions and resumable replication.
 * Mutations and source checkpoints become visible only after one atomic storage save. */
export class DurableState<T> {
  private snapshot: StateSnapshot<T>
  private tail: Promise<unknown> = Promise.resolve()
  private closing = false
  private closePromise?: Promise<void>
  private readonly batchSize: number
  private readonly maxBatchBytes: number
  private readonly batchOverhead: number
  private readonly listeners = new Set<() => void>()
  private storedKey: unknown
  private known = new Map<string, StateVersion<T>>()
  private winners = new Map<string, StateVersion<T>>()
  private clock = 0

  private constructor(private options: DurableStateOptions<T>) {
    text(options.channel)
    text(options.replicaId)
    this.batchSize = options.batchSize ?? 128
    this.maxBatchBytes = options.maxBatchBytes ?? STATE_MAX_BATCH_BYTES
    if (!Number.isSafeInteger(this.batchSize) || this.batchSize < 1 || this.batchSize > 10000)
      fail('Invalid state batch size')
    if (!Number.isSafeInteger(this.maxBatchBytes) || this.maxBatchBytes < 4096)
      fail('Invalid state batch byte limit')
    this.batchOverhead =
      byteLength(
        json({
          protocol: 1,
          channel: options.channel,
          source: options.replicaId,
          after: Number.MAX_SAFE_INTEGER,
          through: Number.MAX_SAFE_INTEGER,
          changes: [],
          more: false,
        }),
      ) + 1
    if (this.batchOverhead >= this.maxBatchBytes)
      fail('State identifiers exceed the batch byte limit')
    if (
      !!options.storage.readChanges !== !!options.storage.append ||
      (options.storage.append && options.storage.update)
    )
      fail('Invalid incremental state storage')
    this.snapshot = {
      protocol: 1,
      channel: options.channel,
      replicaId: options.replicaId,
      journal: [],
      checkpoints: {},
    }
  }

  static async open<T>(options: DurableStateOptions<T>) {
    const state = new DurableState(options)
    const stored = await options.storage.load()
    if (stored !== undefined && stored !== null) state.restore(stored)
    state.storedKey = options.storage.contentKey?.(stored)
    return state
  }

  /** Atomically initializes and retains an actor identity with its journal. */
  static async openPersisted<T>(
    options: Omit<DurableStateOptions<T>, 'replicaId'> & { createReplicaId(): string },
  ) {
    const initialize = (current: unknown) => {
      if (current !== undefined && current !== null) return current
      return {
        protocol: 1,
        channel: options.channel,
        replicaId: text(options.createReplicaId()),
        journal: [],
        checkpoints: {},
      }
    }
    let stored: unknown
    if (options.storage.update) stored = await options.storage.update(initialize)
    else {
      const previous = await options.storage.load()
      stored = initialize(previous)
      if (previous === undefined || previous === null) await options.storage.save(stored)
    }
    if (!object(stored)) return fail('Invalid stored state identity')
    const state = new DurableState({ ...options, replicaId: text(stored.replicaId) })
    state.restore(stored)
    state.storedKey = options.storage.contentKey?.(stored)
    return state
  }

  private decodeVersion(value: unknown): StateVersion<T> {
    if (!object(value)) return fail('Invalid state version')
    const stamp = {
      key: text(value.key),
      updatedAt: counter(value.updatedAt),
      changeId: text(value.changeId),
    }
    if (value.deleted !== false && (value.deleted !== true || value.value !== null))
      return fail('Invalid state deletion')
    const original = json({ ...stamp, deleted: value.deleted, value: value.value })
    let version: StateVersion<T>
    if (value.deleted === true) {
      version = { ...stamp, deleted: true, value: null }
    } else {
      // Decode into caller types, then detach and normalize optional properties for transport.
      const detached: unknown = JSON.parse(original)
      if (!object(detached)) return fail('Invalid state version')
      const decoded = this.options.decode(detached.value)
      const normalized: unknown = JSON.parse(json(decoded))
      version = { ...stamp, deleted: false, value: this.options.decode(normalized) }
    }
    this.options.validateVersion?.(version)
    if (json(version) !== original)
      return fail(
        'State schema would change immutable version data. Update connected apps and runtimes before syncing this data.',
      )
    // Every stored record must fit a batch, including after reopening with different limits.
    if (
      this.batchOverhead + byteLength(json({ sequence: Number.MAX_SAFE_INTEGER, version })) >
      this.maxBatchBytes
    )
      fail('State version exceeds the transport byte limit')
    return version
  }

  private decodeSnapshot(value: unknown): StateSnapshot<T> {
    if (
      !object(value) ||
      value.protocol !== 1 ||
      value.channel !== this.options.channel ||
      value.replicaId !== this.options.replicaId ||
      !Array.isArray(value.journal) ||
      !object(value.checkpoints)
    )
      return fail('Stored state does not match this channel and replica')
    const seen = new Set<string>()
    const journal = value.journal.map((change, index) => {
      if (!object(change) || change.sequence !== index + 1) return fail('Invalid stored state log')
      const version = this.decodeVersion(change.version)
      const id = identity(version)
      if (seen.has(id)) return fail('Duplicate version in stored state log')
      seen.add(id)
      return { sequence: index + 1, version }
    })
    const checkpoints = Object.fromEntries(
      Object.entries(value.checkpoints).map(([source, sequence]) => [
        text(source),
        counter(sequence),
      ]),
    )
    const sources = value.sources === undefined ? undefined : this.decodeSources(value.sources)
    this.options.validateState?.(mergeLatest(journal.map((change) => change.version)))
    return {
      protocol: 1,
      channel: this.channel,
      replicaId: this.replicaId,
      journal,
      checkpoints,
      ...(sources ? { sources } : {}),
    }
  }
  private decodeSources(value: unknown): Record<string, string> {
    if (!object(value)) return fail('Invalid state peer sources')
    return Object.fromEntries(
      Object.entries(value).map(([peer, source]) => [text(peer), text(source)]),
    )
  }
  private restore(value: unknown) {
    this.snapshot = this.decodeSnapshot(value)
    this.index(this.snapshot)
  }
  private index(snapshot: StateSnapshot<T>) {
    this.known.clear()
    this.winners.clear()
    this.clock = 0
    this.indexChanges(snapshot.journal)
  }
  private indexChanges(changes: readonly StateChange<T>[]) {
    for (const { version } of changes) {
      this.known.set(identity(version), version)
      const previous = this.winners.get(version.key)
      if (!previous || compareVersions(version, previous) > 0)
        this.winners.set(version.key, version)
      this.clock = Math.max(this.clock, version.updatedAt)
    }
  }
  private rebase(value: unknown) {
    if (value === null || value === undefined) {
      if (
        this.revision ||
        Object.keys(this.snapshot.checkpoints).length ||
        Object.keys(this.snapshot.sources ?? {}).length
      )
        return fail('Durable state storage was removed')
      return this.snapshot
    }
    const contentKey = this.options.storage.contentKey?.(value)
    if (contentKey !== undefined && contentKey === this.storedKey) return this.snapshot
    const current = this.decodeSnapshot(value)
    if (
      current.journal.length < this.revision ||
      this.snapshot.journal.some((change, index) => json(change) !== json(current.journal[index]))
    )
      return fail('Durable state storage history changed')
    if (
      Object.entries(this.snapshot.checkpoints).some(
        ([source, sequence]) =>
          !Object.hasOwn(current.checkpoints, source) || current.checkpoints[source] < sequence,
      )
    )
      return fail('Durable state storage checkpoints changed')
    if (
      current.journal.length === this.revision &&
      json(current.checkpoints) === json(this.snapshot.checkpoints) &&
      json(current.sources ?? {}) === json(this.snapshot.sources ?? {})
    )
      return this.snapshot
    return current
  }
  /** Observe commits from another storage owner without publishing uncommitted writes. */
  refresh() {
    return this.enqueue(async () => {
      if (this.options.storage.readChanges) {
        const value = await this.options.storage.readChanges(this.revision)
        if (
          !object(value) ||
          value.protocol !== 1 ||
          value.channel !== this.channel ||
          value.replicaId !== this.replicaId ||
          value.after !== this.revision ||
          !Array.isArray(value.journal) ||
          !object(value.checkpoints)
        )
          return fail('Invalid incremental state snapshot')
        const seen = new Set<string>()
        const appended = value.journal.map((change, index) => {
          if (!object(change) || change.sequence !== this.revision + index + 1)
            return fail('Invalid incremental state sequence')
          const version = this.decodeVersion(change.version),
            id = identity(version)
          if (this.known.has(id) || seen.has(id)) return fail('Duplicate incremental state version')
          seen.add(id)
          return { sequence: this.revision + index + 1, version }
        })
        const checkpoints = Object.fromEntries(
          Object.entries(value.checkpoints).map(([source, sequence]) => [
            text(source),
            counter(sequence),
          ]),
        )
        const sources = value.sources === undefined ? undefined : this.decodeSources(value.sources)
        if (
          Object.entries(this.snapshot.checkpoints).some(
            ([source, sequence]) =>
              !Object.hasOwn(checkpoints, source) || checkpoints[source] < sequence,
          )
        )
          return fail('Durable state storage checkpoints changed')
        if (
          !appended.length &&
          json(checkpoints) === json(this.snapshot.checkpoints) &&
          json(sources ?? {}) === json(this.snapshot.sources ?? {})
        )
          return
        this.options.validateState?.(
          mergeLatest(
            [...this.winners.values()],
            appended.map(({ version }) => version),
          ),
        )
        this.publish({
          ...this.snapshot,
          journal: [...this.snapshot.journal, ...appended],
          checkpoints,
          sources,
        })
        return
      }
      const stored = await this.options.storage.load()
      const next = this.rebase(stored)
      if (next !== this.snapshot) this.publish(next)
      this.storedKey = this.options.storage.contentKey?.(stored)
    })
  }

  private enqueue<R>(work: () => R | Promise<R>): Promise<R> {
    if (this.closing) return Promise.reject(new Error('Durable state is closed'))
    const result = this.tail.then(work)
    // A failed save rejects its caller but does not poison later retries.
    this.tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private async commit(
    edit: (base: StateSnapshot<T>) => readonly StateVersion<T>[],
    checkpoint?: { source: string; through: number },
    peer?: string,
  ) {
    const build = (base: StateSnapshot<T>): StateSnapshot<T> => {
      const known =
        base === this.snapshot
          ? this.known
          : new Map(base.journal.map(({ version }) => [identity(version), version]))
      const pending = new Map<string, StateVersion<T>>()
      const appended: StateChange<T>[] = []
      for (const version of edit(base)) {
        const previous = pending.get(identity(version)) ?? known.get(identity(version))
        if (previous) {
          if (json(previous) !== json(version))
            fail('A state version was reused with different data')
          continue
        }
        appended.push({ sequence: base.journal.length + appended.length + 1, version })
        pending.set(identity(version), version)
      }
      const changedCheckpoint =
        checkpoint &&
        (Object.hasOwn(base.checkpoints, checkpoint.source)
          ? base.checkpoints[checkpoint.source]
          : 0) < checkpoint.through
      const changedSource =
        checkpoint &&
        peer !== undefined &&
        (!Object.hasOwn(base.sources ?? {}, peer) || base.sources?.[peer] !== checkpoint.source)
      if (!appended.length && !changedCheckpoint && !changedSource) return base
      this.options.validateState?.(mergeLatest([...known.values()], [...pending.values()]))
      return {
        ...base,
        journal: [...base.journal, ...appended],
        checkpoints: changedCheckpoint
          ? { ...base.checkpoints, [checkpoint.source]: checkpoint.through }
          : base.checkpoints,
        ...(changedSource ? { sources: { ...base.sources, [peer]: checkpoint.source } } : {}),
      }
    }
    let next: StateSnapshot<T>
    if (this.options.storage.update) {
      let built: StateSnapshot<T> | undefined
      const stored = await this.options.storage.update((raw) => {
        const base = this.rebase(raw)
        built = build(base)
        return built === base ? raw : built
      })
      if (!built) throw new Error('State transaction did not execute')
      next = built
      this.storedKey = this.options.storage.contentKey?.(stored)
    } else {
      next = build(this.snapshot)
      if (next === this.snapshot) return
      if (this.options.storage.append)
        await this.options.storage.append(
          this.revision,
          next.journal.slice(this.revision),
          next.checkpoints,
          next.sources,
        )
      else {
        const stored: unknown = JSON.parse(json(next))
        await this.options.storage.save(stored)
        this.storedKey = this.options.storage.contentKey?.(stored)
      }
    }
    if (next !== this.snapshot) this.publish(next)
  }

  private publish(next: StateSnapshot<T>) {
    if (next.journal.length >= this.revision && next.journal[0] === this.snapshot.journal[0])
      this.indexChanges(next.journal.slice(this.revision))
    else this.index(next)
    this.snapshot = next
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch (error) {
        try {
          if (this.options.onListenerError) this.options.onListenerError(error)
          else console.error('Durable state subscriber failed', error)
        } catch (reportError) {
          console.error('Durable state error reporter failed', reportError)
        }
      }
    }
  }

  get replicaId() {
    return this.options.replicaId
  }
  get channel() {
    return this.options.channel
  }
  get revision() {
    return this.snapshot.journal.length
  }
  subscribe(listener: () => void) {
    if (this.closing) throw new Error('Durable state is closed')
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  checkpoint(source: string) {
    return Object.hasOwn(this.snapshot.checkpoints, source) ? this.snapshot.checkpoints[source] : 0
  }
  sourceFor(peer: string) {
    return Object.hasOwn(this.snapshot.sources ?? {}, peer)
      ? (this.snapshot.sources?.[peer] ?? peer)
      : peer
  }
  versions(): StateVersion<T>[] {
    return this.snapshot.journal.map((change) => this.decodeVersion(change.version))
  }
  latest(): StateVersion<T>[] {
    return [...this.winners.values()]
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .map((entry) => this.decodeVersion(entry))
  }
  get(key: string): T | undefined {
    const winner = this.winners.get(key)
    return winner && !winner.deleted ? (this.decodeVersion(winner).value ?? undefined) : undefined
  }
  history(key: string) {
    return this.versions()
      .filter((entry) => entry.key === key)
      .sort((a, b) => compareVersions(b, a))
  }
  importVersions(versions: readonly StateVersion<T>[]) {
    // Capture input before any asynchronous wait; callers retain no mutable references.
    const decoded = versions.map((version) => this.decodeVersion(version))
    return this.enqueue(() => this.commit(() => decoded))
  }
  private write(key: string, value: T | null, deleted: boolean) {
    text(key)
    const detached: unknown = deleted ? null : JSON.parse(json(value))
    return this.enqueue(async () => {
      let written: StateVersion<T> | undefined
      await this.commit((base) => {
        const updatedAt = nextRevision(
          base === this.snapshot
            ? this.revision
              ? [{ key: '', changeId: '', updatedAt: this.clock }]
              : []
            : base.journal.map((change) => change.version),
          this.options.now?.() ?? Date.now(),
        )
        written = this.decodeVersion({
          key,
          updatedAt,
          changeId: `${this.replicaId}:${updatedAt}`,
          value: detached,
          deleted,
        })
        return [written]
      })
      if (!written) throw new Error('State write did not commit')
      return this.decodeVersion(written)
    })
  }
  set(key: string, value: T) {
    return this.write(key, value, false)
  }
  delete(key: string) {
    return this.write(key, null, true)
  }
  restoreVersion(version: StateVersion<T>) {
    const decoded = this.decodeVersion(version)
    return decoded.deleted ? this.delete(decoded.key) : this.set(decoded.key, decoded.value)
  }

  batch(after = 0): StateBatch<T> {
    counter(after)
    if (after > this.revision) return fail('State cursor is ahead of the source')
    const changes: StateChange<T>[] = []
    let bytes = this.batchOverhead
    for (const change of this.snapshot.journal.slice(after, after + this.batchSize)) {
      const size = byteLength(json(change))
      if (bytes + size > this.maxBatchBytes) break
      bytes += size + 1
      changes.push(change)
    }
    const through = changes.at(-1)?.sequence ?? after
    return {
      protocol: 1,
      channel: this.channel,
      source: this.replicaId,
      after,
      through,
      changes: changes.map((change) => ({
        sequence: change.sequence,
        version: this.decodeVersion(change.version),
      })),
      more: through < this.revision,
    }
  }

  private decodeBatch(value: unknown): StateBatch<T> {
    if (
      !object(value) ||
      value.protocol !== 1 ||
      value.channel !== this.channel ||
      !Array.isArray(value.changes) ||
      typeof value.more !== 'boolean'
    )
      return fail('Invalid state batch or channel')
    if (value.changes.length > 10000 || byteLength(json(value)) > this.maxBatchBytes)
      return fail('State batch exceeds transport limits')
    const source = text(value.source),
      after = counter(value.after),
      through = counter(value.through)
    if (through !== after + value.changes.length) return fail('State batch is not contiguous')
    if (value.more && through === after) return fail('State batch makes no progress')
    const changes = value.changes.map((change, index) => {
      if (!object(change) || change.sequence !== after + index + 1)
        return fail('State batch is not contiguous')
      return { sequence: change.sequence, version: this.decodeVersion(change.version) }
    })
    return { protocol: 1, channel: this.channel, source, after, through, changes, more: value.more }
  }

  receive(value: unknown, peer?: string) {
    const batch = this.decodeBatch(value)
    if (peer !== undefined) text(peer)
    return this.enqueue(async () => {
      if (batch.source === this.replicaId) return fail('Replicas must have unique identities')
      await this.commit(
        (base) => {
          const cursor = Object.hasOwn(base.checkpoints, batch.source)
            ? base.checkpoints[batch.source]
            : 0
          if (batch.after > cursor) throw new StateGapError(cursor)
          const known =
            base === this.snapshot
              ? this.known
              : new Map(base.journal.map((change) => [identity(change.version), change.version]))
          const accepted = batch.changes.filter(
            (change) => this.options.acceptVersion?.(change.version) !== false,
          )
          if (
            accepted.some(
              (change) => change.sequence <= cursor && !known.has(identity(change.version)),
            )
          )
            return fail('A replayed state sequence changed')
          // Replayed prefixes are still checked for identity collisions, then deduplicated.
          const incoming = batch.changes.filter((change) => change.sequence > cursor)
          const extra =
            incoming.length && this.options.additionalVersions
              ? this.options
                  .additionalVersions(
                    incoming.map((change) => change.version),
                    base === this.snapshot
                      ? [...this.winners.values()]
                      : mergeLatest([...known.values()]),
                  )
                  .map((version) => this.decodeVersion(version))
              : []
          return [...accepted.map((change) => change.version), ...extra]
        },
        { source: batch.source, through: batch.through },
        peer,
      )
      return { source: batch.source, through: this.checkpoint(batch.source) }
    })
  }

  request(peer?: string, sentThrough = 0): StateRequest<T> {
    const source = peer === undefined ? undefined : this.sourceFor(peer)
    return {
      batch: this.batch(sentThrough),
      pull: { source, after: source ? this.checkpoint(source) : 0 },
    }
  }
  async exchange(input: unknown): Promise<StateResponse<T>> {
    if (this.options.storage.update) await this.refresh()
    if (!object(input) || !object(input.pull)) return fail('Invalid state exchange')
    const after = counter(input.pull.after)
    const source = input.pull.source === undefined ? undefined : text(input.pull.source)
    if (source === this.replicaId && after > this.revision)
      return fail('State cursor is ahead of the source')
    const accepted = await this.receive(input.batch)
    return { accepted, batch: this.batch(source === this.replicaId ? after : 0) }
  }
  async accept(input: unknown, peer?: string) {
    if (this.options.storage.update) await this.refresh()
    if (!object(input) || !object(input.accepted) || input.accepted.source !== this.replicaId)
      return fail('Invalid state acknowledgement')
    const through = counter(input.accepted.through)
    if (through > this.revision) return fail('State acknowledgement is ahead of the source')
    const batch = this.decodeBatch(input.batch)
    await this.receive(batch, peer)
    return { peer: batch.source, sentThrough: through, more: batch.more || through < this.revision }
  }
  close() {
    this.closing = true
    return (this.closePromise ??= this.tail.then(() => {
      this.listeners.clear()
    }))
  }
}
