import { Schema, Struct } from 'effect'
import { checkpointUndoTurn, checkpointFileCount } from '../scm/repositories/file-previews.js'
import { pullReferencesInText } from '../scm/pulls/pull-links.js'
import { mutableArray, mutableStruct } from '../shared/schema.js'
import { taskSchema, turnSchema, type Task, type TaskTurn, type Workspace } from '../workspace.js'

/** Task fields that are not conversation history. Helpers that only need these accept both a
 * complete `Task` and a `TaskSummary`. */
export type TaskMetadata = Omit<Task, 'messages' | 'turns'>
export const taskMetadataSchema = taskSchema.mapFields(Struct.omit(['messages', 'turns']))
/** A turn without its checkpoint snapshot, which can hold file contents. */
export type TaskTurnSummary = Omit<TaskTurn, 'checkpoint'>
const countSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
/** Bounded facts derived from a complete history. They never stand in for the history itself:
 * reading messages or turns requires loading the complete task. Hosts persist them beside task
 * metadata so listing tasks does not read any conversation. */
export const taskHistorySummarySchema = mutableStruct({
  messages: countSchema,
  /** Undefined when the task has no turn list, as distinct from an empty one. */
  turns: Schema.optional(countSchema),
  latestTurn: Schema.optional(turnSchema.mapFields(Struct.omit(['checkpoint']))),
  /** Provider of the first turn, authoritative for tasks created before provider locks. */
  firstProvider: turnSchema.fields.provider.pipe(Schema.optional),
  /** Text of the first and newest user messages. */
  firstUserText: Schema.optional(Schema.String),
  latestUserText: Schema.optional(Schema.String),
  /** Agent time, tokens and change state of every turn before `latestTurn`. */
  earlier: taskSchema.fields.historyTotals,
  /** Pull request links found in messages: distinct URLs in first-mention order, the last 20. */
  pullReferences: Schema.optional(
    mutableArray(mutableStruct({ number: Schema.Number, url: Schema.String })),
  ),
  /** Distinct linked checkouts captured by turn checkpoints, which can outlive the task's links. */
  linkedCheckpoints: Schema.optional(
    mutableArray(
      mutableStruct({
        checkoutId: Schema.String,
        repositoryId: Schema.String,
        directory: Schema.String,
      }),
    ),
  ),
})
/** Increment when derivation changes, so stored summaries are derived again. */
export const taskHistorySummaryVersion = 1
export type TaskHistorySummary = Schema.Schema.Type<typeof taskHistorySummarySchema>
/** Host-side task state without conversation history. */
export type TaskSummary = TaskMetadata & { history: TaskHistorySummary }
export type WorkspaceSummary = Omit<Workspace, 'tasks'> & { tasks: TaskSummary[] }

const summaries = new WeakMap<object, WeakMap<object, TaskHistorySummary>>()
const messageReferences = new WeakMap<object, ReturnType<typeof pullReferencesInText>>()
function pullReferences(messages: Task['messages']) {
  const references = new Map<string, { number: number; url: string }>()
  for (const message of messages) {
    let found = messageReferences.get(message)
    if (!found) messageReferences.set(message, (found = pullReferencesInText(message.text)))
    for (const reference of found) references.set(reference.url, reference)
  }
  return [...references.values()].slice(-20)
}
const earlierTotals = new WeakMap<readonly TaskTurn[], TaskHistorySummary['earlier']>()
const checkpointLinks = new WeakMap<readonly TaskTurn[], TaskHistorySummary['linkedCheckpoints']>()
function linkedCheckpoints(turns: readonly TaskTurn[]) {
  if (checkpointLinks.has(turns)) return checkpointLinks.get(turns)
  const links = new Map<string, NonNullable<TaskHistorySummary['linkedCheckpoints']>[number]>()
  for (const turn of turns)
    for (const { checkoutId, repositoryId, directory } of turn.checkpoint?.linked ?? [])
      links.set(JSON.stringify([checkoutId, repositoryId, directory]), {
        checkoutId,
        repositoryId,
        directory,
      })
  const result = links.size ? [...links.values()] : undefined
  checkpointLinks.set(turns, result)
  return result
}
const noTurns: readonly TaskTurn[] = []

function earlier(turns: readonly TaskTurn[], now: number) {
  if (turns.length < 2) return undefined
  if (earlierTotals.has(turns)) return earlierTotals.get(turns)
  const older = turns.slice(0, -1)
  let tokens: number | undefined
  let milliseconds = 0
  for (const turn of older) {
    if (turn.tokens !== undefined) tokens = (tokens ?? 0) + turn.tokens
    const start = Date.parse(turn.startedAt)
    const end = turn.finishedAt ? Date.parse(turn.finishedAt) : now
    if (Number.isFinite(start) && Number.isFinite(end)) milliseconds += Math.max(0, end - start)
  }
  const undoable = checkpointUndoTurn(older)
  const totals = {
    tokens,
    milliseconds,
    hasChanges: older.some((turn) => !!turn.checkpoint && checkpointFileCount(turn.checkpoint) > 0),
    undoableTurnId: undoable?.id,
    pendingUndoTurnId: undoable?.checkpoint?.restorePending ? undoable.id : undefined,
  }
  earlierTotals.set(turns, totals)
  return totals
}

/** Derives the bounded summary of a complete history. Results are shared while the message and
 * turn arrays are unchanged, so repeated updates of other fields cost nothing. */
export function summarizeTaskHistory(
  task: Pick<Task, 'messages' | 'turns'>,
  now = Date.now(),
): TaskHistorySummary {
  const turns = task.turns ?? noTurns
  let byTurns = summaries.get(task.messages)
  const cached = byTurns?.get(turns)
  if (cached) return cached
  const firstUser = task.messages.find((message) => message.role === 'user')
  let latestUser: Task['messages'][number] | undefined
  for (let index = task.messages.length - 1; index >= 0 && !latestUser; index--)
    if (task.messages[index]!.role === 'user') latestUser = task.messages[index]
  const latest = turns.at(-1)
  const references = pullReferences(task.messages)
  const linked = linkedCheckpoints(turns)
  const summary: TaskHistorySummary = {
    messages: task.messages.length,
    ...(task.turns !== undefined ? { turns: task.turns.length } : {}),
    ...(latest ? { latestTurn: withoutCheckpoint(latest) } : {}),
    ...(turns[0] ? { firstProvider: turns[0].provider } : {}),
    ...(firstUser ? { firstUserText: firstUser.text } : {}),
    ...(latestUser ? { latestUserText: latestUser.text } : {}),
    ...(turns.length > 1 ? { earlier: earlier(turns, now) } : {}),
    ...(references.length ? { pullReferences: references } : {}),
    ...(linked ? { linkedCheckpoints: linked } : {}),
  }
  if (!byTurns) summaries.set(task.messages, (byTurns = new WeakMap()))
  byTurns.set(turns, summary)
  return summary
}
function withoutCheckpoint({ checkpoint: _checkpoint, ...turn }: TaskTurn): TaskTurnSummary {
  return turn
}

/** The summary of a complete task. */
export function summarizeTask({ messages, turns, ...metadata }: Task): TaskSummary {
  return { ...metadata, history: summarizeTaskHistory({ messages, turns }) }
}
/** Splits a summary into the metadata a complete task carries alongside its history. */
export function taskMetadata({ history: _history, ...metadata }: TaskSummary): TaskMetadata {
  return metadata
}
