import {
  MAX_ATTACHMENTS,
  nextQueuedMessage,
  sameTurnSettings,
  turnSettingsKey,
  applyTurnSettings,
  permissionPolicyIssue,
  planModeIssue,
  supportsAccess,
  resolveTaskAgent,
  turnSettingsMatchHarness,
  type TurnSettings,
  type Attachment,
  type MessageSource,
} from '@dovo/protocol'
import type { WorkspaceStore } from '../../storage/workspace.js'
import type { Activity } from '../../storage/activity.js'
import { HttpError } from '../../errors.js'
import { createHash, randomUUID } from 'node:crypto'
const fingerprint = (
  text: string,
  attachments: Attachment[],
  turnSettings?: TurnSettings,
  plan?: boolean,
) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        text,
        ...(plan ? { plan: true } : {}),
        ...(turnSettings
          ? {
              turnSettings: {
                provider: turnSettings.provider,
                acpInstallationId: turnSettings.acpInstallationId,
                model: turnSettings.model,
                reasoning: turnSettings.reasoning,
                ...(turnSettings.harness
                  ? {
                      harness: turnSettingsKey(turnSettings),
                    }
                  : {}),
              },
            }
          : {}),
        attachments: attachments.map(({ id, name, mime, size }) => ({ id, name, mime, size })),
      }),
    )
    .digest('hex')
export class TaskQueue {
  constructor(
    private store: WorkspaceStore,
    private activity?: Pick<Activity, 'add'>,
  ) {}
  private validateSettings(id: string, settings?: TurnSettings | null) {
    if (!settings) return
    const agent = resolveTaskAgent(this.store.taskSummary(id), this.store.get().agents)
    if (!agent || !turnSettingsMatchHarness(settings, agent))
      throw new HttpError(409, 'Choose settings within this thread’s current harness')
    if (settings.harness) {
      const selected = applyTurnSettings(agent, settings)
      const issue = permissionPolicyIssue(selected)
      if (issue) throw new HttpError(400, issue)
      if (!supportsAccess(selected.provider, selected.permission))
        throw new HttpError(400, 'This access mode is unavailable for this harness.')
    }
  }
  private validatePlan(id: string, settings?: TurnSettings | null, review = false) {
    if (review) throw new HttpError(400, 'Request a review without plan mode')
    const agent = resolveTaskAgent(this.store.taskSummary(id), this.store.get().agents)
    const issue = planModeIssue(agent && applyTurnSettings(agent, settings ?? undefined))
    if (issue) throw new HttpError(400, issue)
  }
  accepted(
    id: string,
    messageId: string,
    text: string,
    attachments: Attachment[] = [],
    turnSettings?: TurnSettings,
    plan = false,
  ) {
    const task = this.store.task(id)
    const receipt = this.store.taskSubmission(id, messageId)
    if (receipt) {
      if (receipt !== fingerprint(text, attachments, turnSettings, plan))
        throw new HttpError(
          409,
          'This message id already has different text or attachments or model settings',
        )
      return true
    }
    const existing = [...task.messages, ...(task.queue ?? [])].find((m) => m.id === messageId)
    if (existing) {
      if (
        fingerprint(
          existing.text,
          existing.attachments ?? [],
          existing.turnSettings,
          existing.plan,
        ) !== fingerprint(text, attachments, turnSettings, plan)
      )
        throw new HttpError(409, 'This message id already has different text')
      return true
    }
    return false
  }
  add(
    id: string,
    messageId: string,
    text: string,
    attachments: Attachment[] = [],
    response?: { id: string; fingerprint: string; attachments?: Attachment[] },
    review = false,
    resumePaused = false,
    subagentResultId?: string,
    options: {
      turnSettings?: TurnSettings
      queueOnly?: boolean
      steering?: boolean
      reopenSettled?: boolean
      unsnooze?: boolean
      clearCompletedTodos?: boolean
      source?: MessageSource
      /** One read-only planning turn; it cannot steer a run with broader access. */
      plan?: boolean
    } = {},
  ) {
    if (this.accepted(id, messageId, text, attachments, options.turnSettings, options.plan))
      return false
    this.validateSettings(id, options.turnSettings)
    if (options.plan) {
      if (options.steering)
        throw new HttpError(409, 'Queue this message to plan before the agent changes anything')
      this.validatePlan(id, options.turnSettings, review)
    }
    const task = this.store.taskSummary(id)
    if (task.archivedAt || (task.archived && !task.autoSettled && !options.reopenSettled))
      throw new HttpError(409, 'Restore this task before sending a message')
    if ((task.queue?.length ?? 0) >= 50)
      throw new HttpError(409, 'Queue is full (50 messages). Remove a message or let it run.')
    // Runtime-origin input can coincide with an unsent human draft. Only a user submission
    // consumes composer state; form answers, review actions and child input leave it intact.
    const consumesDraft =
      (!options.source || options.source.kind === 'user') &&
      !response &&
      !review &&
      !subagentResultId
    const createdAt = new Date().toISOString()
    this.store.updateTask(
      id,
      (t) => ({
        ...t,
        ...(options.clearCompletedTodos &&
        t.nativeTodos?.length &&
        t.nativeTodos.every((todo) => todo.status === 'completed')
          ? { nativeTodos: undefined }
          : {}),
        checkoutLocked: true,
        ...(options.unsnooze ? { snoozedUntil: null } : {}),
        ...(t.archived && options.reopenSettled
          ? { archived: false, autoSettled: undefined, snoozedUntil: null }
          : {}),
        ...(!response && !review && !subagentResultId && text.trim() !== '/compact'
          ? { lastPromptAt: createdAt }
          : {}),
        ...(consumesDraft
          ? {
              draft: t.draft.trim() === text.trim() ? '' : t.draft,
              draftTurnSettings:
                (!t.draft.trim() || t.draft.trim() === text.trim()) &&
                sameTurnSettings(t.draftTurnSettings, options.turnSettings)
                  ? null
                  : t.draftTurnSettings,
              // Only a sent plan consumes the toggle; normal sends leave it for the next draft.
              draftPlan:
                options.plan && (!t.draft.trim() || t.draft.trim() === text.trim())
                  ? undefined
                  : t.draftPlan,
              draftAttachments: t.draftAttachments?.filter(
                (f) => !attachments.some((a) => a.id === f.id),
              ),
            }
          : {}),
        ...(options.queueOnly
          ? { queuePaused: true }
          : resumePaused
            ? { queuePaused: false, restartRecovery: undefined }
            : {}),
        queue: [
          ...(t.queue ?? []),
          {
            id: messageId,
            role: 'user',
            source: options.source ?? { kind: 'user' },
            ...(options.turnSettings ? { turnSettings: options.turnSettings } : {}),
            text,
            ...(attachments.length ? { attachments } : {}),
            ...(review ? { review: true } : {}),
            ...(options.plan ? { plan: true } : {}),
            ...(subagentResultId ? { subagentResultId } : {}),
            createdAt,
            ...(options.steering ? { steering: true } : {}),
          },
        ],
      }),
      {
        id: messageId,
        fingerprint: fingerprint(text, attachments, options.turnSettings, options.plan),
        response,
      },
    )
    this.activity?.add(
      'message',
      id,
      'Follow-up queued',
      {
        id: messageId,
        text,
        attachments,
        ...(options.turnSettings ? { turnSettings: options.turnSettings } : {}),
      },
      `queued:${id}:${messageId}`,
    )
    return true
  }
  /** Child output is internal input, never an editable user prompt or draft mutation. */
  addSubagentResult(id: string, messageId: string, text: string, childId: string) {
    const task = this.store.taskSummary(id)
    const saved = task.subagentInbox?.find((message) => message.id === messageId)
    if (saved) {
      if (saved.text !== text || saved.subagentResultId !== childId)
        throw new HttpError(409, 'This subagent notification id is already in use')
      return false
    }
    const receipt = fingerprint(`${childId}\n${text}`, [])
    const accepted = this.store.taskSubmission(id, messageId)
    if (accepted) {
      if (accepted !== receipt)
        throw new HttpError(409, 'This subagent notification id is already in use')
      return false
    }
    if ((task.subagentInbox?.length ?? 0) >= 100)
      throw new HttpError(409, 'Subagent inbox is full; read results before collecting more')
    this.store.updateTask(
      id,
      (current) => ({
        ...current,
        subagentInbox: [
          ...(current.subagentInbox ?? []),
          {
            id: messageId,
            role: 'user',
            text,
            subagentResultId: childId,
            createdAt: new Date().toISOString(),
          },
        ],
      }),
      { id: messageId, fingerprint: receipt },
    )
    return true
  }
  duplicate(id: string, messageId: string, duplicateMessageId: string) {
    const task = this.store.taskSummary(id)
    const receipt = createHash('sha256')
      .update(JSON.stringify({ action: 'duplicate', messageId }))
      .digest('hex')
    const accepted = this.store.taskSubmission(id, duplicateMessageId)
    if (accepted) {
      if (accepted !== receipt)
        throw new HttpError(409, 'This message id is already in use', { mutationRejected: true })
      return
    }
    if (task.archived || task.archivedAt)
      throw new HttpError(409, 'Restore this task before changing its queue', {
        mutationRejected: true,
      })
    if (
      [...this.store.task(id).messages, ...(task.queue ?? [])].some(
        (item) => item.id === duplicateMessageId,
      )
    )
      throw new HttpError(409, 'This message id is already in use', { mutationRejected: true })
    const index = task.queue?.findIndex((item) => item.id === messageId) ?? -1
    const message = task.queue?.[index]
    if (!message)
      throw new HttpError(409, 'This message already started or was removed', {
        mutationRejected: true,
      })
    if (message.steering)
      throw new HttpError(409, 'This message is being delivered to the agent', {
        mutationRejected: true,
      })
    if ((task.queue?.length ?? 0) >= 50)
      throw new HttpError(409, 'Queue is full (50 messages). Remove a message or let it run.', {
        mutationRejected: true,
      })
    try {
      this.validateSettings(id, message.turnSettings)
      if (message.plan) this.validatePlan(id, message.turnSettings, message.review)
    } catch (error) {
      if (error instanceof HttpError)
        throw new HttpError(error.status, error.message, { mutationRejected: true })
      throw error
    }
    const createdAt = new Date().toISOString()
    this.store.updateTask(
      id,
      (current) => ({
        ...current,
        checkoutLocked: true,
        ...(!message.review ? { lastPromptAt: createdAt } : {}),
        queue: [
          ...(current.queue ?? []).slice(0, index + 1),
          {
            id: duplicateMessageId,
            role: 'user',
            source: { kind: 'user' },
            text: message.text,
            ...(message.review ? { review: true } : {}),
            attachments: message.attachments,
            turnSettings: message.turnSettings,
            ...(message.plan ? { plan: true } : {}),
            paused: message.paused,
            createdAt,
          },
          ...(current.queue ?? []).slice(index + 1),
        ],
      }),
      { id: duplicateMessageId, fingerprint: receipt },
    )
    this.activity?.add('queue', id, 'Queued message duplicated', { messageId, duplicateMessageId })
  }
  edit(
    id: string,
    messageId: string,
    text: string,
    expectedText: string,
    turnSettings?: TurnSettings | null,
    expectedTurnSettings?: TurnSettings | null,
    attachments?: Attachment[],
    expectedAttachmentIds?: string[],
    plan?: boolean,
    expectedPlan?: boolean,
  ) {
    const task = this.store.taskSummary(id)
    const message = task.queue?.find((item) => item.id === messageId)
    if (!message)
      throw new HttpError(409, 'This message already started or was removed', {
        mutationRejected: true,
      })
    if (message.steering) throw new HttpError(409, 'This message is being delivered to the agent')
    if (
      message.text !== expectedText ||
      (turnSettings !== undefined &&
        (expectedTurnSettings === undefined ||
          !sameTurnSettings(message.turnSettings, expectedTurnSettings)))
    )
      throw new HttpError(409, 'This queued message changed. Reopen it before editing.')
    if (plan !== undefined && (expectedPlan === undefined || !!message.plan !== expectedPlan))
      throw new HttpError(409, 'This queued message changed. Reopen it before editing.')
    if (
      attachments &&
      (!expectedAttachmentIds ||
        JSON.stringify(message.attachments?.map((file) => file.id) ?? []) !==
          JSON.stringify(expectedAttachmentIds))
    )
      throw new HttpError(409, 'This queued message changed. Reopen it before editing.')
    if (attachments && attachments.length > MAX_ATTACHMENTS)
      throw new HttpError(400, 'Attach up to 5 files per message')
    if (!text.trim() && !(attachments ?? message.attachments)?.length)
      throw new HttpError(400, 'A message needs text or attachments')
    this.validateSettings(id, turnSettings)
    if (plan ?? message.plan)
      this.validatePlan(
        id,
        turnSettings === undefined ? message.turnSettings : turnSettings,
        message.review,
      )
    this.store.updateTask(id, (current) => ({
      ...current,
      queue: current.queue?.map((item) =>
        item.id === messageId
          ? {
              ...item,
              text,
              source: { kind: 'user' },
              ...(turnSettings !== undefined ? { turnSettings: turnSettings ?? undefined } : {}),
              ...(attachments ? { attachments } : {}),
              ...(plan !== undefined ? { plan: plan || undefined } : {}),
            }
          : item,
      ),
    }))
    this.activity?.add('queue', id, 'Queued message edited', { messageId })
  }
  take(id: string, runId: string = randomUUID(), attemptId?: string) {
    this.store.updateTaskHistory(
      id,
      (t) => {
        const message = nextQueuedMessage(t)
        const pendingSubagentInputs = [
          ...new Map(
            [
              ...(!t.runAttempt?.promptAccepted ? (t.runAttempt?.subagentInputs ?? []) : []),
              ...(t.subagentInbox ?? []),
            ].map((input) => [input.id, input]),
          ).values(),
        ]
        // Compaction accepts no normal prompt; keep results for the following agent turn.
        const subagentInputs = message?.text.trim() === '/compact' ? [] : pendingSubagentInputs
        if (t.queue?.length && !message && !subagentInputs.length)
          throw new HttpError(409, 'Resume the first queued message to continue')
        const queue = t.queue?.filter((item) => item.id !== message?.id) ?? []
        const settings = message?.turnSettings
        const agent = settings && resolveTaskAgent(t, this.store.get().agents)
        const selected =
          settings && agent && turnSettingsMatchHarness(settings, agent)
            ? applyTurnSettings(agent, settings)
            : undefined
        return {
          ...t,
          // Adopt model choices at the queue boundary: earlier turns keep their model,
          // later turns inherit it, and removal/reordering never changes defaults early.
          // Permissions and other full-harness overrides remain scoped to this message.
          ...(selected
            ? {
                agentOverrides: {
                  ...t.agentOverrides,
                  model: selected.model,
                  reasoning: selected.reasoning ?? '',
                  serviceTier: selected.serviceTier ?? null,
                  cyberAccessProgram: selected.cyberAccessProgram ?? null,
                },
                harnessCustomized: true,
                modelSelection: undefined,
              }
            : {}),
          subagentInbox: subagentInputs.length ? [] : pendingSubagentInputs,
          status: 'running',
          runPhase: 'preparing',
          ...(attemptId ? { activeRunId: attemptId } : {}),
          runAttempt: {
            runId,
            inputMessageIds: message ? [message.id] : [],
            ...(subagentInputs.length ? { subagentInputs } : {}),
            promptAccepted: false,
            ...(message?.turnSettings ? { turnSettings: message.turnSettings } : {}),
          },
          ...(message ? { queue, messages: [...t.messages, message] } : {}),
        }
      },
      undefined,
      attemptId
        ? { id: `start:${attemptId}`, taskId: id, attemptId, kind: 'start', state: 'pending' }
        : undefined,
    )
  }
  setPaused(id: string, messageId: string, paused: boolean) {
    const task = this.store.taskSummary(id)
    if (task.archived || task.archivedAt)
      throw new HttpError(400, 'Restore this task before changing its queue')
    const message = task.queue?.find((item) => item.id === messageId)
    if (!message)
      throw new HttpError(409, 'This message already started or was removed', {
        mutationRejected: true,
      })
    if (message.steering) throw new HttpError(409, 'This message is being delivered to the agent')
    if (!!message.paused === paused) return
    this.store.updateTask(id, (task) => ({
      ...task,
      queue: task.queue?.map((item) =>
        item.id === messageId ? { ...item, paused: paused || undefined } : item,
      ),
    }))
    this.activity?.add('queue', id, paused ? 'Queued message paused' : 'Queued message resumed', {
      messageId,
    })
  }
  move(
    id: string,
    messageId: string,
    beforeMessageId: string | null,
    expectedMessageIds?: string[],
  ) {
    const task = this.store.taskSummary(id)
    if (task.archived || task.archivedAt)
      throw new HttpError(409, 'Restore this task before changing its queue', {
        mutationRejected: true,
      })
    const queue = [...(task.queue ?? [])]
    if (
      expectedMessageIds &&
      (expectedMessageIds.length !== queue.length ||
        queue.some((message, index) => message.id !== expectedMessageIds[index]))
    )
      throw new HttpError(
        409,
        'The queue changed. Check its order before moving this message again.',
        { mutationRejected: true },
      )
    if (queue.some((message) => message.steering))
      throw new HttpError(409, 'Wait until the current message is delivered before reordering', {
        mutationRejected: true,
      })
    const index = queue.findIndex((message) => message.id === messageId)
    if (index < 0)
      throw new HttpError(409, 'This message already started or was removed', {
        mutationRejected: true,
      })
    if (beforeMessageId !== null && !queue.some((message) => message.id === beforeMessageId))
      throw new HttpError(409, 'The queue changed while dragging. Try again.', {
        mutationRejected: true,
      })
    if (messageId === beforeMessageId) return
    const [message] = queue.splice(index, 1)
    const target =
      beforeMessageId === null
        ? queue.length
        : queue.findIndex((item) => item.id === beforeMessageId)
    if (target === index) return
    queue.splice(target, 0, message)
    this.store.updateTask(id, (task) => ({ ...task, queue, checkoutLocked: true }))
    this.activity?.add('queue', id, 'Queue reordered', { messageId, beforeMessageId })
  }
  restore(
    id: string,
    input: {
      requestId: string
      messageId: string
      expectedText: string
      expectedTurnSettings: TurnSettings | null
      expectedDraftTurnSettings: TurnSettings | null
      expectedAttachmentIds: string[]
    },
  ) {
    const receipt = createHash('sha256').update(JSON.stringify(input)).digest('hex')
    return this.store.restoreQueue(id, input.requestId, receipt, () => {
      const task = this.store.taskSummary(id)
      if (!sameTurnSettings(task.draftTurnSettings, input.expectedDraftTurnSettings))
        throw new HttpError(
          409,
          'The draft model settings changed. Check the composer before restoring',
        )
      const message = task.queue?.find((item) => item.id === input.messageId)
      if (!message)
        throw new HttpError(409, 'This message already started or was removed', {
          mutationRejected: true,
        })
      if (
        message.text !== input.expectedText ||
        !sameTurnSettings(message.turnSettings, input.expectedTurnSettings) ||
        JSON.stringify(message.attachments?.map((file) => file.id) ?? []) !==
          JSON.stringify(input.expectedAttachmentIds)
      )
        throw new HttpError(409, 'The queued message changed. Refresh it before restoring')
      this.change(id, 'restore', input.messageId)
    })
  }
  change(
    id: string,
    action: 'remove' | 'restore' | 'up' | 'down' | 'pause',
    messageId?: string,
    expectedMessageIds?: string[],
  ) {
    const task = this.store.taskSummary(id)
    if (action === 'pause') {
      this.store.updateTask(id, (t) => ({
        ...t,
        queuePaused: true,
        restartRecovery: t.restartRecovery ? { ...t.restartRecovery, automatic: false } : undefined,
      }))
      return
    }
    if (action === 'up' || action === 'down') {
      const queue = task.queue ?? []
      const index = queue.findIndex((message) => message.id === messageId)
      if (index < 0) throw new HttpError(409, 'This message already started or was removed')
      const before =
        action === 'up'
          ? (queue[Math.max(0, index - 1)]?.id ?? null)
          : (queue[index + 2]?.id ?? null)
      this.move(id, queue[index].id, before, expectedMessageIds)
      return
    }
    const queue = [...(task.queue ?? [])],
      index = queue.findIndex((m) => m.id === messageId)
    if (index < 0)
      throw new HttpError(409, 'This message already started or was removed', {
        mutationRejected: true,
      })
    if ((action === 'remove' || action === 'restore') && queue[index].steering)
      throw new HttpError(409, 'This message is being delivered to the agent')
    if (action === 'restore') {
      if (
        (task.draft.trim() || task.draftAttachments?.length) &&
        !sameTurnSettings(queue[index].turnSettings, task.draftTurnSettings)
      )
        throw new HttpError(
          409,
          'Clear the composer before restoring a message with different model settings',
        )
      if (
        (task.draft.trim() || task.draftAttachments?.length) &&
        !!queue[index].plan !== !!task.draftPlan
      )
        throw new HttpError(
          409,
          'Clear the composer before restoring a message with a different plan mode',
        )
      const ids = new Set(
        [...(task.draftAttachments ?? []), ...(queue[index].attachments ?? [])].map(
          (file) => file.id,
        ),
      )
      if (ids.size > MAX_ATTACHMENTS)
        throw new HttpError(
          409,
          'Restoring this message would exceed the five-file draft limit. Remove draft attachments first; the queued message is unchanged.',
        )
    }
    const removed = action === 'remove' || action === 'restore' ? queue[index] : undefined
    if (removed) queue.splice(index, 1)
    this.store.updateTask(
      id,
      (t) => ({
        ...t,
        queue,
        ...(action === 'restore' && removed
          ? {
              draft: [t.draft, removed.text].filter(Boolean).join('\n\n'),
              draftTurnSettings: removed.turnSettings ?? null,
              draftPlan: removed.plan || undefined,
              draftAttachments: [
                ...(t.draftAttachments ?? []),
                ...(removed.attachments ?? []).filter(
                  (file) => !t.draftAttachments?.some((draft) => draft.id === file.id),
                ),
              ],
            }
          : {}),
        checkoutLocked: true,
        restartRecovery:
          !queue.length && t.restartRecovery?.kind === 'queue' ? undefined : t.restartRecovery,
      }),
      removed && !this.store.taskSubmission(id, removed.id)
        ? {
            id: removed.id,
            fingerprint: fingerprint(
              removed.text,
              removed.attachments ?? [],
              removed.turnSettings,
              removed.plan,
            ),
          }
        : undefined,
    )
    this.activity?.add('queue', id, `Queued message ${action}`, { messageId })
  }
}
