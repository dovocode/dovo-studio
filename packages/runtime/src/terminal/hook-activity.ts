import {
  decode,
  mutableStruct,
  terminalActivitySchema,
  terminalTurnIdHistoryLimit,
  terminalTurnIdsSchema,
  terminalTurnIdSchema,
  terminalTurnSchema,
} from '@dovo/protocol'
import { Schema } from 'effect'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const transitionSchema = mutableStruct({
  sequence: terminalTurnSchema,
  turnId: Schema.optional(terminalTurnIdSchema),
  turn: terminalTurnSchema,
  state: Schema.NullOr(terminalActivitySchema.fields.state),
})
const hookActivitySchema = mutableStruct({
  id: Schema.String,
  at: Schema.Number,
  turnId: Schema.optional(terminalTurnIdSchema),
  turn: Schema.optional(terminalTurnSchema),
  sequence: Schema.optional(terminalTurnSchema),
  openTurns: Schema.optional(terminalTurnIdsSchema),
  completedTurns: Schema.optional(terminalTurnIdsSchema),
  completionPositions: Schema.optional(
    Schema.Array(Schema.NullOr(Schema.Tuple([terminalTurnSchema, terminalTurnSchema]))).pipe(
      Schema.check(Schema.isMaxLength(terminalTurnIdHistoryLimit)),
    ),
  ),
  transitions: Schema.optional(
    Schema.Array(transitionSchema).pipe(Schema.check(Schema.isMaxLength(32))),
  ),
  activity: Schema.NullOr(terminalActivitySchema),
})
export type TerminalHookActivity = typeof hookActivitySchema.Type

/** Replay completed jobs whose original state reports rolled out of the hook file. */
export function* hookActivityHistory(
  event: TerminalHookActivity,
  afterSequence: number,
  afterTurn: number,
) {
  const retained = event.transitions?.filter((entry) => entry.sequence > afterSequence) ?? []
  const first =
    retained[0] ??
    (event.sequence !== undefined && event.turn !== undefined
      ? {
          sequence: event.sequence,
          turn: event.turn,
          state: event.activity?.state,
          turnId: event.activity?.turnId ?? event.turnId,
        }
      : undefined)
  if (first && first.sequence > afterSequence + 1) {
    const completed = event.completedTurns ?? []
    let cursor = afterTurn
    for (const [index, turnId] of completed.entries()) {
      const position = event.completionPositions?.[index]
      let turn
      if (position) {
        if (position[0] >= first.sequence) continue
        turn = position[1]
      } else {
        // Earlier reporters retained IDs in completion order but could also count
        // anonymous work. Recover an ID only if every possible position for it
        // lies within the missing prefix. Remaining increments stay anonymous.
        const earliest = index + 1
        const latest = (event.turn ?? 0) - (completed.length - 1 - index)
        const firstMayCompleteId =
          first.state !== 'working' && (!first.turnId || first.turnId === turnId)
        if (
          earliest <= afterTurn ||
          latest > first.turn ||
          (latest === first.turn && firstMayCompleteId)
        )
          continue
        turn = Math.max(cursor + 1, earliest)
      }
      if (turn <= cursor || turn > first.turn) continue
      cursor = turn
      yield { state: 'done' as const, turn, turnId, skipped: true }
    }
  }
  for (const entry of retained) yield { ...entry, skipped: false }
}

export function readTerminalHookActivity(directory: string): TerminalHookActivity | undefined {
  try {
    const bytes = readFileSync(join(directory, 'activity.json'))
    // Also allow the producer's 128 open and 128 completed IDs, long UTF-8
    // session paths, and up to 32 tagged transitions.
    if (bytes.length > 96 * 1024) throw new Error('Terminal activity event is too large')
    return decode(hookActivitySchema, JSON.parse(bytes.toString('utf8')))
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
}
