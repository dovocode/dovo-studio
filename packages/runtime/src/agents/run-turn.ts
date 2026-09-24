import { Cause, Effect } from 'effect'
import { OwnedProcessShutdownError } from './stop-owned-child.js'
import { updateSubagents } from './subagents.js'
import { ReasoningEvents, safeReasoningEvent } from './reasoning-event.js'
import type { AgentSteer, AgentRun } from './types.js'
import {
  supportsAccess,
  resolveTaskAgent,
  lockedTaskProvider,
  mergeResources,
} from '@dovo/protocol'
import { hostname } from 'node:os'
import type { Attachments } from '../storage/attachments.js'
import { toolEvent } from './tool-event.js'
import type { Questions } from './questions.js'
import { createHash, randomUUID } from 'node:crypto'
import type { Activity } from '../storage/activity.js'
import type { Commands } from '../storage/commands.js'
import type { WorkspaceStore } from '../storage/workspace.js'
import type { GitService } from '../scm/git.js'
import type { AgentRegistry } from './registry.js'
import type { Approvals } from './approvals.js'
import {
  HttpError,
  RuntimeOperationError,
  errorMessage,
  runtimeFailure,
  runtimeOperation,
} from '../errors.js'
export class FinalizationFailure extends Error {}

export class TaskTurnRunner {
  constructor(
    private store: WorkspaceStore,
    private git: GitService,
    private registry: AgentRegistry,
    private approvals: Approvals,
    private commands: Commands,
    private questions: Questions,
    private attachments: Attachments,
    private activity?: Pick<Activity, 'add'>,
  ) {}
  /** Retry only change capture for an already terminal provider turn. */
  finalizeEffect(id: string, cwd: string) {
    return Effect.gen(this, function* () {
      const turn = this.store.task(id).turns?.at(-1)
      if (!turn || turn.status === 'running' || !turn.finishedAt || !turn.checkpoint)
        throw new HttpError(409, 'No completed provider turn is awaiting change capture')
      const before = turn.checkpoint.before
      const after =
        turn.checkpoint.after ??
        (yield* runtimeOperation(() =>
          this.git.snapshot(cwd, `refs/dovo/checkpoints/${turn.id}/after`),
        ))
      const changes = yield* runtimeOperation(() => this.git.checkpointChanges(cwd, before, after))
      const files = yield* runtimeOperation(() => this.git.changes(cwd))
      this.store.updateTask(id, (task) => ({
        ...task,
        status: turn.status === 'completed' ? 'review' : turn.status,
        runPhase: undefined,
        runAttempt: undefined,
        restartRecovery: undefined,
        activity: undefined,
        error: turn.error,
        files,
        turns: task.turns?.map((current) =>
          current.id === turn.id
            ? { ...current, checkpoint: { before, after, ...changes } }
            : current,
        ),
      }))
    })
  }
  runEffect(
    id: string,
    cwd: string,
    controller: AbortController,
    onSteer?: (steer: ((messageId: string) => Promise<void>) | undefined) => void,
    onQuestions?: AgentRun['onQuestions'],
    continuingAfterRestart = false,
  ) {
    return Effect.scoped(
      Effect.gen(this, function* () {
        const task = this.store.task(id)
        const configured = resolveTaskAgent(task, this.store.get().agents)
        if (!configured) throw new HttpError(400, 'Choose a harness or agent first')
        const providerLock = lockedTaskProvider(task, this.store.get().agents)
        if (providerLock && configured.provider !== providerLock)
          throw new HttpError(
            409,
            `This task uses ${providerLock}. Select a model or custom agent within that provider before continuing.`,
          )
        const resources = mergeResources(
          this.store.get().repositories.find((repository) => repository.id === task.repositoryId)
            ?.resources,
          configured.resources,
        )
        const skills = resources.skills.filter((skill) => skill.enabled)
        const instructions = skills.length
          ? `${configured.instructions}

Enabled skills for this task (apply when relevant):
${skills
  .map(
    (skill) => `## ${skill.name}
${skill.description}
${
  skill.sourcePath
    ? `Skill source (resolve supporting files from its containing folder): ${skill.sourcePath}
`
    : ''
}${skill.content}`,
  )
  .join('\n\n')}`
          : configured.instructions
        const agent = this.registry.configure({ ...configured, resources, instructions })
        if (!supportsAccess(agent.provider, agent.permission))
          throw new HttpError(
            400,
            `${agent.provider} does not support access mode ${agent.permission}`,
          )
        const commands = this.commands.get()
        const { branch } = yield* runtimeOperation(() => this.git.inspect(cwd))
        let assistantId = randomUUID()
        const turnId = randomUUID(),
          fingerprint = createHash('sha256')
            .update(
              JSON.stringify({
                agent,
                cwd,
                commands,
                branch,
                acpLaunch: this.registry.launch(agent),
              }),
            )
            .digest('hex')
        const sessionId = task.sessionAgentId === fingerprint ? task.sessionId : undefined
        const currentMessages = this.store.task(id).messages
        const lastAssistant = currentMessages
          .map((message) => message.role)
          .lastIndexOf('assistant')
        const consumedMessageIds = sessionId
          ? (task.consumedMessageIds ??
            currentMessages.slice(0, lastAssistant + 1).map((message) => message.id))
          : []
        const messages = sessionId
          ? currentMessages.filter((message) => !consumedMessageIds.includes(message.id))
          : currentMessages
        const context = messages.map((m) => `${m.role}: ${m.text}`).join('\n\n')
        const prompt = continuingAfterRestart
          ? [
              'The runtime restarted during this task. Review the existing conversation and current files, then continue only the unfinished work. Do not repeat completed actions. If the original request is missing from the session, ask for clarification.',
              context,
            ]
              .filter(Boolean)
              .join('\n\n')
          : context || 'Continue the task and report the result.'
        const before = yield* runtimeOperation(() =>
          this.git.snapshot(cwd, `refs/dovo/checkpoints/${turnId}/before`),
        )
        controller.signal.throwIfAborted()
        this.store.updateTask(id, (t) => ({
          ...t,
          status: 'running',
          runPhase: 'provider',
          runAttempt: { inputMessageIds: currentMessages.map((m) => m.id), promptAccepted: false },
          checkoutBranch: branch,
          error: undefined,
          consumedMessageIds,
          turns: [
            ...(t.turns ?? []),
            {
              runtimeHost: hostname(),
              id: turnId,
              assistantId,
              checkpoint: { before, files: [], omitted: [] },
              agentId: agent.id,
              provider: agent.provider,
              branch,
              model: agent.model,
              reasoning: agent.reasoning,
              startedAt: new Date().toISOString(),
              status: 'running',
            },
          ],
          messages: [
            ...t.messages,
            { id: assistantId, role: 'assistant', text: '', createdAt: new Date().toISOString() },
          ],
        }))
        const checkpoint = () => {
          let after: string | undefined
          return Effect.gen(this, function* () {
            const capturedAfter = yield* runtimeOperation(() =>
              this.git.snapshot(cwd, `refs/dovo/checkpoints/${turnId}/after`),
            )
            after = capturedAfter
            return {
              before,
              after,
              error: undefined,
              ...(yield* runtimeOperation(() =>
                this.git.checkpointChanges(cwd, before, capturedAfter),
              )),
            }
          }).pipe(
            Effect.catchAll((error) =>
              Effect.succeed({
                before,
                after,
                files: [],
                omitted: [],
                error: `Could not capture turn changes: ${errorMessage(error)}`,
              }),
            ),
          )
        }
        const reasoning = new ReasoningEvents(agent.provider, (row) => {
          this.activity?.add(
            'reasoning',
            id,
            'Reasoning',
            { turnId, ...row },
            `reasoning:${id}:${turnId}:${row.toolId}`,
          )
        })
        const acceptedIds = new Set<string>()
        let providerFinishedAt: string | undefined
        let providerOpen = true
        let promptAccepted = false
        const acceptPrompt = () => {
          if (!acceptsProviderEvents() || promptAccepted) return
          this.store.updateTask(id, (t) => ({
            ...t,
            runAttempt: { inputMessageIds: currentMessages.map((m) => m.id), promptAccepted: true },
            consumedMessageIds: [
              ...new Set([
                ...(t.consumedMessageIds ?? []),
                ...currentMessages.map((m) => m.id),
                assistantId,
              ]),
            ],
          }))
          promptAccepted = true
        }
        const acceptsProviderEvents = () => providerOpen && !controller.signal.aborted
        let steering: Promise<void> | undefined
        let flushError: unknown
        let buffer = '',
          timer: ReturnType<typeof setTimeout> | undefined
        const flush = () => {
          if (timer) clearTimeout(timer)
          timer = undefined
          if (!buffer) return
          const text = buffer
          this.store.updateTask(id, (t) => ({
            ...t,
            messages: t.messages.map((m) =>
              m.id === assistantId ? { ...m, text: m.text + text } : m,
            ),
          }))
          buffer = ''
        }
        yield* Effect.forkScoped(
          Effect.sleep(2 * 60 * 60 * 1000).pipe(
            Effect.zipRight(
              Effect.sync(() =>
                controller.abort(new Error('Task exceeded the two-hour runtime limit')),
              ),
            ),
            Effect.interruptible,
          ),
        )
        yield* Effect.gen(this, function* () {
          const questionController = new AbortController()
          const questionSignal = AbortSignal.any([controller.signal, questionController.signal])
          this.activity?.add('agent', id, `${agent.provider} turn started`, {
            agentId: agent.id,
            model: agent.model,
            cwd,
            sessionId,
            prompt,
            instructions: agent.instructions,
            permission: agent.permission,
          })
          const attachments = yield* Effect.forEach(
            messages.flatMap((message) => message.attachments ?? []),
            (file) => runtimeOperation(() => this.attachments.materialize(id, file)),
            { concurrency: 'unbounded' },
          )
          const attachmentContext = attachmentPrompt(attachments)
          const adapter = yield* runtimeOperation(() => this.registry.get(agent.provider))
          controller.signal.throwIfAborted()
          yield* runtimeOperation(() =>
            adapter.run({
              agent: {
                ...agent,
                instructions: [
                  agent.instructions,
                  `Project working directory: ${JSON.stringify(cwd)}. Run project commands, including git and gh, from this checkout. Configured Git executable: ${JSON.stringify(commands.git)}; GitHub CLI executable: ${JSON.stringify(commands.gh)}. Use gh for GitHub operations in the repository linked to this checkout; do not target another repository unless the user explicitly requests it.`,
                ]
                  .filter(Boolean)
                  .join('\n\n'),
              },
              cwd,
              prompt: [prompt, attachmentContext].filter(Boolean).join('\n\n'),
              attachments,
              sessionId,
              signal: controller.signal,
              onPromptAccepted: acceptPrompt,
              onQuestions: (prompt) => {
                acceptPrompt()
                if (acceptsProviderEvents()) onQuestions?.(prompt)
              },
              onSteer: (steer) => {
                if (!acceptsProviderEvents()) return
                if (!steer) {
                  onSteer?.(undefined)
                  return
                }
                const apply = async (messageId: string, send: AgentSteer) => {
                  const message = this.store.task(id).queue?.find((m) => m.id === messageId)
                  if (!message)
                    throw new HttpError(409, 'This message already started or was removed')
                  const files = await Promise.all(
                    (message.attachments ?? []).map((file) =>
                      this.attachments.materialize(id, file),
                    ),
                  )
                  controller.signal.throwIfAborted()
                  await send({
                    id: messageId,
                    prompt: [message.text, attachmentPrompt(files)].filter(Boolean).join('\n\n'),
                    attachments: files,
                  })
                  flush()
                  acceptedIds.add(messageId)
                  acceptedIds.add(assistantId)
                  const nextAssistantId = randomUUID()
                  acceptedIds.add(nextAssistantId)
                  this.store.updateTask(id, (t) => ({
                    ...t,
                    queue: t.queue?.filter((m) => m.id !== messageId),
                    messages: [
                      ...t.messages,
                      message,
                      {
                        id: nextAssistantId,
                        role: 'assistant',
                        text: '',
                        createdAt: new Date().toISOString(),
                      },
                    ],
                    consumedMessageIds: [
                      ...new Set([...(t.consumedMessageIds ?? []), ...acceptedIds]),
                    ],
                    turns: t.turns?.map((turn) =>
                      turn.id === turnId ? { ...turn, assistantId: nextAssistantId } : turn,
                    ),
                  }))
                  assistantId = nextAssistantId
                }
                onSteer?.((messageId) => {
                  steering = apply(messageId, steer)
                  return steering
                })
              },
              onSession: (sessionId) => {
                if (!acceptsProviderEvents()) return
                if (
                  this.store.task(id).sessionId !== sessionId ||
                  this.store.task(id).sessionAgentId !== fingerprint
                )
                  this.store.updateTask(id, (t) => ({
                    ...t,
                    sessionId,
                    sessionAgentId: fingerprint,
                  }))
              },
              onText: (text) => {
                if (!acceptsProviderEvents()) return
                acceptPrompt()
                buffer += text
                if (!timer)
                  timer = setTimeout(() => {
                    try {
                      flush()
                    } catch (error) {
                      flushError = error
                      controller.abort(error)
                    }
                  }, 100)
              },
              onEvent: (name, payload) => {
                if (!acceptsProviderEvents()) return
                const current = this.store.task(id).subagents ?? []
                const subagents = updateSubagents(
                  current,
                  agent.provider,
                  payload,
                  new Date().toISOString(),
                  name,
                )
                if (subagents !== current)
                  this.store.updateTask(id, (task) => ({ ...task, subagents }))
                const reasoningOnly = reasoning.accept(name, payload)
                const tool = toolEvent(agent.provider, name, payload)
                if (reasoningOnly && !tool) return
                this.activity?.add(
                  tool ? 'tool' : 'agent-event',
                  id,
                  tool?.title || `${agent.provider} · ${name}`,
                  { turnId, ...tool, event: safeReasoningEvent(payload) },
                )
              },
              onActivity: (text) => {
                if (!acceptsProviderEvents()) return
                this.activity?.add('agent', id, `${agent.provider} activity`, { text })
                this.store.updateTask(id, (t) => ({ ...t, activity: text }))
              },
              approve: (title, detail) =>
                acceptsProviderEvents()
                  ? this.approvals.request(id, title, detail, questionSignal)
                  : Promise.resolve(false),
              ask: (prompt, signal, validate) =>
                acceptsProviderEvents()
                  ? this.questions.request(
                      id,
                      prompt,
                      signal ? AbortSignal.any([questionSignal, signal]) : questionSignal,
                      validate,
                    )
                  : Promise.resolve(null),
            }),
          ).pipe(
            Effect.ensuring(
              Effect.gen(function* () {
                providerOpen = false
                onSteer?.(undefined)
                // The provider may finish before its final steering acknowledgement.
                if (steering) yield* Effect.exit(runtimeOperation(() => steering))
                questionController.abort()
              }),
            ),
          )
          if (flushError) throw flushError
          if (controller.signal.aborted) throw new Error('Task cancelled')
          const finishedAt = new Date().toISOString()
          providerFinishedAt = finishedAt
          flush()
          this.store.updateTask(id, (t) => ({
            ...t,
            runPhase: 'finalizing',
            activity: 'Saving changes',
            consumedMessageIds: [
              ...new Set([...currentMessages.map((m) => m.id), assistantId, ...acceptedIds]),
            ],
            turns: t.turns?.map((turn) =>
              turn.id === turnId ? { ...turn, status: 'completed', finishedAt } : turn,
            ),
          }))
          const captured = yield* checkpoint()
          const review = yield* runtimeOperation(() => this.git.changes(cwd)).pipe(
            Effect.map((files) => ({ files, error: undefined })),
            Effect.catchAll((error) =>
              Effect.succeed({
                files: undefined,
                error: `Agent finished. Could not refresh changes: ${errorMessage(error)}`,
              }),
            ),
          )
          this.store.updateTask(id, (t) => ({
            ...t,
            status: 'review',
            runPhase: captured.error || review.error ? 'finalizing' : undefined,
            runAttempt: undefined,
            restartRecovery:
              captured.error || review.error ? { kind: 'turn', automatic: false } : undefined,
            queuePaused: captured.error || review.error ? true : t.queuePaused,
            files: review.files ?? t.files,
            error: review.error ?? captured.error ?? t.error,
            activity: undefined,
            consumedMessageIds: [
              ...new Set([...currentMessages.map((m) => m.id), assistantId, ...acceptedIds]),
            ],
            turns: t.turns?.map((turn) =>
              turn.id === turnId
                ? { ...turn, checkpoint: captured, status: 'completed', finishedAt }
                : turn,
            ),
          }))
        }).pipe(
          Effect.catchAllCause((cause) =>
            Effect.gen(this, function* () {
              const error = runtimeFailure(Cause.squash(cause))
              if (providerFinishedAt) {
                // Finalization failure cannot revise the provider's successful outcome.
                yield* runtimeOperation(() =>
                  this.store.updateTask(id, (t) => ({
                    ...t,
                    status: 'review',
                    runPhase: 'finalizing',
                    restartRecovery: { kind: 'turn', automatic: false },
                    activity: undefined,
                    queuePaused: true,
                    consumedMessageIds: [
                      ...new Set([
                        ...currentMessages.map((m) => m.id),
                        assistantId,
                        ...acceptedIds,
                      ]),
                    ],
                    error: `Agent finished. Could not save changes: ${errorMessage(error)}. Resume to retry change capture.`,
                    turns: t.turns?.map((turn) =>
                      turn.id === turnId
                        ? { ...turn, status: 'completed', finishedAt: providerFinishedAt }
                        : turn,
                    ),
                  })),
                ).pipe(
                  Effect.mapError((failure) =>
                    runtimeFailure(new FinalizationFailure(errorMessage(failure))),
                  ),
                )
                return
              }
              flush()
              const finishedAt = new Date().toISOString()
              const status = controller.signal.aborted
                ? ('cancelled' as const)
                : ('failed' as const)
              this.store.updateTask(id, (t) => ({
                ...t,
                runPhase: 'finalizing',
                activity: 'Saving changes',
                queuePaused: true,
                turns: t.turns?.map((turn) =>
                  turn.id === turnId
                    ? {
                        ...turn,
                        status,
                        finishedAt,
                        error: errorMessage(controller.signal.reason ?? error),
                      }
                    : turn,
                ),
              }))
              const captured =
                error instanceof RuntimeOperationError &&
                error.cause instanceof OwnedProcessShutdownError
                  ? {
                      before,
                      files: [],
                      omitted: [],
                      error: 'Change capture skipped because provider shutdown was not confirmed.',
                    }
                  : yield* checkpoint()
              this.store.updateTask(id, (t) => ({
                ...t,
                status: controller.signal.aborted ? 'cancelled' : 'failed',
                runPhase: undefined,
                error: errorMessage(controller.signal.reason ?? error),
                activity: undefined,
                queuePaused: true,
                turns: t.turns?.map((turn) =>
                  turn.id === turnId
                    ? {
                        ...turn,
                        checkpoint: captured,
                        status: controller.signal.aborted ? 'cancelled' : 'failed',
                        finishedAt,
                        error: errorMessage(controller.signal.reason ?? error),
                      }
                    : turn,
                ),
              }))
              return yield* Effect.fail(error)
            }),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              flush()
              reasoning.finish()
            }),
          ),
        )
      }),
    )
  }
}

function attachmentPrompt(attachments: NonNullable<import('./types.js').AgentRun['attachments']>) {
  return attachments
    .map((file) => {
      let excerpt = ''
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(
          Buffer.from(file.data, 'base64'),
        )
        if (!text.includes('\0'))
          excerpt = `\nText excerpt${text.length > 32000 ? ' (truncated; read the file for the rest)' : ''}:\n${text.slice(0, 32000)}`
      } catch {
        /* Binary files are provided by path and native image input. */
      }
      return `User attachment: ${JSON.stringify(file.name)} (${file.mime}), local path: ${JSON.stringify(file.path)}${excerpt}`
    })
    .join('\n\n')
}
