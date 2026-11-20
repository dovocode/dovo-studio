import {
  mutableStruct,
  terminalTurnIdSchema,
  terminalTurnSchema,
  terminalTurnIdHistoryLimit,
  terminalTurnIdsSchema,
} from '@dovo/protocol'
import { Schema } from 'effect'

const sourceSchema = mutableStruct({
  turn: terminalTurnSchema,
  working: Schema.Boolean,
  covered: Schema.Boolean,
  turnId: Schema.optional(terminalTurnIdSchema),
})
export const terminalTurnProgressSchema = mutableStruct({
  working: Schema.Boolean,
  osc: sourceSchema,
  hook: sourceSchema,
  hookSequence: Schema.optional(terminalTurnSchema),
  visibleId: Schema.optional(terminalTurnIdSchema),
  open: Schema.optional(terminalTurnIdsSchema),
  completed: Schema.optional(terminalTurnIdsSchema),
})
export type TerminalTurnProgress = typeof terminalTurnProgressSchema.Type

export function initialTerminalTurnProgress(): TerminalTurnProgress {
  return {
    working: false,
    osc: { turn: 0, working: false, covered: false },
    hook: { turn: 0, working: false, covered: false },
  }
}

function remember(ids: readonly string[] | undefined, id: string) {
  return [...(ids ?? []), id].slice(-terminalTurnIdHistoryLimit)
}

/** Recover identities whose original state changes rolled out of the hook file.
 * Keep newer mixed-source observations ahead of these older recovered IDs. */
export function restoreHookTurnIds(
  progress: TerminalTurnProgress,
  openTurns?: readonly string[],
  completedTurns?: readonly string[],
) {
  const settled = completedTurns?.filter((id) => !progress.completed?.includes(id)) ?? []
  const open = progress.open?.filter((id) => !settled.includes(id))
  const missing =
    openTurns?.filter(
      (id) =>
        !open?.includes(id) && !completedTurns?.includes(id) && !progress.completed?.includes(id),
    ) ?? []
  if (!settled.length && !missing.length) return progress
  return {
    ...progress,
    completed: [...settled, ...(progress.completed ?? [])].slice(-terminalTurnIdHistoryLimit),
    open: [...missing, ...(open ?? [])].slice(-terminalTurnIdHistoryLimit),
  }
}

/** A process exit or replacement ends every working turn it still owns. */
export function closeWorkingTurns(progress: TerminalTurnProgress) {
  const open = progress.open ?? []
  return {
    count: Math.max(open.length, Number(progress.working && !progress.visibleId)),
    progress: {
      ...progress,
      working: false,
      visibleId: undefined,
      osc: { ...progress.osc, covered: progress.osc.working },
      hook: { ...progress.hook, covered: progress.hook.working },
      ...(open.length
        ? {
            open: [],
            completed: [...(progress.completed ?? []), ...open].slice(-terminalTurnIdHistoryLimit),
          }
        : {}),
    },
  }
}

export function advanceTerminalTurn(
  progress: TerminalTurnProgress,
  source: 'osc' | 'hook',
  working: boolean,
  reportedTurn: number | undefined,
  current: boolean,
  reportedId?: string,
) {
  const other = source === 'osc' ? 'hook' : 'osc'
  const before = progress[source]
  const peer = progress[other]
  // A clear may omit the ID of the job that was just working.
  const id =
    reportedId ??
    (!working && before.working ? before.turnId : undefined) ??
    (!working && progress.working && peer.working ? peer.turnId : undefined)
  const samePeriod = (turnId: string | undefined) => !turnId || !id || turnId === id
  const endsSourceWork = before.working && !working && samePeriod(before.turnId)
  const turn = reportedTurn ?? before.turn + Number(endsSourceWork)
  const delta = Math.max(0, turn - before.turn)
  const covered = before.covered && samePeriod(before.turnId)
  const newTurns = delta - Number(covered && delta > 0)
  const duplicate = covered && newTurns === 0 && (!working || delta === 0)
  const known = id !== undefined && !!progress.completed?.includes(id)
  const pending = id !== undefined && !!progress.open?.includes(id)
  const differentVisible = !!id && !!progress.visibleId && id !== progress.visibleId
  const stale =
    known && (differentVisible || (!progress.visibleId && (working || progress.working)))
  const endsOtherTurn = !working && differentVisible && progress.working
  const apply =
    current && (!duplicate || (known && id === progress.visibleId)) && !stale && !endsOtherTurn
  const closesCurrent =
    apply &&
    progress.working &&
    !working &&
    (endsSourceWork || (peer.working && samePeriod(peer.turnId)) || !id)
  let count = Math.max(newTurns, Number(closesCurrent))
  const closesId =
    id !== undefined && !working && (pending || closesCurrent || delta > 0 || endsSourceWork)
  const countedId = closesId && !known && (!covered || pending)
  if (closesId) {
    // A jump in the producer's counter can include older reports outside its
    // history. Only the last of those completions can belong to this ID.
    count = Math.max(0, delta - 1) + Number(countedId)
  }
  const preserveSource = id && before.working && !samePeriod(before.turnId) && (!working || stale)
  const next: TerminalTurnProgress = {
    ...progress,
    working: apply ? working : progress.working,
    visibleId: apply ? id : progress.visibleId,
    [source]: preserveSource
      ? { ...before, turn }
      : {
          turn,
          working,
          covered: covered && working && delta === 0,
          ...(id ? { turnId: id } : {}),
        },
  }
  if (working && id && !known && !pending) next.open = remember(progress.open, id)
  if (closesId && !known) {
    if (pending) next.open = progress.open?.filter((entry) => entry !== id)
    next.completed = remember(progress.completed, id)
  }
  if (count && peer.working && samePeriod(peer.turnId)) next[other] = { ...peer, covered: true }
  return { apply, count, progress: next, id, countedId }
}
