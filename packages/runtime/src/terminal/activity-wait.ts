import { Schema } from 'effect'
import type { TerminalInfo } from '@dovo/protocol'
import type { Terminals } from './terminals.js'

/** Reported states a caller can wait for. `working` is excluded: it is the state being waited out. */
export const terminalWaitStateSchema = Schema.Literals(['blocked', 'done', 'idle', 'error'])
export type TerminalWaitState = typeof terminalWaitStateSchema.Type

/** Why a bounded activity wait returned. `closed` means the terminal no longer exists. */
export type TerminalWaitResult = 'activity' | 'exit' | 'timeout' | 'closed'

function settled(
  info: TerminalInfo,
  until: readonly TerminalWaitState[] | undefined,
  afterTurn: number | undefined,
) {
  if (info.exited) return 'exit' as const
  if (afterTurn !== undefined && (info.turn ?? 0) <= afterTurn) return
  if (!until) return afterTurn !== undefined ? ('activity' as const) : undefined
  const state = info.activity?.state
  return state && (until as readonly string[]).includes(state) ? ('activity' as const) : undefined
}

/**
 * Waits for a matching report or turn, program exit, close, or `waitMs`. When both
 * filters are present, both must match. Every return path, including
 * timeout and cancellation, removes its one observer and timer, so nothing outlives the call.
 */
export async function waitForTerminalActivity(
  terminals: Pick<Terminals, 'get' | 'observe'>,
  id: string,
  until: readonly TerminalWaitState[] | undefined,
  waitMs: number,
  signal: AbortSignal,
  afterTurn?: number,
): Promise<TerminalWaitResult> {
  signal.throwIfAborted()
  const session = terminals.get(id)
  const current = settled(session.info, until, afterTurn)
  if (current) return current
  if (!waitMs) return 'timeout'
  return new Promise<TerminalWaitResult>((resolve, reject) => {
    const finish = (result: TerminalWaitResult | Error) => {
      clearTimeout(timer)
      unsubscribe()
      signal.removeEventListener('abort', abort)
      if (result instanceof Error) reject(result)
      else resolve(result)
    }
    const abort = () =>
      finish(signal.reason instanceof Error ? signal.reason : new Error('Terminal wait cancelled'))
    const timer = setTimeout(() => finish('timeout'), waitMs)
    signal.addEventListener('abort', abort, { once: true })
    // The session object stays valid after close; `info` is replaced on every change.
    const unsubscribe = terminals.observe(id, (event) => {
      const result = event === 'close' ? 'closed' : settled(session.info, until, afterTurn)
      if (result) finish(result)
    })
  })
}
