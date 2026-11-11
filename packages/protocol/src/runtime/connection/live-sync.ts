import { createRuntimeClient } from '../../shared/runtime-client.js'
import { desktopRuntimeSyncBridge } from './desktop-sync.js'
import { failRuntimeStreamingRoute, invalidateRuntimeRoute } from './routes.js'
import { decode } from '../../shared/schema.js'
import { setRuntimeSnapshotTag } from '../../shared/client.js'
import {
  applySnapshotDelta,
  applyActivityDelta,
  syncFrameSchema,
  syncTicketSchema,
} from './sync.js'
import type { RuntimeConnection, RuntimeSnapshot } from './runtime.js'
import type { activitySchema } from '../../automation/activity.js'
import { retainActivityEvents, createActivityCompactor } from '../../automation/activity.js'
import { Effect, Fiber, type Schema } from 'effect'

type Events = Schema.Schema.Type<typeof activitySchema>['events']
type Listener = (events: Events) => void
type Registration = {
  tasks: Map<string, number>
  settled: Set<{ limit: number | undefined }>
  events: Map<string, Events>
  compactors: Map<string, ReturnType<typeof createActivityCompactor>>
  expiry?: ReturnType<typeof setTimeout>
  cursor?: {
    snapshot: RuntimeSnapshot
    epoch: string
    sequence: number
    time: number
    tasks: string
  }

  live?: {
    online: () => boolean
    watch: () => void
    retry: () => void
    status: () => RuntimeSyncStatus
  }
  details: Set<Listener>
  scopes: Map<string, Set<Listener>>
}
const registrations = new Map<string, Registration>()
const preparing = new Map<string, { taskId: string; release: () => void }>()
const key = (connection: RuntimeConnection) =>
  JSON.stringify([connection.address, connection.token])
const registration = (connection: RuntimeConnection) => {
  const id = key(connection)
  let value = registrations.get(id)
  if (!value) {
    value = {
      tasks: new Map(),
      settled: new Set(),
      scopes: new Map(),
      events: new Map(),
      compactors: new Map(),
      details: new Set(),
    }
    registrations.set(id, value)
  }
  return value
}
function settledLimit(value: Registration) {
  if (!value.settled.size || [...value.settled].some((entry) => entry.limit === undefined))
    return undefined
  return Math.max(...[...value.settled].map((entry) => entry.limit ?? 0))
}
/** Matches the handshake deadline. A replacement that has not delivered its baseline by
 * then is treated as an outage, so HTTP fallback resumes. */
const replacementGrace = 10000
const selectionIdentity = (tasks: Iterable<string>, limit: number | undefined) =>
  JSON.stringify([[...tasks].sort(), limit ?? null])
/** Task lists opt in; a simultaneous full-list consumer always wins. */
export function watchRuntimeSettled(connection: RuntimeConnection, limit?: number) {
  const value = registration(connection)
  const entry = { limit }
  value.settled.add(entry)
  value.live?.watch()
  return () => {
    if (!value.settled.delete(entry)) return
    value.live?.watch()
    if (
      !value.live &&
      !value.scopes.size &&
      !value.tasks.size &&
      !value.settled.size &&
      !value.cursor
    )
      registrations.delete(key(connection))
  }
}
/** Reference counted so split panes can share one subscription without dropping each other. */
export function watchRuntimeTask(connection: RuntimeConnection, taskId: string) {
  const value = registration(connection)
  if (!value.tasks.has(taskId) && value.tasks.size >= 8)
    throw new Error('Open at most eight threads per computer.')
  value.tasks.set(taskId, (value.tasks.get(taskId) ?? 0) + 1)
  const prepared = preparing.get(key(connection))
  if (prepared?.taskId === taskId) prepared.release()
  value.live?.watch()
  let watching = true
  return () => {
    if (!watching) return
    watching = false
    const count = value.tasks.get(taskId) ?? 0
    if (count > 1) value.tasks.set(taskId, count - 1)
    else value.tasks.delete(taskId)
    value.live?.watch()
    if (
      !value.live &&
      !value.scopes.size &&
      !value.tasks.size &&
      !value.settled.size &&
      !value.cursor
    )
      registrations.delete(key(connection))
  }
}
/** Begin the selected thread's network load before navigation mounts its subscriber.
 * One temporary lease per connection; a screen subscription takes it over without a gap. */
export function prepareRuntimeTask(connection: RuntimeConnection, taskId: string): boolean {
  const id = key(connection)
  if (preparing.get(id)?.taskId === taskId) return true
  preparing.get(id)?.release()
  const active = registrations.get(id)
  if (active?.tasks.has(taskId)) return true
  if ((active?.tasks.size ?? 0) >= 8) return false
  const stop = watchRuntimeTask(connection, taskId)
  const timer = setTimeout(() => lease.release(), 3000)
  const lease = {
    taskId,
    release() {
      if (preparing.get(id) !== lease) return
      preparing.delete(id)
      clearTimeout(timer)
      stop()
    },
  }
  preparing.set(id, lease)
  return true
}
export function runtimeSnapshotPath(connection: RuntimeConnection | null) {
  const query = new URLSearchParams({ scope: 'threads', history: 'paged' })
  if (connection) {
    const value = registrations.get(key(connection))
    for (const id of value?.tasks.keys() ?? []) query.append('task', id)
    const limit = value && settledLimit(value)
    if (limit !== undefined) query.set('settled', String(limit))
  }
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
  let compact = value.compactors.get(scope)
  if (!compact) {
    compact = createActivityCompactor()
    value.compactors.set(scope, compact)
  }
  if (cached) listener(includeDetails ? cached : compact(cached))
  listeners.add(listener)
  value.scopes.set(scope, listeners)
  value.live?.watch()
  let watching = true
  return () => {
    if (!watching) return
    watching = false
    listeners.delete(listener)
    value.details.delete(listener)
    if (!listeners.size) {
      value.scopes.delete(scope)
      // Effects can replace their listener in the same turn without changing the
      // wire subscription. Keep its baseline until that handoff has settled.
      queueMicrotask(() => {
        if (value.scopes.has(scope)) return
        value.events.delete(scope)
        value.compactors.delete(scope)
      })
    }
    value.live?.watch()
    if (
      !value.live &&
      !value.scopes.size &&
      !value.tasks.size &&
      !value.settled.size &&
      !value.cursor
    )
      registrations.delete(key(connection))
  }
}
export type RuntimeSyncStatus =
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'unauthorized'
  | 'forbidden'
  | 'unsupported'
export function runtimeSyncStatus(connection: RuntimeConnection) {
  return registrations.get(key(connection))?.live?.status()
}
/** Explicit user recovery also retries endpoints rejected by an earlier runtime/session. */
export function retryRuntimeSync(connection: RuntimeConnection) {
  registrations.get(key(connection))?.live?.retry()
}
/** One stream owned by the selected runtime; existing HTTP mutation/outbox semantics stay intact. */
export function startRuntimeSync(
  connection: RuntimeConnection,
  options: {
    onSnapshot: (snapshot: RuntimeSnapshot) => void
    active?: () => boolean
    onWake?: () => void
    onStatus?: (status: RuntimeSyncStatus) => void
    onError?: (message: string) => void
    onConnection?: (connection: RuntimeConnection) => void
  },
) {
  const value = registration(connection)
  const bridge = desktopRuntimeSyncBridge()
  if (bridge) {
    const id = crypto.randomUUID()
    let stopped = false,
      online = false
    let status: RuntimeSyncStatus = 'connecting'
    const input = () => ({
      id,
      connection,
      tasks: [...value.tasks.keys()],
      settledLimit: settledLimit(value),
      scopes: [...value.scopes.keys()],
      detailScopes: [...value.scopes.entries()]
        .filter(([, listeners]) => [...listeners].some((listener) => value.details.has(listener)))
        .map(([scope]) => scope),
    })
    const initialInput = input()
    let lastInput = JSON.stringify(initialInput)
    let watchQueued = false
    let bridgeSnapshot: RuntimeSnapshot | undefined
    let bridgeEpoch: string | undefined
    let bridgeSequence: number | undefined
    const sendWatch = () => {
      if (stopped) return
      const next = input()
      const identity = JSON.stringify(next)
      if (identity === lastInput) return
      lastInput = identity
      bridge.update(next)
    }
    const refresh = (retry: boolean) => {
      if (stopped) return
      sendWatch()
      bridge.refresh(
        id,
        retry,
        bridgeEpoch !== undefined && bridgeSequence !== undefined
          ? { epoch: bridgeEpoch, sequence: bridgeSequence }
          : undefined,
      )
    }
    const live = {
      online: () => online,
      status: () => status,
      watch: () => {
        if (stopped || watchQueued) return
        watchQueued = true
        queueMicrotask(() => {
          watchQueued = false
          sendWatch()
        })
      },
      retry: () => refresh(true),
    }
    value.live = live
    const unsubscribe = bridge.subscribe(initialInput, (event) => {
      if (stopped) return
      if (event.type === 'status') {
        online = event.online
        status = event.status
        options.onStatus?.(status)
      } else if (event.type === 'error') {
        online = false
        options.onError?.(event.message)
      } else if (event.type === 'snapshot') {
        bridgeSnapshot = event.snapshot
        bridgeEpoch = event.epoch
        bridgeSequence = event.sequence
        if (event.tag) setRuntimeSnapshotTag(event.snapshot, event.tag)
        options.onSnapshot(event.snapshot)
      } else if (event.type === 'delta') {
        try {
          if (
            !bridgeSnapshot ||
            bridgeEpoch !== event.epoch ||
            bridgeSequence !== event.base ||
            event.sequence !== event.base + 1
          )
            throw new Error('Desktop sync cursor does not match')
          bridgeSnapshot = applySnapshotDelta(bridgeSnapshot, event.delta)
          bridgeSequence = event.sequence
          if (event.tag) setRuntimeSnapshotTag(bridgeSnapshot, event.tag)
          options.onSnapshot(bridgeSnapshot)
        } catch {
          bridgeSnapshot = undefined
          bridgeEpoch = undefined
          bridgeSequence = undefined
          bridge.refresh(id, false)
        }
      } else if (event.type === 'connection') {
        options.onConnection?.(event.connection)
      } else {
        const old = value.events.get(event.scope) ?? []
        const events = retainActivityEvents(old, event.events)
        value.events.set(event.scope, events)
        const compact = value.compactors.get(event.scope)
        let compacted: Events | undefined
        for (const listener of value.scopes.get(event.scope) ?? [])
          listener(
            value.details.has(listener)
              ? events
              : (compacted ??= compact ? compact(events) : events),
          )
      }
    })
    return {
      shared: true,
      online: live.online,
      retry: live.retry,
      refresh: () => refresh(false),
      stop: () => {
        if (stopped) return
        stopped = true
        online = false
        unsubscribe()
        if (value.live === live) value.live = undefined
        value.events.clear()
        for (const compact of value.compactors.values()) compact([])
        if (!value.tasks.size && !value.scopes.size && !value.settled.size)
          registrations.delete(key(connection))
      },
    }
  }
  clearTimeout(value.expiry)
  let socket: WebSocket | undefined
  let socketRoute: string | undefined
  let socketEstablished = false
  let stopped = false
  let online = false
  let unsupported = false
  let status: RuntimeSyncStatus = 'connecting'
  let healthySince: number | undefined
  let replacingSince: number | undefined
  const replacing = () =>
    replacingSince !== undefined && Date.now() - replacingSince < replacementGrace
  const setStatus = (next: RuntimeSyncStatus) => {
    if (status === next) return
    status = next
    options.onStatus?.(next)
  }
  let listLimit = settledLimit(value)
  let taskIdentity = selectionIdentity(value.tasks.keys(), listLimit)
  const cached =
    value.cursor &&
    value.cursor.tasks === taskIdentity &&
    Date.now() - value.cursor.time < 5 * 60 * 1000
      ? value.cursor
      : undefined
  let epoch: string | undefined = cached?.epoch
  let sequence: number | undefined = cached?.sequence
  let snapshot: RuntimeSnapshot | undefined = cached?.snapshot
  let snapshotTasks = taskIdentity
  let taskUpdates = false
  let incremental = false
  let selectionThrough: number | undefined
  // Keep at most eight departed selections and 4 MiB of estimated retained data.
  // This cache is private to the authenticated connection and dies with its stream owner.
  const selections = new Map<
    string,
    { cursor: NonNullable<Registration['cursor']>; bytes: number }
  >()
  let selectionBytes = 0
  let watchId = 0
  const pendingSelections = new Map<string, number>()
  const selectionSizes = new WeakMap<object, number>()
  // Navigation must not serialize whole histories just to decide whether to keep them.
  // Count strings by length, reuse immutable subtrees and stop above the admission limit.
  const retainedBytes = (value: unknown): number => {
    if (typeof value === 'string') return value.length * 2 + 16
    if (!value || typeof value !== 'object') return 8
    const known = selectionSizes.get(value)
    if (known !== undefined) return known
    let bytes = 64
    if (Array.isArray(value)) {
      for (const item of value) {
        bytes += 8 + retainedBytes(item)
        if (bytes > 4 * 1024 * 1024) break
      }
    } else {
      for (const [key, item] of Object.entries(value)) {
        bytes += key.length * 2 + 16 + retainedBytes(item)
        if (bytes > 4 * 1024 * 1024) break
      }
    }
    selectionSizes.set(value, bytes)
    return bytes
  }
  const cursorKey = (epoch: string, sequence: number) => JSON.stringify([epoch, sequence])
  const trimSelections = () => {
    for (const [id, entry] of selections) {
      if (pendingSelections.has(id)) continue
      if (
        selections.size <= 8 &&
        selectionBytes <= 4 * 1024 * 1024 &&
        Date.now() - entry.cursor.time < 5 * 60 * 1000
      )
        continue
      selections.delete(id)
      selectionBytes -= entry.bytes
    }
  }
  const rememberSelection = () => {
    if (!snapshot || epoch === undefined || sequence === undefined || !incremental) return
    const id = cursorKey(epoch, sequence)
    if (selections.has(id)) return
    const bytes = retainedBytes(snapshot)
    if (bytes > 4 * 1024 * 1024) return
    for (const [key, entry] of selections)
      if (entry.cursor.tasks === snapshotTasks && !pendingSelections.has(key)) {
        selections.delete(key)
        selectionBytes -= entry.bytes
      }
    selections.set(id, {
      cursor: { snapshot, epoch, sequence, tasks: snapshotTasks, time: Date.now() },
      bytes,
    })
    selectionBytes += bytes
    trimSelections()
  }
  let lastSeen = 0
  let socketStarted = 0
  let resumeStarted: number | undefined
  let resumeResent = false
  // Measured round trip of the last acknowledged resume; the deadline scales with it so a slow
  // cellular or VPN link is not replaced for being slow, while a dead socket still is.
  let resumeRoundTrip = 2000
  const resumeDeadline = () => Math.min(20000, Math.max(5000, resumeRoundTrip * 2.5))
  let failures = 0
  let publishedAt = 0
  let retry: Fiber.Fiber<void, never> | undefined
  let connecting = false
  let request: AbortController | undefined
  let lastWatch: string | undefined
  const activities = value.events
  const sendWatch = () => {
    if (stopped) return
    const nextLimit = settledLimit(value)
    const listChanged = listLimit !== nextLimit
    listLimit = nextLimit
    const next = selectionIdentity(value.tasks.keys(), listLimit)
    if (next !== taskIdentity) {
      rememberSelection()
      taskIdentity = next
      value.cursor = undefined
      if (listChanged || !taskUpdates || socket?.readyState !== 1) {
        // A healthy stream is replaced on purpose and will deliver the new baseline. Keep
        // reporting it online so HTTP fallback does not download the same baseline in
        // parallel. Failure, inactivity or the handshake deadline end this grace period.
        const wasOnline = online
        snapshot = undefined
        epoch = undefined
        sequence = undefined
        request?.abort()
        closeSocket()
        replacingSince = wasOnline ? Date.now() : undefined
        if (!wasOnline) options.onWake?.()
        if (!connecting) void connect()
        return
      }
    }
    if (socket?.readyState !== 1) return
    trimSelections()
    const retained = incremental
      ? [...selections.values()].reverse().find(({ cursor }) => cursor.tasks === taskIdentity)
          ?.cursor
      : undefined
    const input = {
      type: 'watch',
      ...(taskUpdates ? { tasks: [...value.tasks.keys()], selectionDelta: true } : {}),
      ...(retained ? { resume: { epoch: retained.epoch, sequence: retained.sequence } } : {}),
      scopes: [...value.scopes.keys()].slice(0, 8),
      detailScopes: [...value.scopes.entries()]
        .filter(([, listeners]) => [...listeners].some((listener) => value.details.has(listener)))
        .map(([scope]) => scope)
        .slice(0, 8),
    }
    const wire = JSON.stringify(input)
    if (wire === lastWatch) return
    try {
      if (incremental && retained)
        pendingSelections.set(cursorKey(retained.epoch, retained.sequence), watchId + 1)
      socket.send(incremental ? JSON.stringify({ ...input, watchId: ++watchId }) : wire)
      lastWatch = wire
    } catch {
      failHandshake()
      closeSocket()
      reconnect()
    }
  }
  let watchQueued = false
  const watch = () => {
    if (watchQueued || stopped) return
    watchQueued = true
    queueMicrotask(() => {
      watchQueued = false
      sendWatch()
    })
  }
  const recover = () => {
    if (stopped) return
    invalidateRuntimeRoute(connection)
    invalidateRuntimeRoute(connection, 'stream')
    unsupported = false
    failures = 0
    replacingSince = undefined
    request?.abort()
    closeSocket()
    if (retry) Effect.runFork(Fiber.interrupt(retry))
    retry = undefined
    setStatus('connecting')
    if (!connecting) void connect()
    else retryRequested = true
  }
  let retryRequested = false
  const reportedOnline = () => online || replacing()
  const live = { online: reportedOnline, watch, retry: recover, status: () => status }
  value.live = live
  const publish = () => {
    if (snapshot) options.onSnapshot(snapshot)
  }
  // A suspended native socket may never emit close. Detach it first so late
  // callbacks cannot update the cursor or prevent a replacement connection.
  const closeSocket = () => {
    pendingSelections.clear()
    const previous = socket
    socket = undefined
    lastWatch = undefined
    socketRoute = undefined
    socketEstablished = false
    online = false
    if (healthySince !== undefined && Date.now() - healthySince >= 30000) failures = 0
    healthySince = undefined
    resumeStarted = undefined
    previous?.close()
  }
  const sendResume = () => {
    if (!socket || socket.readyState !== 1) return
    try {
      socket.send(JSON.stringify({ type: 'resume', epoch, sequence }))
    } catch {
      failHandshake()
      closeSocket()
      reconnect()
    }
  }
  const failHandshake = () => {
    if (socketRoute && !socketEstablished) failRuntimeStreamingRoute(connection, socketRoute)
  }
  const reconnect = () => {
    if (healthySince !== undefined && Date.now() - healthySince >= 30000) failures = 0
    healthySince = undefined
    online = false
    replacingSince = undefined
    if (stopped || options.active?.() === false) return
    options.onWake?.()
    if (unsupported || retry || options.active?.() === false) return
    setStatus('reconnecting')
    const delay = Math.min(30000, 500 * 2 ** Math.min(failures++, 6))
    retry = Effect.runFork(
      Effect.sleep(Math.round(delay * (0.8 + Math.random() * 0.4))).pipe(
        Effect.andThen(
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
    const requestedTasks = taskIdentity
    try {
      // Older runtimes ignore incremental and retain their scoped format-4/5 path.
      const query = new URLSearchParams({
        format: '4',
        history: 'paged',
        subscriptions: 'live',
        incremental: '1',
      })
      for (const id of value.tasks.keys()) query.append('task', id)
      if (listLimit !== undefined) query.set('settled', String(listLimit))
      const ticket = await createRuntimeClient(connection).request(
        `/api/sync/ticket?${query}`,
        {},
        syncTicketSchema,
        { method: 'POST', timeoutMs: 5000, signal: request.signal, route: 'stream' },
      )
      if (
        stopped ||
        retryRequested ||
        requestedTasks !== taskIdentity ||
        options.active?.() === false
      )
        return
      taskUpdates = ticket.format === 5 || ticket.format === 6
      incremental = ticket.format === 6
      const address = createRuntimeClient(connection).socketUrl('/ws/sync', ticket, {
        route: 'stream',
      })
      const selectedRoute = new URL(address)
      selectedRoute.protocol = selectedRoute.protocol === 'wss:' ? 'https:' : 'http:'
      let current: WebSocket
      try {
        current = new WebSocket(address)
      } catch (error) {
        failRuntimeStreamingRoute(connection, selectedRoute.origin)
        throw error
      }
      socket = current
      socketRoute = selectedRoute.origin
      socketEstablished = false
      resumeStarted = undefined
      socketStarted = lastSeen = Date.now()
      current.onopen = () => {
        if (stopped || current !== socket) {
          current.close()
          return
        }
        sendResume()
        if (current === socket) sendWatch()
      }
      current.onmessage = (event) => {
        if (stopped || current !== socket) return
        try {
          if (typeof event.data !== 'string') throw new Error('Invalid sync frame')
          const frame = decode(syncFrameSchema, JSON.parse(event.data))
          lastSeen = Date.now()
          if (frame.type === 'watch-ack') {
            for (const [key, through] of pendingSelections)
              if (through <= frame.watchId) pendingSelections.delete(key)
            trimSelections()
            return
          }
          if (frame.type === 'activity' || frame.type === 'activity-delta') {
            if (!value.scopes.has(frame.scope)) return
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
            const compact = value.compactors.get(frame.scope)
            let compacted: Events | undefined
            for (const listener of value.scopes.get(frame.scope) ?? [])
              listener(
                value.details.has(listener)
                  ? events
                  : (compacted ??= compact ? compact(events) : events),
              )
            return
          }
          if (frame.type === 'selection-resume') {
            // Accept only a baseline this connection actually retained. A missing/expired
            // cache falls through the normal full-baseline recovery path.
            const retained = selections.get(cursorKey(frame.epoch, frame.sequence))?.cursor
            if (!retained || frame.through < frame.sequence)
              throw new Error('Sync selection baseline is missing')
            snapshot = retained.snapshot
            snapshotTasks = retained.tasks
            epoch = retained.epoch
            sequence = retained.sequence
            selectionThrough = frame.through
          } else if (frame.type === 'snapshot') {
            selectionThrough = undefined
            snapshot = frame.snapshot
            snapshotTasks = taskUpdates
              ? selectionIdentity(
                  snapshot.detailTaskIds ?? [],
                  snapshot.olderSettled?.limit ?? listLimit,
                )
              : taskIdentity
            epoch = frame.epoch
            sequence = frame.sequence
            setRuntimeSnapshotTag(snapshot, frame.tag)
          } else if (frame.type === 'delta' || frame.type === 'selection') {
            if (
              !snapshot ||
              epoch !== (frame.type === 'selection' ? frame.previousEpoch : frame.epoch) ||
              sequence !== frame.base ||
              (frame.type === 'delta' && frame.sequence !== frame.base + 1)
            )
              throw new Error('Sync cursor does not match')
            snapshot = applySnapshotDelta(snapshot, frame.delta)
            epoch = frame.epoch
            sequence = frame.sequence
            if (frame.type === 'selection') selectionThrough = undefined
            if (frame.type === 'selection')
              snapshotTasks = selectionIdentity(
                snapshot.detailTaskIds ?? [],
                snapshot.olderSettled?.limit ?? listLimit,
              )
            setRuntimeSnapshotTag(snapshot, frame.tag)
          } else if (!snapshot || epoch !== frame.epoch || sequence !== frame.sequence)
            throw new Error('Sync needs a fresh baseline')
          if (
            snapshot &&
            snapshotTasks === taskIdentity &&
            epoch !== undefined &&
            sequence !== undefined
          )
            value.cursor = { snapshot, epoch, sequence, time: Date.now(), tasks: taskIdentity }
          const becameOnline = !online
          if (resumeStarted !== undefined) resumeRoundTrip = Math.max(1, Date.now() - resumeStarted)
          resumeStarted = undefined
          online = true
          replacingSince = undefined
          socketEstablished = true
          healthySince ??= Date.now()
          if (Date.now() - healthySince >= 30000) failures = 0
          setStatus('live')
          if (
            selectionThrough !== undefined &&
            sequence !== undefined &&
            sequence >= selectionThrough
          )
            selectionThrough = undefined
          if (
            selectionThrough === undefined &&
            snapshotTasks === taskIdentity &&
            (becameOnline || frame.type !== 'heartbeat' || Date.now() - publishedAt >= 30000)
          ) {
            publishedAt = Date.now()
            publish()
          }
        } catch {
          // Never guess through a gap. Reopen with an empty cursor to request a complete baseline.
          snapshot = undefined
          epoch = undefined
          sequence = undefined
          value.cursor = undefined
          selections.clear()
          pendingSelections.clear()
          selectionBytes = 0
          activities.clear()
          for (const compact of value.compactors.values()) compact([])
          online = false
          closeSocket()
          reconnect()
        }
      }
      current.onerror = () => {
        if (current !== socket || stopped) return
        failHandshake()
        closeSocket()
        reconnect()
      }
      current.onclose = () => {
        if (current === socket) {
          failHandshake()
          closeSocket()
          reconnect()
        }
      }
    } catch (error) {
      if (retryRequested || stopped || request?.signal.aborted) return
      if (
        error &&
        typeof error === 'object' &&
        'status' in error &&
        [401, 404].includes(Number(error.status))
      ) {
        unsupported = true
        setStatus(Number(error.status) === 401 ? 'unauthorized' : 'unsupported')
      }
      reconnect()
    } finally {
      connecting = false
      if (retryRequested) {
        retryRequested = false
        if (!stopped) void connect()
      }
      if (!stopped && requestedTasks !== taskIdentity && !socket) void connect()
    }
  }
  const timer = Effect.runFork(
    Effect.forever(
      Effect.sleep(1000).pipe(
        Effect.andThen(
          Effect.sync(() => {
            if (options.active?.() === false) {
              request?.abort()
              closeSocket()
              replacingSince = undefined
              return
            }
            const resumeWaited = resumeStarted === undefined ? 0 : Date.now() - resumeStarted
            if (
              socket &&
              ((!online && Date.now() - socketStarted >= 10000) ||
                (resumeStarted !== undefined && resumeWaited >= resumeDeadline()) ||
                Date.now() - lastSeen >= 30000)
            ) {
              failHandshake()
              closeSocket()
              reconnect()
              return
            }
            // One lost frame must not cost a reconnect: ask once more at half the deadline.
            if (
              socket?.readyState === 1 &&
              resumeStarted !== undefined &&
              !resumeResent &&
              resumeWaited >= resumeDeadline() / 2
            ) {
              resumeResent = true
              sendResume()
            }
            if (!socket && !retry) void connect()
          }),
        ),
      ),
    ),
  )
  void connect()
  return {
    shared: false,
    online: reportedOnline,
    retry: recover,
    refresh: () => {
      if (socket && Date.now() - lastSeen >= 15000) closeSocket()
      if (socket?.readyState === 1) {
        // A native socket can remain OPEN after VPN changes or suspend. Require
        // the server's resume acknowledgement instead of waiting for a heartbeat timeout.
        if (resumeStarted !== undefined) return
        resumeResent = false
        resumeStarted = Date.now()
        sendResume()
      } else if (!connecting) {
        if (retry) Effect.runFork(Fiber.interrupt(retry))
        retry = undefined
        void connect()
      }
    },
    stop: () => {
      stopped = true
      selections.clear()
      pendingSelections.clear()
      selectionBytes = 0
      request?.abort()
      online = false
      replacingSince = undefined
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
              !value.settled.size &&
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
      if (!value.scopes.size && !value.tasks.size && !value.settled.size && !value.cursor)
        registrations.delete(key(connection))
      for (const [id, entry] of registrations) {
        if (
          !entry.live &&
          !entry.scopes.size &&
          !entry.tasks.size &&
          !entry.settled.size &&
          (registrations.size > 8 ||
            !entry.cursor ||
            Date.now() - entry.cursor.time > 5 * 60 * 1000)
        )
          registrations.delete(id)
      }
    },
  }
}
