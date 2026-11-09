import {
  DurableState,
  startReplication,
  StateProtocolError,
  nextRevision,
} from '@dovo/durable-connections'
import {
  decode,
  decodeThreadRecord,
  validateThreadVersion,
  threadReplicationChannel,
  threadVersionSchema,
  ThreadHistoryChangedError,
  threadRecordKey,
  isRuntimeStateSource,
  createRuntimeClient,
  type ThreadRecord,
  type ThreadVersion,
  type ThreadMetadataEdit,
  type RuntimeConnection,
} from '@dovo/protocol'
import { runClientEffect } from '@dovo/client-runtime'
import { Schema } from 'effect'
import type { WorkspaceStore } from './workspace.js'
import type { RetrievalPeers } from '../retrieval/peers.js'
import { ThreadReplicationJournal } from './thread-replication-journal.js'
import { HttpError } from '../errors.js'

type Peer = { id: string; name: string; connection: RuntimeConnection }
type Session = {
  name: string
  error: string | null
  lastSuccess: string | null
  worker: ReturnType<typeof startReplication<ThreadRecord>>
}
export class ThreadReplication {
  private ready: Promise<DurableState<ThreadRecord>>
  private sessions = new Map<string, Session>()
  private imported = 0
  private failure: string | null = null
  private stopped = false
  private stopPromise?: Promise<void>
  private refreshing?: Promise<void>
  private timer?: ReturnType<typeof setInterval>
  constructor(
    readonly journal: ThreadReplicationJournal,
    store: WorkspaceStore,
    private peers: RetrievalPeers,
  ) {
    this.ready = Promise.resolve()
      .then(() => {
        journal.seed(store)
        return DurableState.open({
          channel: threadReplicationChannel,
          replicaId: journal.replicaId,
          storage: journal.storage(store),
          decode: decodeThreadRecord,
          validateVersion: validateThreadVersion,
          acceptVersion: (version) => {
            if (
              version.deleted ||
              version.value.ownerRuntimeId !== journal.runtimeId ||
              (version.value.kind !== 'message' && version.value.kind !== 'thread') ||
              journal.has(version)
            )
              return true
            if (!journal.generation)
              throw new StateProtocolError(
                'Only the owning runtime can publish thread history and execution status',
              )
            return false
          },
          additionalVersions: journal.generation
            ? (versions, latest) => this.recoverOwned(versions, latest)
            : undefined,
        })
      })
      .catch((error: unknown) => {
        this.disable()
        throw error
      })
    void this.ready.catch(() => undefined) // start() reports initialization failure.
  }
  private async capture(state: DurableState<ThreadRecord>) {
    const pending = this.journal.versions(this.imported)
    await state.importVersions(pending.map((entry) => entry.version))
    this.imported = pending.at(-1)?.sequence ?? this.imported
  }
  private disable() {
    this.failure = 'Thread replication is unavailable. Stored records were preserved for recovery.'
    this.journal.disable()
  }
  available() {
    return this.failure === null
  }
  async start() {
    try {
      await this.initialize()
    } catch (error) {
      this.disable()
      throw error
    }
  }
  private async initialize() {
    const state = await this.ready
    await this.capture(state)
    await this.refresh()
    if (this.stopped || this.timer) return
    this.timer = setInterval(() => {
      void this.refresh().catch((error) =>
        console.error('Thread replication refresh failed', error),
      )
    }, 5000)
    this.timer.unref()
  }
  private authorized(peer: Peer) {
    return (
      !this.stopped &&
      this.peers
        .list(true)
        .some(
          (current) =>
            current.id === peer.id &&
            JSON.stringify(current.connection) === JSON.stringify(peer.connection),
        )
    )
  }
  refresh() {
    if (this.stopped) return Promise.resolve()
    return (this.refreshing ??= this.refreshPeers().finally(() => {
      this.refreshing = undefined
    }))
  }
  private async refreshPeers() {
    const state = await this.ready
    await this.capture(state)
    const active = new Map(
      this.peers
        .list(true)
        .filter((peer) => peer.connection.runtimeId !== this.journal.runtimeId)
        .map((peer) => [JSON.stringify([peer.id, peer.connection]), peer]),
    )
    for (const [id, session] of this.sessions) {
      if (active.has(id) && !this.stopped) continue
      this.sessions.delete(id)
      await session.worker.stop()
    }
    if (this.stopped) return
    for (const [id, peer] of active) {
      if (this.sessions.has(id)) continue
      const session: Session = {
        name: peer.name,
        error: null,
        lastSuccess: null,
        worker: startReplication({
          state,
          peerId: peer.connection.runtimeId,
          beforeExchange: () => this.capture(state),
          exchange: async (request, signal) => {
            if (!this.authorized(peer)) throw new HttpError(403, 'Thread pairing was removed')
            const result = await runClientEffect(
              createRuntimeClient(peer.connection).requestEffect(
                '/api/threads/state/exchange',
                { ...request, targetRuntimeId: peer.connection.runtimeId },
                Schema.Unknown,
                { method: 'POST', timeoutMs: 15000 },
              ),
              signal,
            )
            if (!this.authorized(peer)) throw new HttpError(403, 'Thread pairing was removed')
            const response = decode(
              Schema.Struct({ batch: Schema.Struct({ source: Schema.String }) }),
              result,
            )
            if (
              peer.connection.runtimeId &&
              !isRuntimeStateSource(response.batch.source, peer.connection.runtimeId)
            )
              throw new HttpError(409, 'Thread sync reached a different runtime')
            return result
          },
          afterExchange: () => {
            session.error = null
            session.lastSuccess = new Date().toISOString()
          },
          onError: (error) => {
            session.error = error.message
          },
        }),
      }
      this.sessions.set(id, session)
    }
  }
  private recoverOwned(
    versions: readonly ThreadVersion[],
    latest: readonly ThreadVersion[],
  ): ThreadVersion[] {
    const received = versions.map((version) => decode(threadVersionSchema, version))
    const owned = received.filter(
      (version) =>
        version.value.ownerRuntimeId === this.journal.runtimeId &&
        (version.value.kind === 'message' || version.value.kind === 'thread') &&
        !this.journal.has(version),
    )
    if (!owned.length) return []
    // A restore can receive owner records which no longer exist in its backup. Keep them
    // under a separate, non-executable owner. Never hydrate local jobs from peer history.
    const recoveredOwner = `recovered:${this.journal.replicaId}`
    const recoveryVersion = (version: ThreadVersion): ThreadVersion => {
      if (version.deleted) throw new StateProtocolError('Thread versions cannot be deleted')
      const value: ThreadRecord =
        version.value.kind === 'thread'
          ? {
              ...version.value,
              ownerRuntimeId: recoveredOwner,
              ownerName: `${version.value.ownerName.slice(0, 188)} (recovered)`,
              archived: true,
              removed: false,
              status: 'done',
            }
          : { ...version.value, ownerRuntimeId: recoveredOwner }
      return { ...version, key: threadRecordKey(value), value }
    }
    const missing = owned.filter((version) => !this.journal.has(recoveryVersion(version)))
    if (!missing.length) return []
    const ids = new Set(missing.map((version) => version.value.threadId))
    const current = new Map<string, ThreadVersion>()
    const copies: ThreadVersion[] = []
    for (const id of ids) {
      const versions = this.journal.thread(this.journal.runtimeId, id)
      for (const version of versions) current.set(version.key, version)
      if (!this.journal.summary(recoveredOwner, id)) copies.push(...versions.map(recoveryVersion))
    }
    copies.push(
      ...received.flatMap((version) =>
        version.value.ownerRuntimeId === this.journal.runtimeId && ids.has(version.value.threadId)
          ? [recoveryVersion(version)]
          : [],
      ),
    )
    // The owner publishes corrections above the recovered clock. This removes peer-only
    // messages from the current shared thread while retaining the recovered copy in full.
    const corrections = new Map<string, ThreadRecord>()
    for (const version of missing) {
      const before = current.get(version.key)
      const value =
        before?.value ??
        (version.value.kind === 'message'
          ? { ...version.value, message: null }
          : { ...version.value, removed: true })
      corrections.set(version.key, value)
    }
    for (const id of ids) {
      const descriptor = current.get(JSON.stringify([this.journal.runtimeId, id, 'thread']))
      if (descriptor && !descriptor.deleted && descriptor.value.kind === 'thread')
        corrections.set(descriptor.key, {
          ...descriptor.value,
          historyRevision:
            Math.max(
              descriptor.value.historyRevision,
              ...owned
                .filter(
                  (version) => version.value.threadId === id && version.value.kind === 'thread',
                )
                .map((version) =>
                  version.value.kind === 'thread' ? version.value.historyRevision : 0,
                ),
            ) + 1,
        })
    }
    let updatedAt = nextRevision([...latest, ...copies], Date.now())
    const published: ThreadVersion[] = [...corrections].map(([key, value]) => {
      const version: ThreadVersion = {
        key,
        value,
        deleted: false,
        updatedAt,
        changeId: `${this.journal.replicaId}:recovery:${updatedAt}`,
      }
      updatedAt = nextRevision([version], Date.now())
      return version
    })
    // Copies and owner corrections commit together. A crash cannot mark a peer version
    // recovered without also correcting the current shared thread.
    return [...copies, ...published]
  }
  async exchange(input: unknown) {
    if (this.stopped || this.failure)
      throw new HttpError(503, this.failure ?? 'Thread replication is stopping')
    const target = decode(Schema.Struct({ targetRuntimeId: Schema.optional(Schema.String) }), input)
    if (target.targetRuntimeId && target.targetRuntimeId !== this.journal.runtimeId)
      throw new HttpError(409, 'Thread exchange targets a different runtime')
    const state = await this.ready
    await this.capture(state)
    return state.exchange(input)
  }
  async metadata(edit: ThreadMetadataEdit) {
    if (this.failure) throw new HttpError(503, this.failure)
    const state = await this.ready
    await this.capture(state)
    if (!this.journal.summary(edit.ownerRuntimeId, edit.threadId))
      throw new HttpError(404, 'Shared thread not found')
    const identity = { ownerRuntimeId: edit.ownerRuntimeId, threadId: edit.threadId }
    const record: ThreadRecord =
      edit.field === 'title'
        ? { ...identity, kind: 'title', value: edit.value }
        : edit.field === 'pinned'
          ? { ...identity, kind: 'pinned', value: edit.value }
          : { ...identity, kind: 'snoozedUntil', value: edit.value }
    await state.set(threadRecordKey(record), record)
    return { ok: true }
  }
  read(ownerRuntimeId: string, threadId: string, before?: string) {
    if (this.failure) throw new HttpError(503, this.failure)
    try {
      const task = this.journal.page(ownerRuntimeId, threadId, before)
      if (!task) throw new HttpError(404, 'Shared thread not found')
      return { task }
    } catch (error) {
      if (error instanceof ThreadHistoryChangedError) throw new HttpError(409, error.message)
      throw error
    }
  }
  status() {
    return {
      channel: threadReplicationChannel,
      error: this.failure,
      revision: this.version(),
      peers: [...this.sessions.values()].map((session) => ({
        name: session.name,
        error: session.error,
        lastSuccess: session.lastSuccess,
      })),
    }
  }
  version() {
    return this.failure ? 0 : this.journal.version()
  }
  replicas(detailIds?: readonly string[]) {
    return this.failure ? [] : this.journal.replicas(detailIds)
  }
  search(query: string, id?: string, before?: string) {
    if (this.failure) return { taskIds: [], hits: [] }
    try {
      return this.journal.search(query, id, before)
    } catch (error) {
      if (error instanceof ThreadHistoryChangedError) throw new HttpError(409, error.message)
      throw error
    }
  }
  stop() {
    if (this.stopPromise) return this.stopPromise
    this.stopped = true
    clearInterval(this.timer)
    return (this.stopPromise = (async () => {
      await this.refreshing
      await Promise.all([...this.sessions.values()].map((session) => session.worker.stop()))
      this.sessions.clear()
      await this.ready.then(
        (state) => state.close(),
        () => undefined,
      )
    })())
  }
}
