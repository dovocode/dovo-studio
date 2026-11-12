import { randomUUID } from 'node:crypto'
import { Effect, Fiber } from 'effect'
import { WebSocket } from 'ws'
import {
  decode,
  createActivityCompactor,
  snapshotDelta,
  activityDelta,
  syncInputSchema,
  type RuntimeSnapshot,
  type SyncFrame,
  type activitySchema,
} from '@dovo/protocol'
import type { Schema } from 'effect'
import type { Services } from '../../services.js'
import type { Activity } from '../../storage/activity.js'
import { runtimeSnapshot } from './runtime-snapshot.js'
import { memoryAttribution } from '../../diagnostics/memory-attribution.js'
import { snapshotTag } from './body.js'

type ActivityEvent = Schema.Schema.Type<typeof activitySchema>['events'][number]
type Client = {
  socket: WebSocket
  ready: boolean
  detailScopes: Set<string>
  scopes: Map<string, ActivityEvent[]>
  activityVersions: Map<string, number>
  heartbeat: number
  resuming: boolean
  bufferLimit: number
  sequence: number
}
type View = {
  id: string
  taskIds?: readonly string[]
  pagedHistory: boolean
  settledLimit?: number
  compact: boolean
  fieldUpdates: boolean
  incremental: boolean
  fileUpdates: boolean
  device: { id: string; owner: boolean }
  epoch: string
  expiry?: ReturnType<typeof setTimeout>
  token: string
  clients: Set<Client>
  snapshot?: RuntimeSnapshot
  tag?: string
  sequence: number
  signature: string
  checked: number
  history: Array<{ sequence: number; wire: string }>
  bytes: number
  pending?: Promise<void>
}
const hubs = new WeakMap<Services, RuntimeSync>()
export function attachRuntimeSync(
  socket: WebSocket,
  token: string,
  services: Services,
  compact = false,
  fieldUpdates = false,
  taskIds?: readonly string[],
  pagedHistory = false,
  taskUpdates = false,
  settledLimit?: number,
  incremental = false,
  fileUpdates = false,
) {
  let hub = hubs.get(services)
  if (!hub) {
    hub = new RuntimeSync(services)
    hubs.set(services, hub)
  }
  hub.attach(
    socket,
    token,
    compact,
    fieldUpdates,
    taskIds,
    pagedHistory,
    taskUpdates,
    settledLimit,
    incremental,
    fileUpdates,
  )
}
export async function disposeRuntimeSync(services: Services) {
  const hub = hubs.get(services)
  hubs.delete(services)
  await hub?.dispose()
}
class RuntimeSync {
  private controller = new AbortController()
  private views = new Map<string, View>()
  private timer?: Fiber.Fiber<never, never>
  private busy = false
  private wakeup?: ReturnType<typeof setTimeout>
  private stopCommitted?: () => void
  private dirty = false
  private wake() {
    if (this.controller.signal.aborted || this.wakeup) return
    this.wakeup = setTimeout(() => {
      this.wakeup = undefined
      void this.tick()
    }, 20)
    this.wakeup.unref()
  }
  private activityScopes = new Map<
    string,
    {
      watch: ReturnType<Activity['watchScope']>
      users: number
      revision: number
      full: ActivityEvent[]
      compact?: ActivityEvent[]
      compactEvents: ReturnType<typeof createActivityCompactor>
    }
  >()
  private releaseScope(scope: string) {
    const entry = this.activityScopes.get(scope)
    if (entry && !--entry.users) {
      entry.watch.stop()
      this.activityScopes.delete(scope)
    }
  }
  // Share a projection only between identical history scopes. Modern connections must never
  // construct a full-workspace baseline merely to discard most of its histories afterward.
  private projections = new Map<
    string,
    { signature: string; checked: number; pending: Promise<RuntimeSnapshot> }
  >()
  private projectionKey(view: View) {
    return JSON.stringify([
      view.taskIds && [...new Set(view.taskIds)].sort(),
      view.pagedHistory,
      view.settledLimit,
    ])
  }
  constructor(private services: Services) {}
  async dispose() {
    this.controller.abort()
    this.stopCommitted?.()
    clearTimeout(this.wakeup)
    if (this.timer) await Effect.runPromise(Fiber.interrupt(this.timer))
    const pending: Promise<void>[] = []
    for (const view of this.views.values()) {
      clearTimeout(view.expiry)
      if (view.pending) pending.push(view.pending)
      for (const client of view.clients) {
        client.ready = false
        client.socket.close(1001, 'Runtime shutting down')
      }
    }
    this.views.clear()
    for (const entry of this.activityScopes.values()) entry.watch.stop()
    this.activityScopes.clear()
    for (const projection of this.projections.values())
      pending.push(projection.pending.then(() => {}))
    this.projections.clear()
    await Promise.allSettled(pending)
  }
  private view(
    token: string,
    compact: boolean,
    fieldUpdates: boolean,
    taskIds?: readonly string[],
    pagedHistory = false,
    settledLimit?: number,
    incremental = false,
    fileUpdates = false,
  ) {
    const device = this.services.devices.authenticate(token)
    const viewId = JSON.stringify([
      device.id,
      fileUpdates
        ? 'files'
        : incremental
          ? 'incremental'
          : fieldUpdates
            ? 'fields'
            : compact
              ? 'lean'
              : 'legacy',
      taskIds ? [...taskIds].sort() : null,
      pagedHistory,
      settledLimit,
    ])
    let view = this.views.get(viewId)
    if (!view || view.token !== token) {
      view = {
        id: viewId,
        device,
        taskIds,
        pagedHistory,
        settledLimit,
        compact,
        fieldUpdates,
        incremental,
        fileUpdates,
        epoch: randomUUID(),
        token,
        clients: new Set(),
        sequence: 0,
        signature: '',
        checked: 0,
        history: [],
        bytes: 0,
      }
      this.views.set(viewId, view)
    }
    return view
  }
  private leave(view: View, client: Client) {
    view.clients.delete(client)
    if (!view.clients.size && !this.controller.signal.aborted) {
      const key = this.projectionKey(view)
      if (
        ![...this.views.values()].some(
          (other) => other.clients.size && this.projectionKey(other) === key,
        )
      )
        this.projections.delete(key)
      view.expiry = setTimeout(
        () => {
          if (!view.clients.size && this.views.get(view.id) === view) this.views.delete(view.id)
        },
        5 * 60 * 1000,
      )
      view.expiry.unref()
    }
  }
  private trimViews() {
    for (const [id, cached] of this.views) {
      if (this.views.size <= 8) break
      if (!cached.clients.size) {
        clearTimeout(cached.expiry)
        this.views.delete(id)
      }
    }
  }
  attach(
    socket: WebSocket,
    token: string,
    compact: boolean,
    fieldUpdates: boolean,
    taskIds?: readonly string[],
    pagedHistory = false,
    taskUpdates = false,
    settledLimit?: number,
    incremental = false,
    fileUpdates = false,
  ) {
    let current = this.view(
      token,
      compact,
      fieldUpdates,
      taskIds,
      pagedHistory,
      settledLimit,
      incremental,
      fileUpdates,
    )
    clearTimeout(current.expiry)
    const client: Client = {
      socket,
      ready: false,
      scopes: new Map(),
      detailScopes: new Set(),
      activityVersions: new Map(),
      heartbeat: Date.now(),
      resuming: false,
      bufferLimit: 16 * 1024 * 1024,
      sequence: 0,
    }
    current.clients.add(client)
    // Retain a bounded replay cache for reconnects, without holding inactive device histories forever.
    this.trimViews()
    const timeout = setTimeout(() => {
      if (!client.ready) socket.close(1008, 'Sync handshake timed out')
    }, 10000)
    let handling = Promise.resolve()
    let queued = 0
    let pendingWatch: { input: Schema.Schema.Type<typeof syncInputSchema> } | undefined
    socket.on('message', (raw) => {
      let input: Schema.Schema.Type<typeof syncInputSchema>
      try {
        this.services.devices.authenticate(token)
        const buffer = Buffer.isBuffer(raw)
          ? raw
          : Array.isArray(raw)
            ? Buffer.concat(raw)
            : Buffer.from(raw)
        input = decode(syncInputSchema, JSON.parse(buffer.toString('utf8')))
      } catch {
        socket.close(1008, 'Invalid sync request')
        return
      }
      // Watch describes the complete desired selection. Replace obsolete pending work
      // without delaying the first request or crossing an ordered resume barrier.
      if (input.type === 'watch' && pendingWatch?.input.type === 'watch') {
        pendingWatch.input =
          input.tasks !== undefined
            ? input
            : {
                ...pendingWatch.input,
                scopes: input.scopes,
                detailScopes: input.detailScopes,
                watchId: input.watchId ?? pendingWatch.input.watchId,
              }
        return
      }
      const request = { input }
      pendingWatch = input.type === 'watch' ? request : undefined
      if (++queued > 32) {
        queued--
        socket.close(1008, 'Too many sync requests')
        return
      }
      handling = handling.then(async () => {
        try {
          if (pendingWatch === request) pendingWatch = undefined
          if (this.controller.signal.aborted || socket.readyState !== WebSocket.OPEN) return
          this.services.devices.authenticate(token)
          const input = request.input
          if (input.type === 'watch') {
            if (taskUpdates && input.tasks) {
              const nextView = this.view(
                token,
                compact,
                fieldUpdates,
                [...new Set(input.tasks)],
                pagedHistory,
                settledLimit,
                incremental,
                fileUpdates,
              )
              if (nextView !== current) {
                // The view's current snapshot is a valid predecessor only when
                // this client was sent that exact cursor. A lagging client rebases.
                const previous =
                  input.selectionDelta && client.ready && client.sequence === current.sequence
                    ? current.snapshot
                    : undefined
                const previousEpoch = current.epoch
                const base = client.sequence
                client.ready = false
                this.leave(current, client)
                current = nextView
                clearTimeout(current.expiry)
                current.clients.add(client)
                this.trimViews()
                await this.refresh(current)
                if (this.controller.signal.aborted || socket.readyState !== WebSocket.OPEN) return
                const resume = incremental ? input.resume : undefined
                const replay = current.history.filter(
                  (item) => resume && item.sequence > resume.sequence,
                )
                const canResume =
                  resume &&
                  resume.epoch === current.epoch &&
                  resume.sequence <= current.sequence &&
                  (resume.sequence === current.sequence ||
                    replay[0]?.sequence === resume.sequence + 1)
                if (canResume) {
                  this.send(
                    client,
                    JSON.stringify({
                      type: 'selection-resume',
                      epoch: current.epoch,
                      sequence: resume.sequence,
                      through: current.sequence,
                    } satisfies SyncFrame),
                  )
                  client.sequence = resume.sequence
                  this.catchUp(current, client)
                } else if (current.snapshot && current.tag) {
                  this.send(
                    client,
                    JSON.stringify(
                      previous
                        ? ({
                            type: 'selection',
                            previousEpoch,
                            base,
                            epoch: current.epoch,
                            sequence: current.sequence,
                            tag: current.tag,
                            delta: snapshotDelta(
                              previous,
                              current.snapshot,
                              compact,
                              fieldUpdates,
                              incremental,
                              fileUpdates,
                            ),
                          } satisfies SyncFrame)
                        : ({
                            type: 'snapshot',
                            epoch: current.epoch,
                            sequence: current.sequence,
                            tag: current.tag,
                            snapshot: current.snapshot,
                          } satisfies SyncFrame),
                    ),
                  )
                  client.sequence = current.sequence
                }
                client.ready = true
              }
            }
            const details = new Set(input.detailScopes ?? [])
            const next = new Map<string, ActivityEvent[]>()
            for (const scope of input.scopes) {
              if (this.services.store.get().tasks.some((task) => task.id === scope))
                next.set(
                  scope,
                  details.has(scope) === client.detailScopes.has(scope)
                    ? (client.scopes.get(scope) ?? [])
                    : [],
                )
            }
            client.detailScopes = details
            for (const scope of client.scopes.keys()) if (!next.has(scope)) this.releaseScope(scope)
            for (const scope of next.keys()) {
              if (client.scopes.has(scope)) continue
              let entry = this.activityScopes.get(scope)
              if (!entry) {
                entry = {
                  watch: this.services.activity.watchScope(scope, () => this.wake()),
                  users: 0,
                  revision: -1,
                  full: [],
                  compactEvents: createActivityCompactor(),
                }
                this.activityScopes.set(scope, entry)
              }
              entry.users++
            }
            client.scopes = next
            client.activityVersions.clear()
            if (incremental && input.watchId !== undefined)
              this.send(
                client,
                JSON.stringify({ type: 'watch-ack', watchId: input.watchId } satisfies SyncFrame),
              )
            this.wake()
            return
          }
          if (client.resuming) return
          client.resuming = true
          // Frames already sent on this socket precede this acknowledgement. A stale
          // resume crossing a live update must not replay those same deltas again.
          const continuing =
            client.ready &&
            input.epoch === current.epoch &&
            input.sequence !== undefined &&
            input.sequence <= client.sequence
          client.ready = false
          await this.refresh(current)
          if (this.controller.signal.aborted || socket.readyState !== WebSocket.OPEN) return
          const sequence = input.sequence
          const replay = current.history.filter(
            (item) => sequence !== undefined && item.sequence > sequence,
          )
          const canReplay =
            input.epoch === current.epoch &&
            sequence !== undefined &&
            sequence <= current.sequence &&
            (sequence === current.sequence || replay[0]?.sequence === sequence + 1)
          if (continuing) this.catchUp(current, client)
          else if (canReplay) for (const item of replay) this.send(client, item.wire)
          else if (current.snapshot && current.tag)
            this.send(
              client,
              JSON.stringify({
                type: 'snapshot',
                epoch: current.epoch,
                sequence: current.sequence,
                tag: current.tag,
                snapshot: current.snapshot,
              } satisfies SyncFrame),
            )
          this.send(
            client,
            JSON.stringify({
              type: 'heartbeat',
              epoch: current.epoch,
              sequence: continuing ? client.sequence : current.sequence,
            } satisfies SyncFrame),
          )
          client.ready = true
          if (!continuing) client.sequence = current.sequence
          client.resuming = false
          client.heartbeat = Date.now()
          clearTimeout(timeout)
        } catch {
          socket.close(1008, 'Invalid sync request')
        } finally {
          queued--
        }
      })
    })
    socket.on('close', () => {
      clearTimeout(timeout)
      for (const scope of client.scopes.keys()) this.releaseScope(scope)
      client.scopes.clear()
      client.activityVersions.clear()
      this.leave(current, client)
      if (![...this.views.values()].some((item) => item.clients.size)) {
        this.stopCommitted?.()
        this.stopCommitted = undefined
        if (this.timer) Effect.runFork(Fiber.interrupt(this.timer))
        this.timer = undefined
        clearTimeout(this.wakeup)
        this.wakeup = undefined
        this.projections.clear()
      }
    })
    if (!this.timer) {
      this.stopCommitted = this.services.store.onCommitted(() => this.wake())
      this.timer = Effect.runFork(
        Effect.forever(Effect.promise(() => this.tick()).pipe(Effect.andThen(Effect.sleep(200)))),
      )
    }
  }
  private send(client: Client, wire: string) {
    if (client.socket.readyState !== WebSocket.OPEN) return
    if (client.socket.bufferedAmount === 0)
      client.bufferLimit = Math.max(16 * 1024 * 1024, Buffer.byteLength(wire) * 2)
    if (client.socket.bufferedAmount > client.bufferLimit) {
      client.socket.close(1013, 'Sync client is too slow')
      return
    }
    client.socket.send(wire)
  }
  private writable(client: Client) {
    // Bound queued live traffic to a small window. A single baseline/frame may be
    // larger; wait for it to drain instead of piling updates behind it or reconnecting.
    return client.socket.readyState === WebSocket.OPEN && client.socket.bufferedAmount < 64 * 1024
  }
  private catchUp(view: View, client: Client) {
    if (client.sequence === view.sequence || !this.writable(client)) return
    const replay = view.history.filter((item) => item.sequence > client.sequence)
    if (replay[0]?.sequence === client.sequence + 1) {
      for (const item of replay) {
        if (!this.writable(client)) break
        this.send(client, item.wire)
        client.sequence = item.sequence
      }
    } else if (view.snapshot && view.tag) {
      // A healthy peer may have advanced a shared view past the bounded replay cache.
      // Rebase only that lagging client; never send a delta with a missing predecessor.
      this.send(
        client,
        JSON.stringify({
          type: 'snapshot',
          epoch: view.epoch,
          sequence: view.sequence,
          tag: view.tag,
          snapshot: view.snapshot,
        } satisfies SyncFrame),
      )
      client.sequence = view.sequence
    }
  }
  private refresh(view: View, signature?: string): Promise<void> {
    if (view.pending) return view.pending
    const pending = this.build(view, signature ?? this.signature()).finally(() => {
      if (view.pending === pending) view.pending = undefined
    })
    view.pending = pending
    return pending
  }
  private signature() {
    const s = this.services
    return JSON.stringify([
      s.store.version(),
      s.threadReplication.version(),
      s.approvals.list(),
      s.questions.list(),
      s.secureInputs.list(),
      s.terminals.list(),
      s.jobs.revision,
      s.projectTransfers.revision,
      s.devices.version(),
      s.pairing.pending(),
      s.peers.upgrades.pending(),
      s.peers.internet.status(),
      s.peers.relay.status(),
      s.defaults.version(),
      s.acpInstallations.list(),
    ])
  }
  private async build(view: View, signature: string) {
    const s = this.services
    if (signature === view.signature && Date.now() - view.checked < 15000) return
    // Share the expensive workspace projection/hash across desktop and phone, but filter
    // trust metadata before serializing each authenticated device's own view.
    const key = this.projectionKey(view)
    let projection = this.projections.get(key)
    if (
      !projection ||
      projection.signature !== signature ||
      Date.now() - projection.checked >= 15000
    ) {
      projection = {
        signature,
        checked: Date.now(),
        pending: memoryAttribution(s).measure('sync snapshot', () =>
          Effect.runPromise(
            runtimeSnapshot(
              s,
              { id: 'owner', owner: true },
              false,
              view.taskIds,
              view.pagedHistory,
              view.settledLimit,
            ),
            {
              signal: this.controller.signal,
            },
          ),
        ),
      }
      this.projections.set(key, projection)
      const active = projection
      projection.pending.catch(() => {
        if (this.projections.get(key) === active) this.projections.delete(key)
      })
    }
    const common = await projection.pending
    const next = view.device.owner
      ? common
      : {
          ...common,
          owner: false,
          devices: common.devices.filter((device) => device.id === view.device.id),
          pendingDevices: [],
          pendingPeerUpgrades: [],
          internetSetupSupported: !s.peers.internet.contains(view.device.id),
          relaySetupSupported: !s.peers.internet.contains(view.device.id),
        }
    const tag = memoryAttribution(s).measure('sync tag', () => snapshotTag(next))
    view.signature = signature
    view.checked = Date.now()
    if (!tag || tag === view.tag) return
    const previous = view.snapshot
    const base = view.sequence
    view.sequence++
    view.snapshot = next
    view.tag = tag
    if (!previous) return
    const wire = memoryAttribution(s).measure('sync delta', () =>
      JSON.stringify({
        type: 'delta',
        epoch: view.epoch,
        sequence: view.sequence,
        base,
        tag,
        delta: snapshotDelta(
          previous,
          next,
          view.compact,
          view.fieldUpdates,
          view.incremental,
          view.fileUpdates,
        ),
      } satisfies SyncFrame),
    )
    view.history.push({ sequence: view.sequence, wire })
    view.bytes += wire.length * 2
    while (view.history.length > 256 || view.bytes > 4 * 1024 * 1024)
      view.bytes -= view.history.shift()!.wire.length * 2
    for (const client of view.clients) {
      if (!client.ready) continue
      if (client.sequence === base && this.writable(client)) {
        // The latest delta can exceed the replay budget. Healthy clients can still
        // consume it directly, without downloading an even larger full baseline.
        this.send(client, wire)
        client.sequence = view.sequence
      } else this.catchUp(view, client)
    }
  }
  private async tick() {
    if (this.busy) {
      this.dirty = true
      return
    }
    this.busy = true
    try {
      const signature = this.signature()
      for (const view of this.views.values()) {
        if (!view.clients.size) continue
        try {
          this.services.devices.authenticate(view.token)
        } catch {
          for (const client of view.clients)
            client.socket.close(1008, 'Device authentication required')
          continue
        }
        // Coalesce state changes while every reader is backed up. The next writable
        // tick builds one delta from the last published state to the latest workspace.
        if (![...view.clients].some((client) => client.ready && this.writable(client))) continue
        try {
          await this.refresh(view, signature)
          if (this.controller.signal.aborted) return
          for (const client of view.clients) {
            if (!client.ready || !this.writable(client)) continue
            this.catchUp(view, client)
            for (const [scope, previous] of client.scopes) {
              if (!this.writable(client)) break
              const cached = this.activityScopes.get(scope)
              if (!cached) continue
              const revision = cached.watch.revision()
              const initial = !client.activityVersions.has(scope)
              if (!initial && client.activityVersions.get(scope) === revision) continue
              if (cached.revision !== revision) {
                cached.full = this.services.activity.list('', 'task-activity', 0, scope).events
                cached.compact = undefined
                cached.revision = revision
              }
              const events = client.detailScopes.has(scope)
                ? cached.full
                : (cached.compact ??= cached.compactEvents(cached.full))
              const old = new Map(previous.map((event) => [event.id, event]))
              const changed = events.filter((event) => {
                const previous = old.get(event.id)
                return (
                  !previous ||
                  event.payload !== previous.payload ||
                  event.summary !== previous.summary ||
                  event.time !== previous.time ||
                  event.kind !== previous.kind ||
                  event.scope !== previous.scope
                )
              })
              if (
                initial ||
                changed.length ||
                events.some((event, index) => event.id !== previous[index]?.id) ||
                events.length !== previous.length
              )
                this.send(
                  client,
                  JSON.stringify(
                    view.compact && !initial
                      ? ({
                          type: 'activity-delta',
                          scope,
                          delta: activityDelta(previous, events),
                        } satisfies SyncFrame)
                      : ({
                          type: 'activity',
                          scope,
                          order: events.map((event) => event.id),
                          events: changed,
                        } satisfies SyncFrame),
                  ),
                )
              client.scopes.set(scope, events)
              client.activityVersions.set(scope, revision)
            }
            // Application-level heartbeat works in both browser and React Native sockets.
            if (this.writable(client) && Date.now() - client.heartbeat >= 15000) {
              client.heartbeat = Date.now()
              this.send(
                client,
                JSON.stringify({
                  type: 'heartbeat',
                  epoch: view.epoch,
                  sequence: client.sequence,
                } satisfies SyncFrame),
              )
            }
          }
        } catch {
          for (const client of view.clients) client.socket.close(1011, 'Sync unavailable')
        }
      }
    } finally {
      this.busy = false
      if (this.dirty) {
        this.dirty = false
        this.wake()
      }
    }
  }
}
