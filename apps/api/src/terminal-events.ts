import { startRuntimeSync, type RuntimeSnapshot, type RuntimeSyncStatus } from '@dovo/protocol'
import { once } from 'node:events'
import { isDeepStrictEqual } from 'node:util'
import type { LocalConnection } from './connection.js'

/** The terminal fields that events report. Other snapshot changes never produce an event. */
export type TerminalState = {
  id: string
  taskId: string
  title: string
  directory?: string
  /** Program activity reported by the terminal, such as idle, done, blocked or error. */
  activity?: string
  /** Optional opaque ID shared by reporters describing the same root turn. */
  turnId?: string
  turn?: number
  childActivities?: RuntimeSnapshot['terminals'][number]['childActivities']
  parentTerminalId?: string
  childNotices?: RuntimeSnapshot['terminals'][number]['childNotices']
  exited: boolean
  exitCode?: number
  /** Retained without a running process, waiting for an explicit restore. */
  dormant: boolean
}

export type TerminalEvent =
  /** The first event: every terminal the runtime has now. */
  | { type: 'snapshot'; terminals: TerminalState[] }
  | { type: 'created'; terminal: TerminalState }
  /** Title, directory, activity, exit or dormant state changed. An exit is a change. */
  | { type: 'changed'; terminal: TerminalState; previous: TerminalState }
  /** The runtime no longer has the terminal. A lost connection never reports this. */
  | { type: 'closed'; terminal: TerminalState }
  /**
   * The event stream lost or regained the runtime. Terminals keep their last state while
   * disconnected. After reconnecting, events report what changed during the outage.
   */
  | { type: 'connection'; state: 'disconnected' | 'connected' }

export type WatchTerminalEventsOptions = {
  /** Report only this terminal ID. */
  id?: string
  /** Abort to stop the stream. The iterator then finishes without an error. */
  signal?: AbortSignal
}

/** Write one JSON object per line. Pause consumption while a downstream pipe is full. */
export async function streamTerminalEvents(
  connection: LocalConnection,
  id: string | undefined,
  io: { stdout: NodeJS.WritableStream; signals: Pick<NodeJS.EventEmitter, 'on' | 'off'> },
) {
  const controller = new AbortController()
  const stop = () => controller.abort()
  let failure: Error | undefined
  const failed = (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EPIPE') failure = error
    stop()
  }
  io.signals.on('SIGINT', stop)
  io.signals.on('SIGTERM', stop)
  io.stdout.on('error', failed)
  io.stdout.on('close', stop)
  try {
    for await (const event of watchTerminalEvents(connection, { id, signal: controller.signal })) {
      if (!io.stdout.write(JSON.stringify(event) + '\n'))
        await once(io.stdout, 'drain', { signal: controller.signal })
    }
  } catch (error) {
    if (!controller.signal.aborted) throw error
  } finally {
    io.signals.off('SIGINT', stop)
    io.signals.off('SIGTERM', stop)
    io.stdout.off('error', failed)
    io.stdout.off('close', stop)
  }
  if (failure) throw failure
}

const stateOf = (terminal: RuntimeSnapshot['terminals'][number]): TerminalState => ({
  id: terminal.id,
  taskId: terminal.taskId,
  title: terminal.customTitle ?? terminal.title,
  ...(terminal.directory === undefined ? {} : { directory: terminal.directory }),
  ...(terminal.activity ? { activity: terminal.activity.state } : {}),
  ...(terminal.activity?.turnId === undefined ? {} : { turnId: terminal.activity.turnId }),
  ...(terminal.turn === undefined ? {} : { turn: terminal.turn }),
  ...(terminal.childActivities ? { childActivities: terminal.childActivities } : {}),
  ...(terminal.parentTerminalId ? { parentTerminalId: terminal.parentTerminalId } : {}),
  ...(terminal.childNotices ? { childNotices: terminal.childNotices } : {}),
  exited: terminal.exited,
  ...(terminal.exitCode === undefined ? {} : { exitCode: terminal.exitCode }),
  dormant: terminal.dormant === true,
})
const same = (a: TerminalState, b: TerminalState) =>
  a.taskId === b.taskId &&
  a.title === b.title &&
  a.directory === b.directory &&
  a.activity === b.activity &&
  a.turnId === b.turnId &&
  a.turn === b.turn &&
  isDeepStrictEqual(a.childActivities, b.childActivities) &&
  a.parentTerminalId === b.parentTerminalId &&
  isDeepStrictEqual(a.childNotices, b.childNotices) &&
  a.exited === b.exited &&
  a.exitCode === b.exitCode &&
  a.dormant === b.dormant

const fatal: Partial<Record<RuntimeSyncStatus, string>> = {
  unauthorized: 'The runtime rejected the owner credential in this data directory.',
  forbidden: 'The credential in this data directory cannot read runtime events.',
  unsupported: 'This runtime does not support live events. Update the runtime.',
}

/**
 * Stream terminal lifecycle events from the runtime's existing live sync connection. The runtime
 * pushes changes, so this never polls. It reconnects by itself after a lost connection.
 *
 * Events are computed when the consumer asks for the next one, from the last reported state and
 * the latest runtime state. A slow consumer therefore uses memory for one copy of the terminal
 * list, not a queue: changes in between merge into one event, and a terminal created and closed
 * in between is not reported.
 */
export async function* watchTerminalEvents(
  connection: LocalConnection,
  options: WatchTerminalEventsOptions = {},
): AsyncGenerator<TerminalEvent, void, undefined> {
  const { signal, id } = options
  if (signal?.aborted) return
  let latest: Map<string, TerminalState> | undefined
  let reported: Map<string, TerminalState> | undefined
  let online = false
  let reportedOnline = true
  let failure: Error | undefined
  let wake: (() => void) | undefined
  const notify = () => {
    const resolve = wake
    wake = undefined
    resolve?.()
  }
  const sync = startRuntimeSync(
    { address: connection.address, token: connection.token },
    {
      onSnapshot(snapshot) {
        const states = new Map<string, TerminalState>()
        for (const terminal of snapshot.terminals)
          if (id === undefined || terminal.id === id) states.set(terminal.id, stateOf(terminal))
        latest = states
        online = true
        notify()
      },
      onStatus(status) {
        const message = fatal[status]
        if (message) failure = new Error(message)
        // A resumed stream sends only later changes, so live means the last state is current.
        online = status === 'live'
        notify()
      },
    },
  )
  const next = (): TerminalEvent | undefined => {
    if (!latest) return undefined
    if (!reported) {
      reported = new Map(latest)
      return { type: 'snapshot', terminals: [...latest.values()] }
    }
    if (online !== reportedOnline) {
      reportedOnline = online
      return { type: 'connection', state: online ? 'connected' : 'disconnected' }
    }
    // Hold the last known state while disconnected. Only the runtime can say a terminal closed.
    if (!online) return undefined
    for (const [terminalId, terminal] of latest) {
      const previous = reported.get(terminalId)
      if (previous && same(previous, terminal)) continue
      reported.set(terminalId, terminal)
      return previous ? { type: 'changed', terminal, previous } : { type: 'created', terminal }
    }
    for (const [terminalId, terminal] of reported)
      if (!latest.has(terminalId)) {
        reported.delete(terminalId)
        return { type: 'closed', terminal }
      }
    return undefined
  }
  signal?.addEventListener('abort', notify, { once: true })
  try {
    for (;;) {
      if (signal?.aborted) return
      if (failure) throw failure
      const event = next()
      if (event) {
        yield event
        continue
      }
      await new Promise<void>((resolve) => {
        wake = resolve
      })
    }
  } finally {
    signal?.removeEventListener('abort', notify)
    sync.stop()
  }
}
