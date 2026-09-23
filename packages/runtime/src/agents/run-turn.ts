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
import { HttpError, errorMessage } from '../errors.js'
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
  async run(
    id: string,
    cwd: string,
    controller: AbortController,
    onSteer?: (steer: ((messageId: string) => Promise<void>) | undefined) => void,
    onQuestions?: AgentRun['onQuestions'],
  ) {
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
      throw new HttpError(400, `${agent.provider} does not support access mode ${agent.permission}`)
    const commands = this.commands.get()
    const { branch } = await this.git.inspect(cwd)
    let assistantId = randomUUID()
    const turnId = randomUUID(),
      fingerprint = createHash('sha256')
        .update(JSON.stringify({ agent, cwd, commands, branch }))
        .digest('hex')
    const sessionId = task.sessionAgentId === fingerprint ? task.sessionId : undefined
    const currentMessages = this.store.task(id).messages
    const lastAssistant = currentMessages.map((message) => message.role).lastIndexOf('assistant')
    const consumedMessageIds = sessionId
      ? (task.consumedMessageIds ??
        currentMessages.slice(0, lastAssistant + 1).map((message) => message.id))
      : []
    const messages = sessionId
      ? currentMessages.filter((message) => !consumedMessageIds.includes(message.id))
      : currentMessages
    const prompt =
      messages.map((m) => `${m.role}: ${m.text}`).join('\n\n') ||
      'Continue the task and report the result.'
    const before = await this.git.snapshot(cwd, `refs/dovo/checkpoints/${turnId}/before`)
    controller.signal.throwIfAborted()
    this.store.updateTask(id, (t) => ({
      ...t,
      status: 'running',
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
    const checkpoint = async () => {
      let after: string | undefined
      try {
        after = await this.git.snapshot(cwd, `refs/dovo/checkpoints/${turnId}/after`)
        return { before, after, ...(await this.git.checkpointChanges(cwd, before, after)) }
      } catch (error) {
        return {
          before,
          after,
          files: [],
          omitted: [],
          error: `Could not capture turn changes: ${errorMessage(error)}`,
        }
      }
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
    let steering: Promise<void> | undefined
    let buffer = '',
      timer: ReturnType<typeof setTimeout> | undefined
    const flush = () => {
      if (timer) clearTimeout(timer)
      timer = undefined
      if (!buffer) return
      const text = buffer
      buffer = ''
      this.store.updateTask(id, (t) => ({
        ...t,
        messages: t.messages.map((m) => (m.id === assistantId ? { ...m, text: m.text + text } : m)),
      }))
    }
    const timeout = setTimeout(
      () => controller.abort(new Error('Task exceeded the two-hour runtime limit')),
      2 * 60 * 60 * 1000,
    )
    try {
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
      const attachments = await Promise.all(
        messages
          .flatMap((m) => m.attachments ?? [])
          .map((file) => this.attachments.materialize(id, file)),
      )
      const attachmentContext = attachmentPrompt(attachments)
      const adapter = await this.registry.get(agent.provider)
      try {
        controller.signal.throwIfAborted()
        await adapter.run({
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
          onQuestions,
          onSteer: (steer) => {
            if (!steer) {
              onSteer?.(undefined)
              return
            }
            const apply = async (messageId: string, send: AgentSteer) => {
              const message = this.store.task(id).queue?.find((m) => m.id === messageId)
              if (!message) throw new HttpError(409, 'This message already started or was removed')
              const files = await Promise.all(
                (message.attachments ?? []).map((file) => this.attachments.materialize(id, file)),
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
                consumedMessageIds: [...new Set([...(t.consumedMessageIds ?? []), ...acceptedIds])],
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
            buffer += text
            if (!timer) timer = setTimeout(flush, 100)
          },
          onEvent: (name, payload) => {
            const current = this.store.task(id).subagents ?? []
            const subagents = updateSubagents(
              current,
              agent.provider,
              payload,
              new Date().toISOString(),
              name,
            )
            if (subagents !== current) this.store.updateTask(id, (task) => ({ ...task, subagents }))
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
            this.activity?.add('agent', id, `${agent.provider} activity`, { text })
            this.store.updateTask(id, (t) => ({ ...t, activity: text }))
          },
          approve: (title, detail) => this.approvals.request(id, title, detail, controller.signal),
          ask: (prompt, signal, validate) =>
            this.questions.request(
              id,
              prompt,
              signal ? AbortSignal.any([questionSignal, signal]) : questionSignal,
              validate,
            ),
        })
      } finally {
        onSteer?.(undefined)
        // A final notification may arrive before the steering acknowledgement.
        await steering?.catch(() => {
          /* Tasks retains unconfirmed input in the paused queue. */
        })
        questionController.abort()
      }
      flush()
      if (controller.signal.aborted) throw new Error('Task cancelled')
      const captured = await checkpoint()
      const finishedAt = new Date().toISOString()
      const review = await this.git
        .changes(cwd)
        .then((files) => ({ files, error: undefined }))
        .catch((error) => ({
          files: undefined,
          error: `Agent finished. Could not refresh changes: ${errorMessage(error)}`,
        }))
      this.store.updateTask(id, (t) => ({
        ...t,
        status: 'review',
        files: review.files ?? t.files,
        error: review.error ?? t.error,
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
    } catch (error) {
      flush()
      const captured = await checkpoint()
      this.store.updateTask(id, (t) => ({
        ...t,
        status: controller.signal.aborted ? 'cancelled' : 'failed',
        error: errorMessage(controller.signal.reason ?? error),
        activity: undefined,
        queuePaused: true,
        turns: t.turns?.map((turn) =>
          turn.id === turnId
            ? {
                ...turn,
                checkpoint: captured,
                status: controller.signal.aborted ? 'cancelled' : 'failed',
                finishedAt: new Date().toISOString(),
                error: errorMessage(controller.signal.reason ?? error),
              }
            : turn,
        ),
      }))
      throw error
    } finally {
      reasoning.finish()
      clearTimeout(timeout)
    }
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
