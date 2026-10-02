import { decode } from '../../shared/schema.js'
import { runtimeRequestEffect, setRuntimeSnapshotTag } from '../../shared/client.js'
import {
  applySnapshotDelta,
  applyActivityDelta,
  syncFrameSchema,
  syncTicketSchema,
} from './sync.js'
import type { RuntimeConnection, RuntimeSnapshot } from './runtime.js'
import type { activitySchema } from '../../automation/activity.js'
import { retainActivityEvents, compactActivityEvents } from '../../automation/activity.js'
import { Effect, Fiber, type Schema } from 'effect'

type Events = Schema.Schema.Type<typeof activitySchema>['events']
type Listener = (events: Events) => void
type Registration = {
  tasks: Map<string, number>
  events: Map<string, Events>
  expiry?: ReturnType<typeof setTimeout>
  cursor?: {
    snapshot: RuntimeSnapshot
    epoch: string
    sequence: number
    time: number
    tasks: string
  }

  live?: { online: () => boolean; watch: () => void }
  details: Set<Listener>
  scopes: Map<string, Set<Listener>>
}
const registrations = new Map<string, Registration>()
const key = (connection: RuntimeConnection) =>
  JSON.stringify([connection.address, connection.token])
const registration = (connection: RuntimeConnection) => {
  const id = key(connection)
  let value = registrations.get(id)
  if (!value) {
    value = { tasks: new Map(), scopes: new Map(), events: new Map(), details: new Set() }
    registrations.set(id, value)
  }
  return value
}
/** Reference counted so split panes can share one subscription without dropping each other. */
export function watchRuntimeTask(connection: RuntimeConnection, taskId: string) {
  const value = registration(connection)
  if (!value.tasks.has(taskId) && value.tasks.size >= 8)
    throw new Error('Open at most eight threads per computer.')
  value.tasks.set(taskId, (value.tasks.get(taskId) ?? 0) + 1)
  value.live?.watch()
  let watching = true
  return () => {
    if (!watching) return
    watching = false
    const count = value.tasks.get(taskId) ?? 0
    if (count > 1) value.tasks.set(taskId, count - 1)
    else value.tasks.delete(taskId)
    value.live?.watch()
    if (!value.live && !value.scopes.size && !value.tasks.size && !value.cursor)
      registrations.delete(key(connection))
  }
}
export function runtimeSnapshotPath(connection: RuntimeConnection | null) {
  const query = new URLSearchParams({ scope: 'threads', history: 'paged' })
  if (connection)
    for (const id of registrations.get(key(connection))?.tasks.keys() ?? [])
      query.append('task', id)
  return `/api/snapshot?${query}`
}

export function runtimeSyncOnline(connection: RuntimeConnection | null, scope?: string) {
  const value = connection ? registrations.get(key(connection)) : undefined
  return !!value?.live?.online() && (!scope || [...value.scopes.keys()].slice(0, 8).includes(scope))
}
export function watchRuntimeActivity(
  connection: RuntimeConnection,
  scope: string,
  listener: Listener,
  includeDetails = false,
) {
  const value = registration(connection)
  const listeners = value.scopes.get(scope) ?? new Set<Listener>()
  const cached = value.events.get(scope)
  if (includeDetails) value.details.add(listener)
  if (cached) listener(includeDetails ? cached : compactActivityEvents(cached))
  listeners.add(listener)
  value.scopes.set(scope, listeners)
  value.live?.watch()
  return () => {
    listeners.delete(listener)
    value.details.delete(listener)
    if (!listeners.size) {
      value.scopes.delete(scope)
      value.events.delete(scope)
    }
    value.live?.watch()
    if (!value.live && !value.scopes.size && !value.tasks.size && !value.cursor)
      registrations.delete(key(connection))
  }
}
/** One stream owned by the selected runtime; existing HTTP mutation/outbox semantics stay intact. */
export function startRuntimeSync(
  connection: RuntimeConnection,
  options: {
    onSnapshot: (snapshot: RuntimeSnapshot) => void
    active?: () => boolean
    onWake?: () => void
  },
) {
  const value = registration(connection)
  clearTimeout(value.expiry)
  let socket: WebSocket | undefined
  let stopped = false
  let online = false
  let unsupported = false
  let taskIdentity = JSON.stringify([...value.tasks.keys()].sort())
  const cached =
    value.cursor &&
    value.cursor.tasks === taskIdentity &&
    Date.now() - value.cursor.time < 5 * 60 * 1000
      ? value.cursor
      : undefined
  let epoch: string | undefined = cached?.epoch
  let sequence: number | undefined = cached?.sequence
  let snapshot: RuntimeSnapshot | undefined = cached?.snapshot
  let lastSeen = 0
  let socketStarted = 0
  let failures = 0
  let publishedAt = 0
  let retry: Fiber.RuntimeFiber<void, never> | undefined
  let connecting = false
  let request: AbortController | undefined
  const activities = value.events
  const watch = () => {
    const next = JSON.stringify([...value.tasks.keys()].sort())
    if (next !== taskIdentity) {
      taskIdentity = next
      value.cursor = undefined
      snapshot = undefined
      epoch = undefined
      sequence = undefined
      request?.abort()
      closeSocket()
      options.onWake?.()
      if (!connecting) void connect()
      return
    }
    if (socket?.readyState === 1)
      socket.send(
        JSON.stringify({
          type: 'watch',
          scopes: [...value.scopes.keys()].slice(0, 8),
          detailScopes: [...value.scopes.entries()]
            .filter(([, listeners]) =>
              [...listeners].some((listener) => value.details.has(listener)),
            )
            .map(([scope]) => scope)
            .slice(0, 8),
        }),
      )
  }
  const live = { online: () => online, watch }
  value.live = live
  const publish = () => {
    if (snapshot) options.onSnapshot(snapshot)
  }
  // A suspended native socket may never emit close. Detach it first so late
  // callbacks cannot update the cursor or prevent a replacement connection.
  const closeSocket = () => {
    const previous = socket
    socket = undefined
    online = false
    previous?.close()
  }
  const reconnect = () => {
    online = false
    if (stopped || options.active?.() === false) return
    options.onWake?.()
    if (unsupported || retry || options.active?.() === false) return
    const delay = Math.min(30000, 500 * 2 ** Math.min(failures++, 6))
    retry = Effect.runFork(
      Effect.sleep(Math.round(delay * (0.8 + Math.random() * 0.4))).pipe(
        Effect.zipRight(
          Effect.sync(() => {
            retry = undefined
            void connect()
          }),
        ),
      ),
    )
  }
  const connect = async () => {
    if (stopped || unsupported || connecting || socket || options.active?.() === false) return
    connecting = true
    request = new AbortController()
    try {
      const requestedTasks = taskIdentity
      const query = new URLSearchParams({ format: '4', history: 'paged' })
      for (const id of value.tasks.keys()) query.append('task', id)
      const ticket = await Effect.runPromise(
        runtimeRequestEffect(
          connection,
          connection.address,
          `/api/sync/ticket?${query}`,
          {},
          syncTicketSchema,
          'POST',
          5000,
        ),
        { signal: request.signal },
      )
      if (stopped || requestedTasks !== taskIdentity || options.active?.() === false) return
      const address = new URL('/ws/sync', connection.address)
      address.protocol = address.protocol === 'https:' ? 'wss:' : 'ws:'
      address.searchParams.set('ticket', ticket.ticket)
      const current = new WebSocket(address.href)
      socket = current
      socketStarted = lastSeen = Date.now()
      current.onopen = () => {
        if (stopped || current !== socket) {
          current.close()
          return
        }
        current.send(JSON.stringify({ type: 'resume', epoch, sequence }))
        watch()
      }
      current.onmessage = (event) => {
        if (stopped || current !== socket) return
        try {
          if (typeof event.data !== 'string') throw new Error('Invalid sync frame')
          const frame = decode(syncFrameSchema, JSON.parse(event.data))
          lastSeen = Date.now()
          if (frame.type === 'activity' || frame.type === 'activity-delta') {
            const old = activities.get(frame.scope) ?? []
            const byId = new Map(old.map((item) => [item.id, item]))
            if (frame.type === 'activity') for (const item of frame.events) byId.set(item.id, item)
            const next =
              frame.type === 'activity-delta'
                ? applyActivityDelta(old, frame.delta, frame.scope)
                : frame.order.map((id) => {
                    const item = byId.get(id)
                    if (!item || item.scope !== frame.scope)
                      throw new Error('Activity baseline is missing')
                    return item
                  })
            const events = retainActivityEvents(old, next)
            activities.set(frame.scope, events)
            for (const listener of value.scopes.get(frame.scope) ?? [])
              listener(value.details.has(listener) ? events : compactActivityEvents(events))
            return
          }
          if (frame.type === 'snapshot') {
            snapshot = frame.snapshot
            epoch = frame.epoch
            sequence = frame.sequence
            setRuntimeSnapshotTag(snapshot, frame.tag)
          } else if (frame.type === 'delta') {
            if (
              !snapshot ||
              epoch !== frame.epoch ||
              sequence !== frame.base ||
              frame.sequence !== frame.base + 1
            )
              throw new Error('Sync cursor does not match')
            snapshot = applySnapshotDelta(snapshot, frame.delta)
            sequence = frame.sequence
            setRuntimeSnapshotTag(snapshot, frame.tag)
          } else if (!snapshot || epoch !== frame.epoch || sequence !== frame.sequence)
            throw new Error('Sync needs a fresh baseline')
          if (snapshot && epoch !== undefined && sequence !== undefined)
            value.cursor = { snapshot, epoch, sequence, time: Date.now(), tasks: taskIdentity }
          const becameOnline = !online
          online = true
          failures = 0
          if (becameOnline || frame.type !== 'heartbeat' || Date.now() - publishedAt >= 30000) {
            publishedAt = Date.now()
            publish()
          }
        } catch {
          // Never guess through a gap. Reopen with an empty cursor to request a complete baseline.
          snapshot = undefined
          epoch = undefined
          sequence = undefined
          value.cursor = undefined
          activities.clear()
          online = false
          closeSocket()
          reconnect()
        }
      }
      current.onerror = () => {
        if (current !== socket || stopped) return
        closeSocket()
        reconnect()
      }
      current.onclose = () => {
        if (current === socket) {
          socket = undefined
          reconnect()
        }
      }
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'status' in error &&
        [401, 403, 404].includes(Number(error.status))
      )
        unsupported = true
      reconnect()
    } finally {
      connecting = false
    }
  }
  const timer = Effect.runFork(
    Effect.forever(
      Effect.sleep(1000).pipe(
        Effect.zipRight(
          Effect.sync(() => {
            if (options.active?.() === false) {
              request?.abort()
              closeSocket()
              return
            }
            if (
              socket &&
              ((!online && Date.now() - socketStarted >= 10000) || Date.now() - lastSeen >= 30000)
            ) {
              closeSocket()
              reconnect()
              return
            }
            if (!socket && !retry) void connect()
          }),
        ),
      ),
    ),
  )
  void connect()
  return {
    online: () => online,
    refresh: () => {
      if (socket && Date.now() - lastSeen >= 15000) closeSocket()
      if (socket?.readyState === 1) socket.send(JSON.stringify({ type: 'resume', epoch, sequence }))
      else if (!connecting) {
        if (retry) Effect.runFork(Fiber.interrupt(retry))
        retry = undefined
        void connect()
      }
    },
    stop: () => {
      stopped = true
      request?.abort()
      online = false
      Effect.runFork(Fiber.interrupt(timer))
      if (retry) Effect.runFork(Fiber.interrupt(retry))
      closeSocket()
      if (value.live === live) {
        value.live = undefined
        clearTimeout(value.expiry)
        value.expiry = setTimeout(
          () => {
            if (value.live) return
            value.cursor = undefined
            if (
              !value.scopes.size &&
              !value.tasks.size &&
              registrations.get(key(connection)) === value
            )
              registrations.delete(key(connection))
          },
          5 * 60 * 1000,
        )
        const timer: unknown = value.expiry
        if (
          timer &&
          typeof timer === 'object' &&
          'unref' in timer &&
          typeof timer.unref === 'function'
        )
          timer.unref()
      }
      if (!value.scopes.size && !value.tasks.size && !value.cursor)
        registrations.delete(key(connection))
      for (const [id, entry] of registrations) {
        if (
          !entry.live &&
          !entry.scopes.size &&
          !entry.tasks.size &&
          (registrations.size > 8 ||
            !entry.cursor ||
            Date.now() - entry.cursor.time > 5 * 60 * 1000)
        )
          registrations.delete(id)
      }
    },
  }
}
