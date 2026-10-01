import { decode } from '../../shared/schema.js'
import { runtimeRequest, setRuntimeSnapshotTag } from '../../shared/client.js'
import { applySnapshotDelta, syncFrameSchema, syncTicketSchema } from './sync.js'
import type { RuntimeConnection, RuntimeSnapshot } from './runtime.js'
import type { activitySchema } from '../../automation/activity.js'
import { retainActivityEvents } from '../../automation/activity.js'
import type { Schema } from 'effect'

type Events = Schema.Schema.Type<typeof activitySchema>['events']
type Listener = (events: Events) => void
type Registration = {
  events: Map<string, Events>
  expiry?: ReturnType<typeof setTimeout>
  cursor?: { snapshot: RuntimeSnapshot; epoch: string; sequence: number; time: number }

  live?: { online: () => boolean; watch: () => void }
  scopes: Map<string, Set<Listener>>
}
const registrations = new Map<string, Registration>()
const key = (connection: RuntimeConnection) =>
  JSON.stringify([connection.address, connection.token])
const registration = (connection: RuntimeConnection) => {
  const id = key(connection)
  let value = registrations.get(id)
  if (!value) {
    value = { scopes: new Map(), events: new Map() }
    registrations.set(id, value)
  }
  return value
}
export function runtimeSyncOnline(connection: RuntimeConnection | null, scope?: string) {
  const value = connection ? registrations.get(key(connection)) : undefined
  return !!value?.live?.online() && (!scope || [...value.scopes.keys()].slice(0, 8).includes(scope))
}
export function watchRuntimeActivity(
  connection: RuntimeConnection,
  scope: string,
  listener: Listener,
) {
  const value = registration(connection)
  const listeners = value.scopes.get(scope) ?? new Set<Listener>()
  const cached = value.events.get(scope)
  if (cached) listener(cached)
  listeners.add(listener)
  value.scopes.set(scope, listeners)
  value.live?.watch()
  return () => {
    listeners.delete(listener)
    if (!listeners.size) {
      value.scopes.delete(scope)
      value.events.delete(scope)
    }
    value.live?.watch()
    if (!value.live && !value.scopes.size && !value.cursor) registrations.delete(key(connection))
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
  const cached =
    value.cursor && Date.now() - value.cursor.time < 5 * 60 * 1000 ? value.cursor : undefined
  let epoch: string | undefined = cached?.epoch
  let sequence: number | undefined = cached?.sequence
  let snapshot: RuntimeSnapshot | undefined = cached?.snapshot
  let lastSeen = 0
  let failures = 0
  let retry: ReturnType<typeof setTimeout> | undefined
  let connecting = false
  let request: AbortController | undefined
  const activities = value.events
  const watch = () => {
    if (socket?.readyState === 1)
      socket.send(JSON.stringify({ type: 'watch', scopes: [...value.scopes.keys()].slice(0, 8) }))
  }
  const live = { online: () => online, watch }
  value.live = live
  const publish = () => {
    if (snapshot) options.onSnapshot(snapshot)
  }
  const reconnect = () => {
    online = false
    if (stopped) return
    options.onWake?.()
    if (unsupported || retry || options.active?.() === false) return
    retry = setTimeout(
      () => {
        retry = undefined
        void connect()
      },
      Math.min(10000, 500 * 2 ** Math.min(failures++, 5)),
    )
  }
  const connect = async () => {
    if (stopped || unsupported || connecting || options.active?.() === false) return
    connecting = true
    request = new AbortController()
    try {
      const ticket = await runtimeRequest(
        connection,
        connection.address,
        '/api/sync/ticket',
        {},
        syncTicketSchema,
        'POST',
        5000,
        request.signal,
      )
      if (stopped || options.active?.() === false) return
      const address = new URL('/ws/sync', connection.address)
      address.protocol = address.protocol === 'https:' ? 'wss:' : 'ws:'
      address.searchParams.set('ticket', ticket.ticket)
      const current = new WebSocket(address.href)
      socket = current
      lastSeen = Date.now()
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
          if (frame.type === 'activity') {
            const old = activities.get(frame.scope) ?? []
            const byId = new Map(old.map((item) => [item.id, item]))
            for (const item of frame.events) byId.set(item.id, item)
            const next = frame.order.map((id) => {
              const item = byId.get(id)
              if (!item || item.scope !== frame.scope)
                throw new Error('Activity baseline is missing')
              return item
            })
            const events = retainActivityEvents(old, next)
            activities.set(frame.scope, events)
            for (const listener of value.scopes.get(frame.scope) ?? []) listener(events)
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
            value.cursor = { snapshot, epoch, sequence, time: Date.now() }
          online = true
          failures = 0
          publish()
        } catch {
          // Never guess through a gap. Reopen with an empty cursor to request a complete baseline.
          snapshot = undefined
          epoch = undefined
          sequence = undefined
          value.cursor = undefined
          activities.clear()
          online = false
          current.close(1000, 'Resync')
        }
      }
      current.onerror = () => current.close()
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
  const timer = setInterval(() => {
    if (options.active?.() === false) {
      request?.abort()
      online = false
      socket?.close()
      return
    }
    if (socket && Date.now() - lastSeen > 45000) {
      online = false
      socket.close()
      return
    }
    if (!socket && !retry) void connect()
  }, 1000)
  void connect()
  return {
    online: () => online,
    refresh: () => {
      if (socket?.readyState === 1) socket.send(JSON.stringify({ type: 'resume', epoch, sequence }))
      else if (!connecting) {
        clearTimeout(retry)
        retry = undefined
        void connect()
      }
    },
    stop: () => {
      stopped = true
      request?.abort()
      online = false
      clearInterval(timer)
      clearTimeout(retry)
      socket?.close()
      if (value.live === live) {
        value.live = undefined
        clearTimeout(value.expiry)
        value.expiry = setTimeout(
          () => {
            if (value.live) return
            value.cursor = undefined
            if (!value.scopes.size && registrations.get(key(connection)) === value)
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
      if (!value.scopes.size && !value.cursor) registrations.delete(key(connection))
      for (const [id, entry] of registrations) {
        if (
          !entry.live &&
          !entry.scopes.size &&
          (registrations.size > 8 ||
            !entry.cursor ||
            Date.now() - entry.cursor.time > 5 * 60 * 1000)
        )
          registrations.delete(id)
      }
    },
  }
}
