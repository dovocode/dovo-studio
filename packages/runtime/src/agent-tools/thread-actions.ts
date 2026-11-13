import { createHash } from 'node:crypto'
import { Effect } from 'effect'
import {
  applyTurnSettings,
  decode,
  SCRATCH_PROJECT_ID,
  maxThreadActions,
  permissionPolicyWithinCeiling,
  resolveTaskAgent,
  threadActionDismissSchema,
  threadActionSchema,
  threadActionSendSchema,
  threadPrepareRequestSchema,
  type TaskSummary,
  type ThreadAction,
  type ThreadActionResult,
  type ThreadActionSend,
} from '@dovo/protocol'
import type { Services } from '../services.js'
import { HttpError, runtimeOperation } from '../errors.js'
import { startThreadEffect, threadStartAcknowledgement } from '../http/endpoints/thread-start.js'

/** Card prompts kept on a thread, in UTF-8 bytes. Keeps thread summaries light. */
export const preparedPromptBudget = 64 * 1024

export const threadActionId = (taskId: string, key: string) =>
  `thread-action:${createHash('sha256')
    .update(JSON.stringify([taskId, key]))
    .digest('hex')
    .slice(0, 40)}`

/** Sent and dismissed decisions outlive card eviction, so an agent cannot revive them by
 * preparing the same key again and a sent card keeps its link. Deleted with the thread. */
const finalKey = (taskId: string, actionId: string) => `thread-action-final:${taskId}:${actionId}`
function finalAction(s: Services, taskId: string, actionId: string) {
  const row = s.db.prepare('SELECT value FROM documents WHERE id=?').get(finalKey(taskId, actionId))
  return row && typeof row === 'object' && 'value' in row && typeof row.value === 'string'
    ? decode(threadActionSchema, JSON.parse(row.value))
    : undefined
}
export function forgetThreadActions(s: Services, taskId: string) {
  s.db
    .prepare('DELETE FROM documents WHERE id >= ? AND id < ?')
    .run(`thread-action-final:${taskId}:`, `thread-action-final:${taskId};`)
}

const rejected = (status: number, message: string) =>
  new HttpError(status, message, { mutationRejected: true })

function findAction(s: Services, sourceTaskId: string, actionId: string) {
  const source = s.store.get().tasks.find((task) => task.id === sourceTaskId)
  if (!source) throw rejected(404, 'Thread not found')
  const action =
    source.threadActions?.find((item) => item.id === actionId) ??
    finalAction(s, sourceTaskId, actionId)
  if (!action) throw rejected(404, 'This action is no longer available')
  return { source, action }
}

/** Store a changed action on its card (when still listed) and record final decisions. */
function setAction(s: Services, sourceTaskId: string, action: ThreadAction) {
  if (action.state !== 'prepared')
    s.db
      .prepare('INSERT OR REPLACE INTO documents (id,value) VALUES (?,?)')
      .run(finalKey(sourceTaskId, action.id), JSON.stringify(action))
  s.store.updateTask(sourceTaskId, (task) => ({
    ...task,
    threadActions: task.threadActions?.map((item) => (item.id === action.id ? action : item)),
  }))
}

function result(s: Services, sourceTaskId: string, actionId: string): ThreadActionResult {
  return threadStartAcknowledgement(s, { action: findAction(s, sourceTaskId, actionId).action })
}

const bytes = (text: string) => Buffer.byteLength(text, 'utf8')

/** `thread_prepare`: store or replace one unsent card. Starts no work. A dismissed or sent
 * action is a human decision; preparing the same key again returns it unchanged. */
export function prepareThreadAction(s: Services, value: unknown, runId: string) {
  const { taskId, command } = decode(threadPrepareRequestSchema, value)
  const id = threadActionId(taskId, command.key)
  const action = s.store.transaction(() => {
    const task = s.store.taskSummary(taskId)
    if (task.activeRunId !== runId)
      throw new HttpError(409, 'Thread actions require this thread’s active agent turn')
    const decided = finalAction(s, taskId, id)
    if (decided) return decided
    const existing = task.threadActions?.find((item) => item.id === id)
    if (
      command.agentId &&
      !s.store.agentsFor(task.repositoryId).some((agent) => agent.id === command.agentId)
    )
      throw new HttpError(400, 'Unknown agentId for this project. Omit it or use subagent_list.')
    const now = new Date().toISOString()
    const suggestion = {
      ...(command.provider ? { provider: command.provider } : {}),
      ...(command.model ? { model: command.model } : {}),
      ...(command.reasoning ? { reasoning: command.reasoning } : {}),
      ...(command.agentId ? { agentId: command.agentId } : {}),
    }
    const next: ThreadAction = {
      id,
      key: command.key,
      title: command.title,
      prompt: command.prompt,
      ...(Object.keys(suggestion).length ? { suggestion } : {}),
      runId,
      state: 'prepared',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    let actions = (task.threadActions ?? []).filter((item) => item.id !== id)
    const unsent = actions
      .filter((item) => item.state === 'prepared')
      .reduce((total, item) => total + bytes(item.prompt), bytes(next.prompt))
    if (unsent > preparedPromptBudget)
      throw new HttpError(
        409,
        `Unsent action prompts in this thread exceed ${preparedPromptBudget / 1024} KB. Shorten the prompt, or ask the user to send or dismiss earlier actions.`,
      )
    const position = task.threadActions?.findIndex((item) => item.id === id) ?? -1
    if (position >= 0) actions.splice(Math.min(position, actions.length), 0, next)
    else actions.push(next)
    // Finished cards make room, oldest first, until the count and total prompt bytes fit.
    // Their decisions persist outside the thread. Unsent cards never drop.
    const total = () => actions.reduce((sum, item) => sum + bytes(item.prompt), 0)
    while (actions.length > maxThreadActions || total() > preparedPromptBudget) {
      const finished = actions.findIndex((item) => item.state !== 'prepared')
      if (finished < 0)
        throw new HttpError(
          409,
          `This thread already has ${maxThreadActions} unsent actions. Ask the user to send or dismiss some first.`,
        )
      actions = actions.filter((_, index) => index !== finished)
    }
    s.store.updateTask(taskId, (current) => ({ ...current, threadActions: actions }))
    return next
  })
  return {
    id: action.id,
    state: action.state,
    ...(action.sent ? { sent: action.sent } : {}),
    note:
      action.state === 'prepared'
        ? 'Prepared a card in this thread. Nothing runs until the user reviews it and taps Send; they may change the prompt, harness and model. Do not wait for it.'
        : action.state === 'sent'
          ? 'The user already sent this action. Use a new key for a new proposal.'
          : 'The user dismissed this action. Use a new key only for a materially new proposal.',
  }
}

/** Project availability and access ceiling, checked before and again inside the creating
 * transaction, so a settings change during preparation cannot bypass them. */
function admit(s: Services, source: TaskSummary, input: ThreadActionSend) {
  // Any project on this computer, or no project. Access, not project, is the boundary.
  if (
    input.createTask.repositoryId !== SCRATCH_PROJECT_ID &&
    !s.store.get().repositories.some((repo) => repo.id === input.createTask.repositoryId)
  )
    throw rejected(409, 'Choose a project on this computer for the new thread.')
  const agents = s.store.get().agents
  const ceiling = resolveTaskAgent(source, agents)
  const chosen = resolveTaskAgent(input.createTask, agents)
  if (!ceiling || !chosen) throw rejected(409, 'Choose an available harness for the new thread.')
  // The first turn may carry its own full harness; that is the access it runs with.
  if (
    !permissionPolicyWithinCeiling(ceiling, chosen) ||
    !permissionPolicyWithinCeiling(ceiling, applyTurnSettings(chosen, input.turnSettings))
  )
    throw rejected(
      403,
      'This action can start a thread with the same or narrower access than its source thread. Start a normal thread for broader access.',
    )
}

/** Start exactly the reviewed first message once. Other input a person queued or moved ahead
 * stays held, and a paused queue or paused message stays with that person. */
function startDeliveryEffect(s: Services, action: ThreadAction) {
  return Effect.gen(function* () {
    const sent = action.sent
    if (!sent || s.store.wasTaskDeleted(sent.taskId)) return
    const target = s.store.get().tasks.find((task) => task.id === sent.taskId)
    const queued = target?.queue?.find((item) => item.id === sent.messageId)
    if (!target || !queued || queued.paused || target.queuePaused || target.status === 'running')
      return
    yield* s.tasks.startEffect(
      sent.taskId,
      // Like Send now: when other input is queued, it stays held after this turn.
      (target.queue?.length ?? 0) > 1,
      undefined,
      undefined,
      false,
      sent.messageId,
      'accepted',
    )
  })
}

class AlreadyDecided extends Error {}

/** Human Send. The new thread, its queued first message and the sent state commit in one
 * transaction; the turn then starts. Every later request returns the sent action. */
export function sendThreadActionEffect(s: Services, value: unknown) {
  return Effect.gen(function* () {
    const input = decode(threadActionSendSchema, value)
    const { source, action } = yield* runtimeOperation(() =>
      findAction(s, input.sourceTaskId, input.actionId),
    )
    if (action.state === 'dismissed')
      return yield* Effect.fail(rejected(409, 'This action was dismissed.'))
    if (action.state === 'prepared') {
      yield* runtimeOperation(() => admit(s, source, input))
      const outcome = yield* Effect.exit(
        startThreadEffect(s, {
          messageId: input.messageId,
          createTask: input.createTask,
          commit: () => {
            const current = findAction(s, input.sourceTaskId, input.actionId)
            if (
              current.action.state === 'sent' &&
              current.action.sent?.taskId === input.createTask.id
            )
              return
            if (current.action.state !== 'prepared') throw new AlreadyDecided()
            admit(s, current.source, input)
            s.tasks.queue.add(
              input.createTask.id,
              input.messageId,
              input.text,
              [],
              undefined,
              false,
              true,
              undefined,
              {
                turnSettings: input.turnSettings,
                reopenSettled: true,
                unsnooze: true,
                source: { kind: 'user' },
              },
            )
            const now = new Date().toISOString()
            setAction(s, input.sourceTaskId, {
              ...current.action,
              state: 'sent',
              updatedAt: now,
              sent: { taskId: input.createTask.id, messageId: input.messageId, sentAt: now },
            })
            s.activity.add('task', input.sourceTaskId, 'Started a thread from an agent action', {
              taskId: input.createTask.id,
            })
          },
        }),
      )
      if (outcome._tag === 'Failure') {
        const current = yield* runtimeOperation(
          () => findAction(s, input.sourceTaskId, input.actionId).action,
        )
        // Another device or tap won; report its thread instead of starting a second one.
        if (current.state !== 'sent') return yield* Effect.failCause(outcome.cause)
      }
    }
    const current = yield* runtimeOperation(
      () => findAction(s, input.sourceTaskId, input.actionId).action,
    )
    if (current.state === 'dismissed')
      return yield* Effect.fail(rejected(409, 'This action was dismissed.'))
    yield* startDeliveryEffect(s, current)
    return yield* runtimeOperation(() => result(s, input.sourceTaskId, input.actionId))
  })
}

export function dismissThreadAction(s: Services, value: unknown) {
  const input = decode(threadActionDismissSchema, value)
  s.store.transaction(() => {
    const { action } = findAction(s, input.sourceTaskId, input.actionId)
    if (action.state !== 'prepared') return
    setAction(s, input.sourceTaskId, {
      ...action,
      state: 'dismissed',
      updatedAt: new Date().toISOString(),
    })
  })
  return result(s, input.sourceTaskId, input.actionId)
}
