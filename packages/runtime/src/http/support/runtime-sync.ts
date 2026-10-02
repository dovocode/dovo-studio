import { randomUUID } from 'node:crypto'
import { Effect, Fiber } from 'effect'
import { WebSocket } from 'ws'
import {
  decode,
  compactActivityEvents,
  snapshotDelta,
  activityDelta,
  syncInputSchema,
  type RuntimeSnapshot,
  type SyncFrame,
  type activitySchema,
} from '@dovo/protocol'
import type { Schema } from 'effect'
import type { Services } from '../../services.js'
import { runtimeSnapshot } from './runtime-snapshot.js'
import { scopedWorkspace } from './snapshot-overview.js'
import { snapshotTag } from './body.js'

type ActivityEvent = Schema.Schema.Type<typeof activitySchema>['events'][number]
type Client = {
  socket: WebSocket
  ready: boolean
  detailScopes: Set<string>
  scopes: Map<string, ActivityEvent[]>
  activityRevision: number
  heartbeat: number
  resuming: boolean
  bufferLimit: number
}
type View = {
  taskIds?: readonly string[]
  compact: boolean
  fieldUpdates: boolean
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
) {
  let hub = hubs.get(services)
  if (!hub) {
    hub = new RuntimeSync(services)
    hubs.set(services, hub)
  }
  hub.attach(socket, token, compact, fieldUpdates, taskIds)
}
export async function disposeRuntimeSync(services: Services) {
  const hub = hubs.get(services)
  hubs.delete(services)
  await hub?.dispose()
}
class RuntimeSync {
  private controller = new AbortController()
  private views = new Map<string, View>()
  private timer?: Fiber.RuntimeFiber<never, never>
  private busy = false
  private projection?: { signature: string; checked: number; pending: Promise<RuntimeSnapshot> }
  constructor(private services: Services) {}
  async dispose() {
    this.controller.abort()
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
    if (this.projection) pending.push(this.projection.pending.then(() => {}))
    this.projection = undefined
    await Promise.allSettled(pending)
  }
  attach(
    socket: WebSocket,
    token: string,
    compact: boolean,
    fieldUpdates: boolean,
    taskIds?: readonly string[],
  ) {
    const device = this.services.devices.authenticate(token)
    const viewId = JSON.stringify([
      device.id,
      fieldUpdates ? 'fields' : compact ? 'lean' : 'legacy',
      taskIds ? [...taskIds].sort() : null,
    ])
    let view = this.views.get(viewId)
    if (!view || view.token !== token) {
      view = {
        device,
        taskIds,
        compact,
        fieldUpdates,
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
    const current = view
    clearTimeout(current.expiry)
    const client: Client = {
      socket,
      ready: false,
      scopes: new Map(),
      detailScopes: new Set(),
      activityRevision: -1,
      heartbeat: Date.now(),
      resuming: false,
      bufferLimit: 16 * 1024 * 1024,
    }
    current.clients.add(client)
    // Retain a bounded replay cache for reconnects, without holding inactive device histories forever.
    for (const [id, cached] of this.views) {
      if (this.views.size <= 8) break
      if (!cached.clients.size) {
        clearTimeout(cached.expiry)
        this.views.delete(id)
      }
    }
    const timeout = setTimeout(() => {
      if (!client.ready) socket.close(1008, 'Sync handshake timed out')
    }, 10000)
    socket.on('message', async (raw) => {
      try {
        this.services.devices.authenticate(token)
        const buffer = Buffer.isBuffer(raw)
          ? raw
          : Array.isArray(raw)
            ? Buffer.concat(raw)
            : Buffer.from(raw)
        const input = decode(syncInputSchema, JSON.parse(buffer.toString('utf8')))
        if (input.type === 'watch') {
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
          client.scopes = next
          client.activityRevision = -1
          return
        }
        if (client.resuming) return
        client.resuming = true
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
        if (canReplay) for (const item of replay) this.send(client, item.wire)
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
            sequence: current.sequence,
          } satisfies SyncFrame),
        )
        client.ready = true
        client.resuming = false
        client.heartbeat = Date.now()
        clearTimeout(timeout)
      } catch {
        socket.close(1008, 'Invalid sync request')
      }
    })
    socket.on('close', () => {
      clearTimeout(timeout)
      current.clients.delete(client)
      if (!current.clients.size && !this.controller.signal.aborted) {
        current.expiry = setTimeout(
          () => {
            if (!current.clients.size && this.views.get(viewId) === current)
              this.views.delete(viewId)
          },
          5 * 60 * 1000,
        )
        current.expiry.unref()
      }
      if (![...this.views.values()].some((item) => item.clients.size)) {
        if (this.timer) Effect.runFork(Fiber.interrupt(this.timer))
        this.timer = undefined
        this.projection = undefined
      }
    })
    if (!this.timer) {
      this.timer = Effect.runFork(
        Effect.forever(Effect.promise(() => this.tick()).pipe(Effect.zipRight(Effect.sleep(200)))),
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
      s.approvals.list(),
      s.questions.list(),
      s.terminals.list(),
      s.jobs.list(),
      s.devices.list(),
      s.pairing.pending(),
      s.defaults.get(),
      s.acpInstallations.list(),
    ])
  }
  private async build(view: View, signature: string) {
    const s = this.services
    if (signature === view.signature && Date.now() - view.checked < 15000) return
    // Share the expensive workspace projection/hash across desktop and phone, but filter
    // trust metadata before serializing each authenticated device's own view.
    if (
      !this.projection ||
      this.projection.signature !== signature ||
      Date.now() - this.projection.checked >= 15000
    ) {
      const projection = {
        signature,
        checked: Date.now(),
        pending: Effect.runPromise(runtimeSnapshot(s, { id: 'owner', owner: true }), {
          signal: this.controller.signal,
        }),
      }
      this.projection = projection
      projection.pending.catch(() => {
        if (this.projection === projection) this.projection = undefined
      })
    }
    const prepared = await this.projection.pending
    const common = view.taskIds
      ? {
          ...prepared,
          detailTaskIds: [...view.taskIds],
          workspace: scopedWorkspace(prepared.workspace, view.taskIds),
        }
      : prepared
    const next = view.device.owner
      ? common
      : {
          ...common,
          owner: false,
          devices: common.devices.filter((device) => device.id === view.device.id),
          pendingDevices: [],
        }
    const tag = snapshotTag(next)
    view.signature = signature
    view.checked = Date.now()
    if (!tag || tag === view.tag) return
    const previous = view.snapshot
    const base = view.sequence
    view.sequence++
    view.snapshot = next
    view.tag = tag
    if (!previous) return
    const wire = JSON.stringify({
      type: 'delta',
      epoch: view.epoch,
      sequence: view.sequence,
      base,
      tag,
      delta: snapshotDelta(previous, next, view.compact, view.fieldUpdates),
    } satisfies SyncFrame)
    view.history.push({ sequence: view.sequence, wire })
    view.bytes += wire.length * 2
    while (view.history.length > 256 || view.bytes > 4 * 1024 * 1024)
      view.bytes -= view.history.shift()!.wire.length * 2
    for (const client of view.clients) if (client.ready) this.send(client, wire)
  }
  private async tick() {
    if (this.busy) return
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
        try {
          await this.refresh(view, signature)
          if (this.controller.signal.aborted) return
          for (const client of view.clients) {
            if (!client.ready) continue
            if (client.activityRevision !== this.services.activity.revision) {
              for (const [scope, previous] of client.scopes) {
                const full = this.services.activity.list('', 'task-activity', 0, scope).events
                const events = client.detailScopes.has(scope) ? full : compactActivityEvents(full)
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
                  client.activityRevision === -1 ||
                  changed.length ||
                  events.some((event, index) => event.id !== previous[index]?.id) ||
                  events.length !== previous.length
                )
                  this.send(
                    client,
                    JSON.stringify(
                      view.compact && client.activityRevision !== -1
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
              }
              client.activityRevision = this.services.activity.revision
            }
            // Application-level heartbeat works in both browser and React Native sockets.
            if (Date.now() - client.heartbeat >= 15000) {
              client.heartbeat = Date.now()
              this.send(
                client,
                JSON.stringify({
                  type: 'heartbeat',
                  epoch: view.epoch,
                  sequence: view.sequence,
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
    }
  }
}
