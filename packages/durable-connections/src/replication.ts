import { startReconnecting } from './reconnecting.js'
import type { DurableState, StateRequest } from './state.js'
import { StateProtocolError, StateRollbackError } from './state.js'

export interface ReplicationOptions<T> {
  state: DurableState<T>
  /** Known source identity lets a new connection resume its durable receive checkpoint. */
  peerId?: string
  exchange(request: StateRequest<T>, signal: AbortSignal): Promise<unknown>
  /** Import domain edits before sending, and publish accepted state after receiving. */
  beforeExchange?: () => void | Promise<void>
  afterExchange?: (progress: { caughtUp: boolean }) => void | Promise<void>
  onError(error: Error): void
  /** null keeps a caught-up connection idle until a local change or explicit wake. */
  intervalMs?: number | null
}

function wait(
  milliseconds: number | null,
  signal: AbortSignal,
  register: (wake: (() => void) | undefined) => void,
) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve()
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      register(undefined)
      resolve()
    }
    const timer = milliseconds === null ? undefined : setTimeout(done, milliseconds)
    signal.addEventListener('abort', done, { once: true })
    register(done)
  })
}

interface Conflict {
  actor: string
  repairs: number
  after: number
}
// Recovery budgets belong to the open state, not to one replication handle: an application
// can stop a handle and start a new one for the same peer each time a connection drops.
// They are not durable. A new process permits one new attempt.
const budgets = new WeakMap<object, { forked: boolean; conflicts: Map<string, Conflict> }>()
function budgetOf(state: object) {
  let budget = budgets.get(state)
  if (!budget) budgets.set(state, (budget = { forked: false, conflicts: new Map() }))
  return budget
}

/** Sends batches until both sides are caught up, then waits. Lost responses replay safely.
 * A transport must honor AbortSignal and settle its request when cancelled. */
export function startReplication<T>(options: ReplicationOptions<T>) {
  const { state } = options
  const interval = options.intervalMs === undefined ? 3000 : options.intervalMs
  if (interval !== null && (!Number.isSafeInteger(interval) || interval < 1))
    throw new Error('Invalid replication interval')
  let waiting: (() => void) | undefined
  let pending = false
  const wake = () => {
    pending = true
    waiting?.()
  }
  const unsubscribe = state.subscribe(wake)
  let peer: string | undefined = options.peerId
  const budget = budgetOf(state)
  // The push page which still conflicted after one full recovery download. Later connections
  // and later handles for the same peerId do not repeat that download until a repair, a
  // successful push of that page or an explicit restart. A handle without a peerId has no
  // stable peer identity and keeps its own record.
  const conflicts = options.peerId === undefined ? new Map<string, Conflict>() : budget.conflicts
  const conflictKey = options.peerId ?? ''
  const connection = startReconnecting(
    async (signal, connected) => {
      let actor = state.replicaId
      let repairs = state.repairRevision
      let sentThrough = 0
      // Repair generation of a push replay from sequence zero. The replay uses its own
      // page cursor: the peer acknowledges its old checkpoint for a repaired journal.
      let replay: number | undefined
      let pushedRepairs = 0
      // Explicit pull cursor. repairs is set while the pull is unbroken from sequence zero.
      let pull: { source: string | undefined; after: number; repairs?: number } | undefined
      let pulledRepairs = 0
      // Conflict recovery pulls without a push batch. held is a known conflict to report
      // again when the pull did not repair anything.
      let hold = false
      let held: Error | undefined
      let recovered = false
      // Each connection sends the last acknowledged sequence once more. See the push cursor.
      let verified = false
      const reset = () => {
        actor = state.replicaId
        repairs = state.repairRevision
        sentThrough = 0
        replay = undefined
        pushedRepairs = 0
        pull = undefined
        pulledRepairs = 0
        hold = false
        held = undefined
        recovered = false
        verified = false
      }
      // One automatic actor fork for each open state bounds identity churn. A fork which
      // another storage owner made is adopted without a new identity.
      const fork = async (diverged: string) => {
        if (budget.forked) {
          await state.refresh()
          return state.replicaId !== diverged
        }
        if (!(await state.forkReplica(diverged))) return false
        budget.forked = true
        return true
      }
      while (!signal.aborted) {
        pending = false
        await state.refresh()
        await options.beforeExchange?.()
        if (signal.aborted) return
        if (actor !== state.replicaId) reset()
        if (repairs !== state.repairRevision) {
          repairs = state.repairRevision
          sentThrough = 0
          replay = repairs
          pushedRepairs = repairs
        }
        const outgoing = state.request(peer, sentThrough, replay)
        const withheld = hold
        const request: StateRequest<T> = {
          // An older receiver can reject our damaged copy before returning its complete one.
          // Pull its retained versions without writing a batch, then retry the push once.
          batch: withheld
            ? {
                protocol: 1,
                channel: state.channel,
                source: outgoing.batch.source,
                after: 0,
                through: 0,
                changes: [],
                more: false,
              }
            : outgoing.batch,
          // Replay retained history even when our durable receipt is already ahead of a
          // version which the remote repaired since that receipt.
          pull: pull ? { source: pull.source, after: pull.after } : outgoing.pull,
        }
        const { batch } = request
        // Another session or window can replace the actor identity during an exchange.
        const stale = () => batch.source !== state.replicaId
        let response: unknown
        try {
          response = await options.exchange(request, signal)
        } catch (error) {
          if (signal.aborted || !(error instanceof Error)) throw error
          if (stale()) {
            reset()
            continue
          }
          // The peer holds other versions at sequences which this actor sent before.
          if (
            error.message.includes('A replayed state sequence changed') &&
            (await fork(batch.source))
          ) {
            reset()
            continue
          }
          if (
            !withheld &&
            !recovered &&
            state.supportsVersionRecovery &&
            error.message.includes('A state version was reused with different data')
          ) {
            const last = conflicts.get(conflictKey)
            const known =
              last?.actor === batch.source && last.repairs === repairs && last.after === batch.after
            conflicts.set(conflictKey, { actor: batch.source, repairs, after: batch.after })
            recovered = true
            hold = true
            // A known conflict keeps incoming state current from the durable checkpoint.
            held = known ? error : undefined
            pull = { source: outgoing.pull.source, after: known ? outgoing.pull.after : 0 }
            continue
          }
          throw error
        }
        // Late results from an old connection must never enter a replacement session.
        if (signal.aborted) return
        if (stale()) {
          reset()
          continue
        }
        let accepted: Awaited<ReturnType<typeof state.accept>>
        try {
          accepted = await state.accept(
            response,
            options.peerId,
            pull?.repairs === undefined ? undefined : { after: pull.after, repairs: pull.repairs },
          )
        } catch (error) {
          if (stale() || (error instanceof StateRollbackError && (await fork(batch.source)))) {
            reset()
            continue
          }
          throw error
        }
        if (accepted.sentThrough < batch.through)
          throw new StateProtocolError('Peer did not acknowledge the submitted state batch')
        peer = accepted.peer
        const resolved = conflicts.get(conflictKey)
        // The peer accepted the page which conflicted before.
        if (!withheld && resolved?.actor === batch.source && resolved.after === batch.after)
          conflicts.delete(conflictKey)
        let probe = false
        if (withheld) {
          // The withheld push keeps its cursor.
        } else if (replay !== undefined) {
          verified = true
          sentThrough = batch.through
          if (!batch.more) replay = undefined
        } else if (
          batch.repairs !== undefined &&
          batch.replayed === undefined &&
          (accepted.sentRepairs ?? 0) < batch.repairs &&
          pushedRepairs < batch.repairs
        ) {
          // The peer missed a repair, for example while disconnected. Replay the journal
          // once; a first page which started at zero is already part of that replay.
          verified = true
          pushedRepairs = batch.repairs
          replay = batch.repairs
          sentThrough = batch.after === 0 ? batch.through : 0
        } else {
          // A journal which returned to an earlier point and then grew past the peer's
          // receipt holds other versions at acknowledged sequences. The first page finds
          // that only in its own range. Send the last acknowledged sequence once more: the
          // peer rejects another version there, and no divergence stays silent.
          probe = !verified && accepted.sentThrough > batch.through
          verified = true
          sentThrough = accepted.sentThrough - (probe ? 1 : 0)
        }
        const run =
          accepted.receivedAfter === 0
            ? accepted.receivedRepairs
            : pull?.after === accepted.receivedAfter
              ? pull.repairs
              : undefined
        if (!accepted.receivedMore) pull = undefined
        else if (
          pull ||
          run !== undefined ||
          // A repaired peer can replay history behind our durable checkpoint. Drain that
          // replay with its page cursor, rather than skipping back to the old receipt.
          accepted.receivedThrough < state.checkpoint(accepted.peer)
        )
          pull = { source: accepted.peer, after: accepted.receivedThrough, repairs: run }
        if (
          accepted.repairsPending &&
          accepted.receivedRepairs !== undefined &&
          pull?.repairs === undefined &&
          pulledRepairs < accepted.receivedRepairs
        ) {
          // The peer repaired history behind our checkpoint. Pull its journal from zero once.
          pulledRepairs = accepted.receivedRepairs
          pull = { source: accepted.peer, after: 0 }
        }
        let failure: Error | undefined
        if (hold && !pull) {
          hold = false
          if (held && conflicts.get(conflictKey)?.repairs === state.repairRevision) failure = held
          held = undefined
        }
        const busy = hold || pull !== undefined || replay !== undefined || probe
        await options.afterExchange?.({ caughtUp: !busy && !failure && !accepted.more })
        if (signal.aborted) return
        if (failure) throw failure
        if (!withheld) {
          recovered = false
          connected()
        }
        if (withheld || busy) continue
        if (!accepted.more && !pending)
          await wait(interval, signal, (callback) => {
            waiting = callback
          })
      }
    },
    (error) => options.onError(error),
  )
  return {
    ...connection,
    /** Reconnect now. An explicit retry also permits a new full conflict recovery. */
    restart: () => {
      conflicts.delete(conflictKey)
      connection.restart()
    },
    wake,
    stop: async () => {
      unsubscribe()
      await connection.stop()
    },
  }
}
