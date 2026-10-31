import { createHash } from 'node:crypto'
import { Schema } from 'effect'
import {
  decode,
  defaultTaskHarness,
  delegatedAccess,
  noStudioTools,
  permissionPolicyReadOnly,
  permissionPolicyWithinCeiling,
  subagentListSchema,
  subagentReadSchema,
  subagentSendSchema,
  subagentAnswerSchema,
  taskHarnessSchema,
  threadWatchSnapshotSchema,
  type SubagentSpawn,
  type ThreadWatchSummary,
  type ThreadWatchSnapshot,
  SCRATCH_PROJECT_ID,
} from '@dovo/protocol'
import type { Services } from '../services.js'
import { HttpError } from '../errors.js'
import { routedStudioTool, studioComputer, studioComputerName } from './peers.js'
import { requireStudioPart, type StudioPolicy } from './tools.js'
import { targetedChildId } from './subagent-target.js'

const launches = new WeakMap<Services, Map<string, number>>()
const targetSchema = Schema.Struct({
  runtimeId: Schema.String,
  threadId: Schema.String,
  startError: Schema.optional(Schema.String),
})

function ownedTarget(s: Services, parentId: string, id: string) {
  return s.threadWatch
    .list(parentId)
    .find((watch) => watch.delegated && targetedChildId(watch) === id)
}
function parentPolicy(s: Services, taskId: string, supplied?: StudioPolicy): StudioPolicy {
  // Targeted children follow the same plan-turn ceiling as local children.
  const parent = s.tasks.delegationCeiling(s.store.taskSummary(taskId))
  if (!parent || (supplied && !permissionPolicyWithinCeiling(supplied.permissions, parent)))
    throw new HttpError(403, 'The parent agent permissions changed; start a fresh turn')
  return {
    permissions: parent,
    readOnly: permissionPolicyReadOnly(parent),
    studioTools: supplied?.studioTools ?? { ...noStudioTools(), threads: true },
  }
}
function targetResult(
  watch: ThreadWatchSummary,
  snapshot = watch.snapshot,
  offline = watch.offline,
  includeResult = true,
) {
  return {
    id: targetedChildId(watch),
    runtimeId: watch.runtimeId,
    threadId: watch.threadId,
    name: snapshot?.title ?? 'Child thread',
    status:
      snapshot?.status ??
      snapshot?.phase ??
      (watch.status === 'stopped' ? 'unmonitored' : 'connecting'),
    running:
      !(watch.status === 'stopped' && watch.stopRequested) &&
      !(watch.status === 'completed' && offline) &&
      (offline || !snapshot || snapshot.phase !== 'completed'),
    offline,
    paused: watch.paused,
    stopRequested: watch.stopRequested,
    error: snapshot?.error,
    questions: snapshot?.questions,
    result:
      includeResult && !watch.paused && snapshot?.phase === 'completed'
        ? snapshot.result
        : undefined,
    resultTruncated: snapshot?.resultTruncated,
  }
}
function admit(s: Services, taskId: string) {
  const uncertain = s.mutations.uncertainCount(`subagent-target:${taskId}`)
  const count =
    s.tasks.subagentList(taskId).filter((child) => child.running).length +
    s.threadWatch.list(taskId).filter((watch) => watch.delegated && targetResult(watch).running)
      .length +
    uncertain +
    (launches.get(s)?.get(taskId) ?? 0)
  const maximum = s.preferences.get().maxActiveChildAgents
  if (count >= maximum)
    throw new HttpError(
      409,
      uncertain
        ? 'A previous child launch is unconfirmed. Retry its original key and arguments before launching more work.'
        : `Wait for a child to finish before launching another (maximum ${maximum} active children)`,
    )
}

/** Existing in-checkout children remain ordinary Dovo children. Explicit targets own their scope. */
export async function spawnChild(s: Services, input: SubagentSpawn, supplied?: StudioPolicy) {
  const scope = s.tasks.childLaunchScope(input.taskId, input.parentRunId)
  // This computer's own runtime ID is local; a paired computer is owned by its runtime ID.
  const runtimeId =
    studioComputer(s, input.runtimeId, input.taskId)?.id ?? input.runtimeId ?? 'local'
  const targeted = !!input.repositoryId || runtimeId !== 'local'
  if (!targeted) {
    if (input.execution)
      throw new HttpError(400, 'Set repositoryId to create a child in a separate checkout')
    const retry = s.store
      .get()
      .tasks.some(
        (child) =>
          child.delegation?.parentTaskId === input.taskId &&
          child.delegation.parentRunId === scope.id &&
          child.delegation.key === input.key,
      )
    if (!retry) admit(s, input.taskId)
    return s.tasks.subagentSpawn(input)
  }
  if (input.checkoutId)
    throw new HttpError(400, 'Choose either an inherited checkoutId or a project/computer target')
  const policy = parentPolicy(s, input.taskId, supplied)
  requireStudioPart(s, 'threads', policy)
  const repositoryId = input.repositoryId ?? SCRATCH_PROJECT_ID
  const request = {
    name: input.name,
    prompt: input.prompt,
    // Receipts fingerprint the caller's arguments, so same-key retries keep matching after upgrades.
    runtimeId: input.runtimeId ?? 'local',
    repositoryId,
    provider: input.provider,
    agentId: input.agentId,
    model: input.model,
    reasoning: input.reasoning,
    permission: input.permission,
    approvalPolicy: input.approvalPolicy,
    sandboxMode: input.sandboxMode,
    execution: input.execution,
  }
  const target = decode(
    targetSchema,
    await s.mutations.execute(
      `subagent-target:${input.taskId}`,
      input.key,
      request,
      async () => {
        admit(s, input.taskId)
        if (
          s.threadWatch.list(input.taskId).filter((watch) => watch.status === 'watching').length >=
          40
        )
          throw new HttpError(429, 'At most 40 thread watches per parent')
        let pending = launches.get(s)
        if (!pending) launches.set(s, (pending = new Map()))
        pending.set(input.taskId, (pending.get(input.taskId) ?? 0) + 1)
        try {
          const control = { ...policy, readOnly: false }
          const discovered = decode(
            Schema.Struct({
              agents: Schema.Array(Schema.Struct({ id: Schema.String, provider: Schema.String })),
              capabilities: Schema.optional(Schema.Struct({ targetedSubagents: Schema.Number })),
            }),
            await routedStudioTool(
              s,
              input.taskId,
              'discover',
              { repositoryId: repositoryId === SCRATCH_PROJECT_ID ? undefined : repositoryId },
              runtimeId,
              () => {},
              control,
            ),
          )
          if (discovered.capabilities?.targetedSubagents !== 1)
            throw new HttpError(
              409,
              'Update the target runtime before launching targeted child agents',
            )
          if (input.agentId && !discovered.agents.some((agent) => agent.id === input.agentId))
            throw new HttpError(404, 'Named agent configuration not found in the target project')
          const preset =
            input.agentId && discovered.agents.find((agent) => agent.id === input.agentId)
          if (preset && input.provider && input.provider !== preset.provider)
            throw new HttpError(400, 'The selected configuration uses another harness')
          if (!input.agentId && input.provider === 'acp')
            throw new HttpError(400, 'ACP requires a named configuration on the target computer')
          const harness = input.agentId
            ? undefined
            : decode(taskHarnessSchema, {
                ...defaultTaskHarness(input.provider ?? policy.permissions.provider),
                permission: delegatedAccess(
                  policy.permissions.permission,
                  input.permission ?? policy.permissions.permission,
                ),
                approvalPolicy: input.approvalPolicy ?? policy.permissions.approvalPolicy,
                sandboxMode: input.sandboxMode ?? policy.permissions.sandboxMode,
                ...(input.model !== undefined ? { model: input.model } : {}),
                ...(input.reasoning !== undefined ? { reasoning: input.reasoning } : {}),
              })
          if (harness && !permissionPolicyWithinCeiling(policy.permissions, harness))
            throw new HttpError(403, 'Child permissions cannot exceed their parent')
          scope.signal.throwIfAborted()
          const created = decode(
            Schema.Struct({ id: Schema.String, startError: Schema.optional(Schema.String) }),
            await routedStudioTool(
              s,
              input.taskId,
              'threads',
              {
                action: 'create',
                title: input.name,
                prompt: input.prompt,
                repositoryId,
                agentId: input.agentId,
                harness,
                execution: input.execution,
                coordinationDepth: scope.depth + 1,
                spawnParent: {
                  runtimeId: s.runtimeId,
                  threadId: input.taskId,
                  title: s.store.taskSummary(input.taskId).title.slice(0, 1000),
                },
                agentOverrides: input.agentId
                  ? {
                      model: input.model,
                      reasoning: input.reasoning,
                      permission: delegatedAccess(
                        policy.permissions.permission,
                        input.permission ?? policy.permissions.permission,
                      ),
                      approvalPolicy:
                        input.approvalPolicy ?? policy.permissions.approvalPolicy ?? null,
                      sandboxMode: input.sandboxMode ?? policy.permissions.sandboxMode ?? null,
                    }
                  : undefined,
                start: true,
                watch: false,
                requestId: `child:${createHash('sha256')
                  .update(JSON.stringify([input.taskId, input.key]))
                  .digest('hex')}`,
              },
              runtimeId,
              () => {},
              control,
            ),
          )
          // Keep the reference even if starting fails, or Stop arrives while the request is in flight.
          s.threadWatch.watch(
            input.taskId,
            runtimeId,
            created.id,
            studioComputerName(s, runtimeId),
            policy,
            'spawned',
            true,
          )
          const target = { runtimeId, threadId: created.id }
          if (scope.signal.aborted)
            s.threadWatch.requestChildStop(input.taskId, targetedChildId(target))
          return { ...target, startError: created.startError }
        } finally {
          pending.set(input.taskId, Math.max(0, (pending.get(input.taskId) ?? 1) - 1))
        }
      },
      true,
      true,
    ),
  )
  const watch = ownedTarget(s, input.taskId, targetedChildId(target))
  if (!watch)
    throw new HttpError(
      409,
      `Child ${target.threadId} already exists on ${target.runtimeId}; its monitor was removed. Reconnect it with studio_threads watch instead of spawning again.`,
    )
  return {
    ...targetResult(watch, watch.snapshot, watch.offline, false),
    startError: target.startError,
  }
}

export async function listChildren(
  s: Services,
  input: typeof subagentListSchema.Type,
  policy?: StudioPolicy,
) {
  s.tasks.assertToolScope(input.taskId, input.parentRunId)
  const parent = s.store.taskSummary(input.taskId)
  const runtimeId =
    studioComputer(s, input.runtimeId, input.taskId)?.id ?? input.runtimeId ?? 'local'
  const targeted = !!input.repositoryId || runtimeId !== 'local'
  const discovery = targeted
    ? decode(
        Schema.Record(Schema.String, Schema.Unknown),
        await routedStudioTool(
          s,
          input.taskId,
          'discover',
          { repositoryId: input.repositoryId },
          runtimeId,
          () => {},
          parentPolicy(s, input.taskId, policy),
        ),
      )
    : undefined
  return {
    inbox: (parent.subagentInbox ?? []).map((message) => ({
      id: message.subagentResultId,
      notificationId: message.id,
      createdAt: message.createdAt,
    })),
    agents: [
      ...s.tasks.subagentList(input.taskId),
      ...s.threadWatch
        .list(input.taskId)
        .filter((watch) => watch.delegated)
        .map((watch) => targetResult(watch, watch.snapshot, watch.offline, false)),
    ],
    configurations:
      discovery?.agents ??
      s.store.agentsFor(parent.repositoryId).map(({ id, name, provider, model, permission }) => ({
        id,
        name,
        provider,
        model,
        permission,
      })),
    projects:
      discovery?.projects ?? s.store.get().repositories.map(({ id, name }) => ({ id, name })),
    linkedCheckouts: parent.linkedCheckouts,
    runtimeId,
  }
}

export async function readChild(
  s: Services,
  input: typeof subagentReadSchema.Type,
  policy?: StudioPolicy,
) {
  s.tasks.assertToolScope(input.taskId, input.parentRunId)
  const watch = ownedTarget(s, input.taskId, input.id)
  if (!watch) return s.tasks.subagentResult(input.taskId, input.id, true, input.parentRunId)
  const resolved = parentPolicy(s, input.taskId, policy)
  requireStudioPart(s, 'threads', resolved)
  if (watch.paused)
    throw new HttpError(403, 'This child monitor is paused by the parent permissions')
  if (watch.status === 'stopped' && watch.stopRequested) return targetResult(watch)
  let snapshot: ThreadWatchSnapshot
  try {
    snapshot = decode(
      threadWatchSnapshotSchema,
      await routedStudioTool(
        s,
        input.taskId,
        'threads',
        { action: 'snapshot', id: watch.threadId },
        watch.runtimeId,
        () => s.tasks.assertToolScope(input.taskId, input.parentRunId),
        { ...resolved, readOnly: true },
        undefined,
        true,
      ),
    )
  } catch (error) {
    if (!(error instanceof HttpError)) throw error
    if (error.status < 500 && ![404, 408, 429].includes(error.status)) throw error
    if (watch.snapshot?.phase === 'completed')
      s.threadWatch.acknowledgeChild(
        input.taskId,
        watch.runtimeId,
        watch.threadId,
        watch.snapshot,
        true,
      )
    return {
      ...targetResult(watch, watch.snapshot, true),
      note:
        watch.status === 'completed'
          ? 'Computer unavailable; showing the saved completed result.'
          : 'Computer unavailable; showing last known state. It has not been marked complete.',
    }
  }
  s.threadWatch.acknowledgeChild(input.taskId, watch.runtimeId, watch.threadId, snapshot)
  return targetResult(watch, snapshot, false)
}
export async function waitChild(
  s: Services,
  input: typeof subagentReadSchema.Type,
  policy?: StudioPolicy,
) {
  if (!ownedTarget(s, input.taskId, input.id))
    return s.tasks.subagentWait(input.taskId, input.id, input.timeoutMs, input.parentRunId)
  const deadline = Date.now() + (input.timeoutMs ?? 20000)
  let result = await readChild(s, input, policy)
  while (
    result.running &&
    !('questions' in result && result.questions?.length) &&
    !('offline' in result && result.offline) &&
    Date.now() < deadline
  ) {
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(1000, deadline - Date.now())))
    result = await readChild(s, input, policy)
  }
  return result
}
export async function cancelChild(
  s: Services,
  input: typeof subagentReadSchema.Type,
  policy?: StudioPolicy,
) {
  s.tasks.assertToolScope(input.taskId, input.parentRunId)
  const watch = ownedTarget(s, input.taskId, input.id)
  if (!watch) return s.tasks.subagentCancel(input.taskId, input.id, input.parentRunId)
  const resolved = parentPolicy(s, input.taskId, policy)
  requireStudioPart(s, 'threads', resolved)
  if (watch.paused)
    throw new HttpError(403, 'This child monitor is paused by the parent permissions')
  if (watch.status === 'completed')
    return { ...targetResult(watch), note: 'Child already finished; no cancellation needed.' }
  s.threadWatch.requestChildStop(input.taskId, input.id)
  return {
    ...targetResult(watch),
    stopRequested: true,
    note: 'Stop requested. An offline computer will receive it after reconnecting; cancellation is not yet confirmed.',
  }
}

export async function sendChild(
  s: Services,
  input: typeof subagentSendSchema.Type,
  supplied?: StudioPolicy,
) {
  s.tasks.assertToolScope(input.taskId, input.parentRunId)
  if (!input.prompt.trim()) throw new HttpError(400, 'Add a follow-up prompt')
  const watch = ownedTarget(s, input.taskId, input.id)
  if (!watch) {
    const child = s.tasks.subagentResult(input.taskId, input.id, false, input.parentRunId)
    const messageId = `subagent-send:${createHash('sha256')
      .update(JSON.stringify([input.taskId, input.id, input.key]))
      .digest('hex')}`
    if (!child.running && !s.store.taskSubmission(input.id, messageId)) admit(s, input.taskId)
    return s.tasks.subagentSend(input.taskId, input.id, input.key, input.prompt, input.parentRunId)
  }
  const policy = parentPolicy(s, input.taskId, supplied)
  requireStudioPart(s, 'threads', policy)
  if (watch.paused || watch.stopRequested)
    throw new HttpError(403, 'This child is paused or stopping')
  if (!targetResult(watch).running) admit(s, input.taskId)
  const messageId = `subagent-send:${createHash('sha256')
    .update(JSON.stringify([input.taskId, input.id, input.key]))
    .digest('hex')}`
  await routedStudioTool(
    s,
    input.taskId,
    'threads',
    {
      action: 'send',
      id: watch.threadId,
      text: input.prompt,
      messageId,
    },
    watch.runtimeId,
    () => s.tasks.assertToolScope(input.taskId, input.parentRunId),
    policy,
    undefined,
    true,
  )
  // Clear the prior completion only after the target accepted the follow-up.
  if (watch.snapshot?.phase === 'completed')
    s.threadWatch.acknowledgeChild(input.taskId, watch.runtimeId, watch.threadId, watch.snapshot)
  s.threadWatch.watch(
    input.taskId,
    watch.runtimeId,
    watch.threadId,
    watch.computerName,
    policy,
    watch.relation,
    true,
  )
  return readChild(s, input, supplied)
}

/** Permission approvals and secret fields are deliberately absent from this operation. */
export async function answerChild(
  s: Services,
  input: typeof subagentAnswerSchema.Type,
  supplied?: StudioPolicy,
) {
  s.tasks.assertToolScope(input.taskId, input.parentRunId)
  const watch = ownedTarget(s, input.taskId, input.id)
  if (watch) {
    const policy = parentPolicy(s, input.taskId, supplied)
    if (watch.paused || watch.stopRequested)
      throw new HttpError(403, 'This child is paused or stopping')
    await routedStudioTool(
      s,
      input.taskId,
      'threads',
      {
        action: 'answer-child-question',
        id: watch.threadId,
        questionId: input.questionId,
        answers: input.answers,
      },
      watch.runtimeId,
      () => s.tasks.assertToolScope(input.taskId, input.parentRunId),
      policy,
    )
  } else {
    const child = s.store.taskSummary(input.id)
    if (child.delegation?.parentTaskId !== input.taskId)
      throw new HttpError(403, 'This child belongs to another thread')
    s.questions.answerByParent(child.id, input.questionId, input.answers)
  }
  s.store.updateTask(input.taskId, (parent) => ({
    ...parent,
    subagentInbox: parent.subagentInbox?.filter(
      (message) => message.id !== `subagent-question:${input.questionId}`,
    ),
  }))
  return { ok: true }
}
