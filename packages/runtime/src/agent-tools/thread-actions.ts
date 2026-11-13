import { createHash } from 'node:crypto'
import { Effect, Schema } from 'effect'
import { runClientEffect } from '@dovo/client-runtime'
import {
  applyTurnSettings,
  automationActionSchema,
  automationListResultSchema,
  automationListPageSize,
  automationListNameLength,
  automationListByteBudget,
  automationReviewWorkflowSchema,
  automationActionSendSchema,
  automationIssues,
  botPaused,
  taskResources,
  threadActionReviewSchema,
  responseActionSendSchema,
  responseActionText,
  responseOperationSchema,
  resolveResponseAction,
  type ResponseOperation,
  type ResponseDispatch,
  permissionPolicyReadOnly,
  effectivePermissionPolicy,
  redactCredentialText,
  type AutomationAction,
  type ThreadActionSuggestion,
  type PermissionPolicy,
  agentSchema,
  providerSchema,
  approvalPolicySchema,
  sandboxModeSchema,
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

/** Card prompts and review data kept on a thread, in UTF-8 bytes. */
export const preparedPromptBudget = 64 * 1024

export const threadActionId = (taskId: string, key: string) =>
  `thread-action:${createHash('sha256')
    .update(JSON.stringify([taskId, key]))
    .digest('hex')
    .slice(0, 40)}`

/** Sent and dismissed decisions outlive card eviction, so an agent cannot revive them by
 * preparing the same key again and a sent card keeps its link. Deleted with the thread. */
const ceilingKey = (taskId: string, actionId: string) =>
  `thread-action-ceiling:${taskId}:${actionId}`
const actionCeilingSchema = Schema.Struct({
  provider: providerSchema,
  permission: agentSchema.fields.permission,
  approvalPolicy: Schema.optional(approvalPolicySchema),
  sandboxMode: Schema.optional(sandboxModeSchema),
})
function originalCeiling(s: Services, taskId: string, actionId: string) {
  const stored = s.db
    .prepare('SELECT value FROM documents WHERE id=?')
    .get(ceilingKey(taskId, actionId))
  return stored &&
    typeof stored === 'object' &&
    'value' in stored &&
    typeof stored.value === 'string'
    ? decode(actionCeilingSchema, JSON.parse(stored.value))
    : undefined
}
const finalKey = (taskId: string, actionId: string) => `thread-action-final:${taskId}:${actionId}`
function finalAction(s: Services, taskId: string, actionId: string) {
  const row = s.db.prepare('SELECT value FROM documents WHERE id=?').get(finalKey(taskId, actionId))
  return row && typeof row === 'object' && 'value' in row && typeof row.value === 'string'
    ? decode(threadActionSchema, JSON.parse(row.value))
    : undefined
}
export function forgetThreadActions(s: Services, taskId: string) {
  for (const prefix of ['thread-action-final', 'thread-action-ceiling'])
    s.db
      .prepare('DELETE FROM documents WHERE id >= ? AND id < ?')
      .run(`${prefix}:${taskId}:`, `${prefix}:${taskId};`)
}

const rejected = (status: number, message: string) =>
  new HttpError(status, message, { mutationRejected: true })

function findAction(s: Services, sourceTaskId: string, actionId: string) {
  const source = s.store.get().tasks.find((task) => task.id === sourceTaskId)
  if (!source) throw rejected(404, 'Thread not found')
  const action =
    finalAction(s, sourceTaskId, actionId) ??
    source.threadActions?.find((item) => item.id === actionId)
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
  return threadStartAcknowledgement(s, {
    action: decode(
      threadActionSchema,
      s.store.publicValue(findAction(s, sourceTaskId, actionId).action),
    ),
  })
}

function hasTerminalControls(text: string) {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    if ((code < 32 && code !== 9 && code !== 10) || code === 127) return true
  }
  return false
}

const bytes = (text: string) => Buffer.byteLength(text, 'utf8')
const cardBytes = (action: ThreadAction) =>
  bytes(action.prompt) +
  (action.automation ? bytes(JSON.stringify(action.automation)) : 0) +
  (action.response ? bytes(JSON.stringify(action.response)) : 0)

/** `thread_prepare`: store or replace one unsent card. Starts no work. A dismissed or sent
 * action is a human decision; preparing the same key again returns it unchanged. */
export function prepareThreadAction(
  s: Services,
  value: unknown,
  runId: string,
  sourceCeiling?: PermissionPolicy,
) {
  const { taskId, command } = decode(threadPrepareRequestSchema, value)
  if ('kind' in command && command.kind === 'list-automations') {
    if (s.store.taskSummary(taskId).activeRunId !== runId)
      throw new HttpError(409, 'Workflow discovery requires this thread’s active agent turn')
    const flows = [...s.store.get().automations].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    )
    const revision = createHash('sha256')
      .update(JSON.stringify(flows.map(({ id, name, enabled }) => [id, name, enabled !== false])))
      .digest('hex')
    let start = 0
    if (command.cursor) {
      const match = /^([a-f0-9]{64})\.([1-9][0-9]*)$/.exec(command.cursor)
      if (!match) throw new HttpError(400, 'Invalid workflow cursor. List again without cursor.')
      start = Number(match[2])
      if (match[1] !== revision || !Number.isSafeInteger(start) || start >= flows.length)
        throw new HttpError(409, 'The workflow catalog changed. List again without cursor.')
    }
    const page: typeof automationListResultSchema.Type.automations = []
    const response = (end: number) => ({
      automations: page,
      ...(end < flows.length ? { nextCursor: `${revision}.${end}` } : {}),
    })
    let end = start
    while (end < flows.length && page.length < (command.limit ?? automationListPageSize)) {
      const flow = flows[end]
      page.push({
        id: flow.id,
        name:
          flow.name.length > automationListNameLength
            ? flow.name.slice(0, automationListNameLength - 1) + '…'
            : flow.name,
        enabled: flow.enabled !== false,
      })
      if (bytes(JSON.stringify(response(end + 1))) > automationListByteBudget) {
        page.pop()
        if (!page.length)
          throw new HttpError(409, 'A workflow summary exceeds the discovery response limit.')
        break
      }
      end++
    }
    return decode(automationListResultSchema, response(end))
  }
  const id = threadActionId(taskId, command.key)
  const action = s.store.transaction(() => {
    const task = s.store.taskSummary(taskId)
    if (task.activeRunId !== runId)
      throw new HttpError(409, 'Thread actions require this thread’s active agent turn')
    const decided = finalAction(s, taskId, id)
    if (decided) return decided
    const existing = task.threadActions?.find((item) => item.id === id)
    const automation =
      'kind' in command && command.kind === 'automation'
        ? automationReview(s, command.automationId)
        : undefined
    const response = 'kind' in command && command.kind === 'response' ? command.action : undefined
    if (
      response?.kind === 'form' &&
      (new Set(response.fields.map((field) => field.id)).size !== response.fields.length ||
        new Set(response.actions.map((item) => item.id)).size !== response.actions.length ||
        response.fields.some(
          (field) =>
            field.type === 'choice' &&
            (!field.options?.length ||
              new Set(field.options.map((option) => option.value)).size !== field.options.length ||
              (field.value && !field.options.some((option) => option.value === field.value))),
        ))
    )
      throw rejected(400, 'Use unique field and action IDs and valid choice options.')
    if (response?.kind === 'command' && hasTerminalControls(response.command))
      throw rejected(400, 'Commands cannot contain terminal control characters.')
    if (response && bytes(JSON.stringify(response)) > 20000)
      throw rejected(400, 'Keep the response action below 20 KB.')
    const suggestionCommand: ThreadActionSuggestion = 'kind' in command ? {} : command
    if (
      suggestionCommand.agentId &&
      !s.store.agentsFor(task.repositoryId).some((agent) => agent.id === suggestionCommand.agentId)
    )
      throw new HttpError(400, 'Unknown agentId for this project. Omit it or use subagent_list.')
    const now = new Date().toISOString()
    const suggestion = {
      ...(suggestionCommand.provider ? { provider: suggestionCommand.provider } : {}),
      ...(suggestionCommand.model ? { model: suggestionCommand.model } : {}),
      ...(suggestionCommand.reasoning ? { reasoning: suggestionCommand.reasoning } : {}),
      ...(suggestionCommand.agentId ? { agentId: suggestionCommand.agentId } : {}),
    }
    const next: ThreadAction = {
      id,
      key: command.key,
      title: command.title,
      prompt: 'prompt' in command ? command.prompt : responseActionText(command.action),
      ...(Object.keys(suggestion).length ? { suggestion } : {}),
      ...(automation ? { automation } : {}),
      ...(response ? { response } : {}),
      runId,
      state: 'prepared',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    let actions = (task.threadActions ?? []).filter((item) => item.id !== id)
    const unsent = actions
      .filter((item) => item.state === 'prepared')
      .reduce((total, item) => total + cardBytes(item), cardBytes(next))
    if (unsent > preparedPromptBudget)
      throw new HttpError(
        409,
        `Unsent action prompts and review data in this thread exceed ${preparedPromptBudget / 1024} KB. Shorten the prompt, or ask the user to send or dismiss earlier actions.`,
      )
    const position = task.threadActions?.findIndex((item) => item.id === id) ?? -1
    if (position >= 0) actions.splice(Math.min(position, actions.length), 0, next)
    else actions.push(next)
    // Finished cards make room, oldest first, until the count and total prompt bytes fit.
    // Their decisions persist outside the thread. Unsent cards never drop.
    const total = () => actions.reduce((sum, item) => sum + cardBytes(item), 0)
    while (actions.length > maxThreadActions || total() > preparedPromptBudget) {
      const finished = actions.findIndex((item) => item.state !== 'prepared')
      if (finished < 0)
        throw new HttpError(
          409,
          `This thread already has ${maxThreadActions} unsent actions. Ask the user to send or dismiss some first.`,
        )
      actions = actions.filter((_, index) => index !== finished)
    }
    const ceiling = sourceCeiling ?? resolveTaskAgent(task, s.store.get().agents)
    if (!ceiling) throw rejected(409, 'The source thread no longer has an available agent.')
    s.db
      .prepare('INSERT OR REPLACE INTO documents (id,value) VALUES (?,?)')
      .run(ceilingKey(taskId, id), JSON.stringify(decode(actionCeilingSchema, ceiling)))
    s.store.updateTask(taskId, (current) => ({ ...current, threadActions: actions }))
    return next
  })
  return {
    id: action.id,
    state: action.state,
    ...(action.sent ? { sent: action.sent } : {}),
    ...(action.automationSent ? { automationSent: action.automationSent } : {}),
    note:
      action.state === 'prepared'
        ? action.response
          ? 'Prepared a response button. Nothing runs until the user selects it. Direct commands and MCP calls require review. Do not wait for it.'
          : action.automation
            ? 'Prepared an automation review card. Nothing runs until a paired user reviews it and taps Start. Do not wait for it.'
            : 'Prepared a card in this thread. Nothing runs until the user reviews it and taps Send; they may change the prompt, harness and model. Do not wait for it.'
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
  const prepared = findAction(s, source.id, input.actionId).action
  const original = originalCeiling(s, source.id, prepared.id)
  // The first turn may carry its own full harness; that is the access it runs with.
  if (
    (original &&
      (!permissionPolicyWithinCeiling(original, chosen) ||
        !permissionPolicyWithinCeiling(original, applyTurnSettings(chosen, input.turnSettings)))) ||
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
export function sendThreadActionEffect(
  s: Services,
  value: unknown,
  authorize: () => void = () => {},
) {
  return Effect.gen(function* () {
    if (typeof value === 'object' && value !== null && 'response' in value)
      return yield* sendResponseActionEffect(s, value, authorize)
    if (typeof value === 'object' && value !== null && 'revision' in value)
      return yield* runtimeOperation(() => sendAutomationAction(s, value))
    const input = decode(threadActionSendSchema, value)
    const { source, action } = yield* runtimeOperation(() =>
      findAction(s, input.sourceTaskId, input.actionId),
    )
    if (action.state === 'dismissed')
      return yield* Effect.fail(rejected(409, 'This action was dismissed.'))
    if (action.automation || action.response)
      return yield* Effect.fail(rejected(409, 'Review this action before sending it.'))
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

const runningResponses = new WeakMap<Services, Map<string, string>>()
function admitResponse(
  s: Services,
  source: TaskSummary,
  action: ThreadAction,
  operation?: ResponseOperation,
) {
  const response =
    operation ??
    (action.response?.kind === 'form' ? action.responseReview?.resolved : action.response)
  if (source.archived || source.archivedAt || source.status === 'done' || source.machineHandoff)
    throw rejected(409, 'Reopen this thread on its home computer before using the action.')
  s.tasks.requireExecutionOwner(source.id)
  if (response && response.kind !== 'prompt') s.tasks.requireIdle(source.id)
  if (botPaused(source)) throw rejected(409, 'Resume this Bot before using the action.')
  const current = resolveTaskAgent(source, s.store.get().agents)
  const original = originalCeiling(s, source.id, action.id)
  if (!current || !original || !permissionPolicyWithinCeiling(original, current))
    throw rejected(403, 'The thread access changed. Ask the agent to prepare a new action.')
  if (response && response.kind !== 'prompt' && permissionPolicyReadOnly(current))
    throw rejected(403, 'Direct actions require write access. Use a follow-up prompt instead.')
  if (
    response?.kind === 'command' &&
    (effectivePermissionPolicy(current).sandboxMode !== 'danger-full-access' ||
      effectivePermissionPolicy(original).sandboxMode !== 'danger-full-access')
  )
    throw rejected(
      403,
      'Direct commands require unrestricted terminal access. Use a follow-up prompt instead.',
    )
  return current
}

function responseContext(
  s: Services,
  source: TaskSummary,
  action: ThreadAction,
  operation: ResponseOperation,
) {
  const agent = admitResponse(s, source, action, operation)
  return JSON.stringify([
    action.response,
    operation,
    action.runId,
    agent,
    source.repositoryId,
    source.execution,
    source.existingWorktreePath,
    source.delegation,
    source.linkedCheckouts,
    source.checkoutBranch,
  ])
}

async function uncheckedResponseReview(
  s: Services,
  source: TaskSummary,
  action: ThreadAction,
  authorize: () => void,
  dispatch?: ResponseDispatch,
) {
  if (!action.response) throw rejected(409, 'This is not a response action.')
  if (dispatch && bytes(JSON.stringify(dispatch)) > 20000)
    throw rejected(400, 'Keep form values below 20 KB.')
  let response: ResponseOperation
  try {
    response = decode(responseOperationSchema, resolveResponseAction(action.response, dispatch))
  } catch (error) {
    throw rejected(400, error instanceof Error ? error.message : 'Invalid form input.')
  }
  if (
    bytes(JSON.stringify(response)) > 20000 ||
    (response.kind === 'command' && hasTerminalControls(response.command))
  )
    throw rejected(400, 'The resolved action is too large or contains terminal control characters.')
  const context = responseContext(s, source, action, response)
  const directory = response.kind === 'prompt' ? '' : await s.checkouts.fileDirectory(source.id)
  const tool =
    response.kind === 'mcp'
      ? await s.mcpApps.reviewResponseTool(
          source.id,
          response.server,
          response.tool,
          response.arguments,
          directory,
          authorize,
        )
      : undefined
  authorize()
  if (responseContext(s, s.store.taskSummary(source.id), action, response) !== context)
    throw rejected(409, 'The thread settings changed. Refresh the action review.')
  const review = {
    revision: createHash('sha256')
      .update(JSON.stringify([context, directory, tool?.revision]))
      .digest('hex'),
    directory,
    resolved: response,
    ...(dispatch ? { dispatch } : {}),
    description:
      tool?.description ??
      (response.kind === 'prompt'
        ? 'Send this prompt to the same thread. The current agent and tool permissions apply.'
        : 'Run this command in a new terminal on this thread’s computer. Output stays in the terminal.'),
  }
  return { review, toolRevision: tool?.revision, context }
}

async function responseReview(...args: Parameters<typeof uncheckedResponseReview>) {
  try {
    return await uncheckedResponseReview(...args)
  } catch (error) {
    if (error instanceof HttpError) throw rejected(error.status, error.message)
    throw error
  }
}

async function reviewResponseAction(
  s: Services,
  input: { sourceTaskId: string; actionId: string; dispatch?: ResponseDispatch },
  authorize: () => void,
) {
  const { source, action } = findAction(s, input.sourceTaskId, input.actionId)
  if (action.state === 'prepared') {
    const { review, context } = await responseReview(s, source, action, authorize, input.dispatch)
    s.store.transaction(() => {
      const latest = findAction(s, source.id, action.id).action
      if (
        latest.state !== 'prepared' ||
        JSON.stringify(latest.response) !== JSON.stringify(action.response) ||
        latest.runId !== action.runId
      )
        throw rejected(409, 'The action changed. Open its review again.')
      if (responseContext(s, s.store.taskSummary(source.id), latest, review.resolved) !== context)
        throw rejected(409, 'The thread settings changed. Open the review again.')
      setAction(s, source.id, {
        ...latest,
        responseReview: review,
        updatedAt: new Date().toISOString(),
      })
    })
  } else if (
    action.responseResult?.status === 'running' &&
    !runningResponses.get(s)?.has(action.id)
  ) {
    setAction(s, source.id, {
      ...action,
      responseResult: {
        status: 'uncertain',
        output:
          'Execution started before the runtime restarted. Check the result before preparing a new action. This button will not run it again.',
      },
    })
  }
  return result(s, source.id, action.id)
}

function sendResponseActionEffect(s: Services, value: unknown, authorize: () => void) {
  return runtimeOperation(async () => {
    const input = decode(responseActionSendSchema, value)
    const { source, action } = findAction(s, input.sourceTaskId, input.actionId)
    if (!action.response) throw rejected(409, 'This is not a response action.')
    if (action.state === 'dismissed') throw rejected(409, 'This action was dismissed.')
    if (action.state === 'sent') {
      const queued = source.queue?.find((item) => item.id === action.sent?.messageId)
      if (queued && !queued.paused && !source.queuePaused && source.status !== 'running') {
        authorize()
        admitResponse(s, source, action)
        await runClientEffect(startDeliveryEffect(s, action))
      }
      return result(s, source.id, action.id)
    }
    const { review, toolRevision, context } = await responseReview(
      s,
      source,
      action,
      authorize,
      action.responseReview?.dispatch,
    )
    const response = review.resolved
    if (response.kind !== 'prompt' && input.text !== undefined)
      throw rejected(400, 'Direct actions cannot replace their reviewed payload.')
    if (input.revision !== review.revision || action.responseReview?.revision !== review.revision)
      throw rejected(
        409,
        'The action or its settings changed. Refresh the review before running it.',
      )
    const active = runningResponses.get(s) ?? new Map<string, string>()
    runningResponses.set(s, active)
    let admitted = false
    s.store.transaction(() => {
      const latest = findAction(s, source.id, action.id).action
      if (latest.state === 'sent') return
      if (
        latest.state !== 'prepared' ||
        latest.responseReview?.revision !== input.revision ||
        JSON.stringify(latest.response) !== JSON.stringify(action.response) ||
        latest.runId !== action.runId
      )
        throw rejected(409, 'The action changed. Open its review again.')
      if (responseContext(s, s.store.taskSummary(source.id), latest, response) !== context)
        throw rejected(409, 'The thread settings changed. Refresh the action review.')
      authorize()
      const now = new Date().toISOString()
      if (response.kind === 'prompt') {
        s.tasks.queue.add(
          source.id,
          input.messageId,
          input.text ?? response.prompt,
          [],
          undefined,
          false,
          false,
          undefined,
          {
            source: { kind: 'system', label: 'Response button' },
            unsnooze: true,
          },
        )
        setAction(s, source.id, {
          ...latest,
          state: 'sent',
          updatedAt: now,
          sent: { taskId: source.id, messageId: input.messageId, sentAt: now },
        })
      } else {
        if ([...active.values()].includes(source.id))
          throw rejected(409, 'Wait for the other direct action in this thread to finish.')
        setAction(s, source.id, {
          ...latest,
          state: 'sent',
          updatedAt: now,
          responseResult: {
            status: 'running',
            output: 'Execution started. Completion has not been confirmed.',
          },
        })
      }
      admitted = true
    })
    if (!admitted) return result(s, source.id, action.id)
    if (response.kind === 'prompt') {
      await runClientEffect(startDeliveryEffect(s, findAction(s, source.id, action.id).action))
      return result(s, source.id, action.id)
    }
    active.set(action.id, source.id)
    let execution: NonNullable<ThreadAction['responseResult']>
    let terminalId: string | undefined
    try {
      authorize()
      if (response.kind === 'command') {
        const directory = await s.checkouts.fileDirectory(source.id)
        if (responseContext(s, s.store.taskSummary(source.id), action, response) !== context)
          throw rejected(409, 'The thread settings changed.')
        authorize()
        if (directory !== review.directory) throw rejected(409, 'The working directory changed.')
        const terminal = s.terminals.create(source.id, directory)
        terminalId = terminal.id
        s.terminals.input(terminal.id, `${response.command.replace(/\r?\n/g, '\r')}\r`)
        execution = {
          status: 'started',
          output: 'Started in a new terminal. Open it to see output or stop the command.',
          terminalId: terminal.id,
        }
      } else {
        const output = await s.mcpApps.callResponseTool(
          source.id,
          response.server,
          response.tool,
          response.arguments,
          review.directory,
          toolRevision ?? '',
          () => {
            if (responseContext(s, s.store.taskSummary(source.id), action, response) !== context)
              throw rejected(409, 'The thread settings changed.')
            authorize()
          },
        )
        execution = {
          status: output.isError ? 'failed' : 'completed',
          output: redactCredentialText(
            output.content
              .filter((item) => item.type === 'text')
              .map((item) => item.text)
              .join('\n') ||
              (output.structuredContent
                ? JSON.stringify(output.structuredContent)
                : 'The MCP tool returned no text.'),
          ).slice(0, 12000),
        }
      }
    } catch (error) {
      execution = {
        status: 'uncertain',
        ...(terminalId ? { terminalId } : {}),
        output: redactCredentialText(
          `The action failed or its result is unknown. Check before trying again. ${error instanceof Error ? error.message : 'Execution failed.'}`,
        ).slice(0, 12000),
      }
    } finally {
      active.delete(action.id)
    }
    s.store.transaction(() => {
      if (s.store.wasTaskDeleted(source.id)) return
      const latest = findAction(s, source.id, action.id).action
      setAction(s, source.id, {
        ...latest,
        responseResult: execution,
        updatedAt: new Date().toISOString(),
      })
      s.activity.add('task', source.id, `Response action · ${action.title}`, {
        actionId: action.id,
        status: execution.status,
      })
    })
    authorize()
    return result(s, source.id, action.id)
  })
}

/** Maximum public review bytes per card, including the complete saved workflow. */
export const automationReviewBudget = 128 * 1024

function automationReview(s: Services, automationId: string): AutomationAction {
  const workspace = s.store.get()
  const workflow = workspace.automations.find((item) => item.id === automationId)
  if (!workflow) throw rejected(409, 'This automation was deleted. Choose another automation.')
  if (workflow.nodes.length > 100 || workflow.edges.length > 1000)
    throw rejected(
      409,
      'This automation is too large for an action card. Use its normal Run action.',
    )
  if (workflow.enabled === false)
    throw rejected(409, 'This automation is paused. Resume it before reviewing this action.')
  // The shared graph validator has no runtime defaults. Validate the same effective
  // harness that Tasks.create will use, while keeping the saved workflow unchanged.
  const issues = automationIssues(
    {
      ...workflow,
      nodes: workflow.nodes.map((node) =>
        node.data.kind === 'task' && !node.data.botId && !node.data.harness && !node.data.agentId
          ? {
              ...node,
              data: { ...node.data, harness: s.store.taskDefaults(node.data.repositoryId).harness },
            }
          : node,
      ),
    },
    workspace,
  )
  if (issues.length) throw rejected(409, issues[0])
  const privateRevision: unknown[] = []
  const resources = workflow.nodes
    .filter((node) => node.data.kind === 'task')
    .map((node) => {
      const bot = node.data.botId
        ? workspace.tasks.find((task) => task.id === node.data.botId)
        : undefined
      if (node.data.botId && (!bot?.bot || bot.archivedAt || botPaused(bot) || bot.queuePaused))
        throw rejected(409, `The Bot for ${node.data.label} is unavailable or paused.`)
      // Match Tasks.create: project defaults are applied before the node's saved settings.
      const defaults = s.store.taskDefaults(node.data.repositoryId)
      const target = bot ?? {
        ...defaults,
        ...node.data,
        id: node.id,
        harness: node.data.harness ?? (node.data.agentId ? undefined : defaults.harness),
        execution: node.data.execution ?? defaults.execution,
        modelSelection:
          node.data.harness || node.data.agentId ? undefined : defaults.modelSelection,
      }
      const agent = resolveTaskAgent(target, workspace.agents)
      if (!agent) throw rejected(409, `Choose an available agent for ${node.data.label}.`)
      // Selection is consumed before the first turn and the concrete harness is persisted.
      // Existing Bot turns/sessions must therefore review their saved model, not a selector.
      const modelSelection =
        bot && (bot.history?.turns || bot.sessionId || bot.delegation)
          ? undefined
          : target.modelSelection
      const repository = workspace.repositories.find((item) => item.id === target.repositoryId)
      if (!repository) throw rejected(409, `Choose an available project for ${node.data.label}.`)
      const links = bot?.pendingLinkedCheckouts ?? target.linkedCheckouts ?? []
      const projects = [
        {
          id: repository.id,
          name: repository.name,
          path: bot?.existingWorktreePath ?? repository.path,
        },
      ]
      for (const link of links) {
        const project = workspace.repositories.find((item) => item.id === link.repositoryId)
        if (!project) throw rejected(409, `A linked project for ${node.data.label} is unavailable.`)
        projects.push({
          id: project.id,
          name: project.name,
          path:
            bot?.linkedCheckoutSetup?.find((setup) => setup.id === link.id)?.directory ??
            link.existingWorktreePath ??
            project.path,
        })
      }
      // Hash private configuration without copying it into the card or its tool response.
      privateRevision.push({
        agent,
        bot: bot?.bot,
        defaults: bot ? undefined : defaults,
        resources: taskResources(target, workspace, s.defaults.get()),
        target: {
          repositoryId: target.repositoryId,
          execution: target.execution,
          linkedCheckouts: links,
          existingWorktreePath: bot?.existingWorktreePath,
          checkoutBranch: bot?.checkoutBranch,
          modelSelection: target.modelSelection,
          pendingLinkedCheckouts: bot?.pendingLinkedCheckouts,
          linkedCheckoutSetup: bot?.linkedCheckoutSetup,
        },
        projects: [
          repository,
          ...links.map((link) =>
            workspace.repositories.find((item) => item.id === link.repositoryId),
          ),
        ],
      })
      return {
        nodeId: node.id,
        label: node.data.label,
        ...(bot ? { botId: bot.id, botName: bot.title } : {}),
        repositoryId: repository.id,
        repositoryName: repository.name,
        execution: target.execution ?? 'main',
        projects,
        agent: {
          name: agent.name,
          provider: agent.provider,
          model: agent.model,
          ...(modelSelection ? { modelSelection } : {}),
          reasoning: agent.reasoning,
          permission: agent.permission,
          approvalPolicy: agent.approvalPolicy,
          sandboxMode: agent.sandboxMode,
        },
      }
    })
  const review = {
    automationId,
    revision: createHash('sha256')
      .update(JSON.stringify([workflow, resources, privateRevision]))
      .digest('hex'),
    workflow: decode(automationReviewWorkflowSchema, workflow),
    resources,
  }
  if (bytes(JSON.stringify(review)) > automationReviewBudget)
    throw rejected(
      409,
      'This automation is too large for an action card. Use its normal Run action.',
    )
  return decode(automationActionSchema, review)
}

function admitAutomation(s: Services, source: TaskSummary, action: ThreadAction, revision: string) {
  if (!action.automation) throw rejected(409, 'This is a new-thread action.')
  const review = automationReview(s, action.automation.automationId)
  if (revision !== action.automation.revision || revision !== review.revision)
    throw rejected(409, 'This automation changed. Refresh its review before starting it.')
  const ceiling = resolveTaskAgent(source, s.store.get().agents)
  const original = originalCeiling(s, source.id, action.id)
  if (
    !ceiling ||
    !original ||
    review.resources.some(
      (item) =>
        !permissionPolicyWithinCeiling(ceiling, item.agent) ||
        !permissionPolicyWithinCeiling(original, item.agent),
    )
  )
    throw rejected(
      403,
      'Every automation step must have the same or narrower access than this thread. Use the normal automation Run action for broader access.',
    )
  return review
}

export function reviewThreadAction(s: Services, value: unknown, authorize: () => void = () => {}) {
  const input = decode(threadActionReviewSchema, value)
  if (findAction(s, input.sourceTaskId, input.actionId).action.response)
    return reviewResponseAction(s, input, authorize)
  s.store.transaction(() => {
    const { source, action } = findAction(s, input.sourceTaskId, input.actionId)
    if (action.state !== 'prepared') return
    if (!action.automation) throw rejected(409, 'This is a new-thread action.')
    const refreshed = {
      ...action,
      automation: automationReview(s, action.automation.automationId),
      updatedAt: new Date().toISOString(),
    }
    const total = (source.threadActions ?? []).reduce(
      (sum, item) => sum + cardBytes(item.id === refreshed.id ? refreshed : item),
      0,
    )
    if (total > preparedPromptBudget)
      throw rejected(
        409,
        `Action prompts and review data in this thread exceed ${preparedPromptBudget / 1024} KB. Shorten the workflow before refreshing this review.`,
      )
    setAction(s, input.sourceTaskId, refreshed)
  })
  return result(s, input.sourceTaskId, input.actionId)
}

function sendAutomationAction(s: Services, value: unknown) {
  const input = decode(automationActionSendSchema, value)
  const current = findAction(s, input.sourceTaskId, input.actionId)
  if (current.action.state === 'dismissed') throw rejected(409, 'This action was dismissed.')
  if (current.action.state === 'sent') return result(s, input.sourceTaskId, input.actionId)
  const review = admitAutomation(s, current.source, current.action, input.revision)
  try {
    s.jobs.start(
      review.automationId,
      `thread-action:${input.sourceTaskId}:${input.actionId}`,
      {
        kind: 'reviewed-action',
        sourceTaskId: input.sourceTaskId,
        actionId: input.actionId,
        externalUserInput: { text: input.text },
      },
      (runId) => {
        const latest = findAction(s, input.sourceTaskId, input.actionId)
        if (latest.action.state !== 'prepared')
          throw rejected(409, 'This action was already decided.')
        admitAutomation(s, latest.source, latest.action, input.revision)
        const now = new Date().toISOString()
        setAction(s, input.sourceTaskId, {
          ...latest.action,
          state: 'sent',
          updatedAt: now,
          automationSent: { runId, sentAt: now },
        })
      },
    )
  } catch (error) {
    // A committed receipt wins even if acknowledgement or launch failed afterwards.
    if (finalAction(s, input.sourceTaskId, input.actionId)?.state === 'sent')
      return result(s, input.sourceTaskId, input.actionId)
    if (error instanceof HttpError) throw rejected(error.status, error.message)
    throw error
  }
  return result(s, input.sourceTaskId, input.actionId)
}
