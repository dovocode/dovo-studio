import { randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { Effect } from 'effect'
import {
  botCreateSchema,
  botAvatarGenerateSchema,
  botAvatarUploadSchema,
  botContextResetRequestSchema,
  botContextMessages,
  taskIsWorking,
  taskSubagents,
  botLifecycleSchema,
  botUpdateSchema,
  decode,
  SCRATCH_PROJECT_ID,
  type Bot,
  type BotResources,
  type BotResult,
} from '@dovo/protocol'
import { isDeepStrictEqual } from 'node:util'
import { RuntimeServices } from '../../runtime-services.js'
import type { Services } from '../../services.js'
import { HttpError, runtimeOperation } from '../../errors.js'
import { body } from '../support/body.js'
import { routeProgram, serviceResult } from '../support/effect.js'
import { startThreadEffect, threadStartAcknowledgement } from './thread-start.js'
import { botAvatarPreview } from '../../agents/tasks/bot-avatar.js'

const isEmpty = (resources: BotResources) =>
  !resources.mcpServers.length &&
  !resources.skills.length &&
  !resources.disabledMcpServers.length &&
  !resources.disabledSkills.length
const stale = () =>
  new HttpError(409, 'This Bot changed on its computer. Review it before saving.', {
    mutationRejected: true,
  })

/** Literal MCP credentials leave the host only as stored-secret references, also in
 * mutation receipts. */
function result(s: Services, id: string): BotResult {
  const bot = s.store.taskSummary(id).bot
  if (!bot) throw new HttpError(404, 'Bot not found', { mutationRejected: true })
  return threadStartAcknowledgement(s, { id, bot: s.store.publicValue(bot) as Bot })
}
type BotFields = Pick<Bot, 'role' | 'responsibilities' | 'state'> & {
  resources?: BotResources | undefined
  avatar?: string | undefined
}

/** Change one Bot under compare-and-set. A replay whose outcome already holds succeeds. */
function change(
  s: Services,
  id: string,
  expectedRevision: string | undefined,
  next: (bot: Bot) => BotFields,
) {
  s.store.transaction(() => {
    const bot = s.store.get().tasks.find((task) => task.id === id)?.bot
    if (!bot) throw new HttpError(404, 'Bot not found', { mutationRejected: true })
    const wanted = next(bot)
    if (
      wanted.role === bot.role &&
      wanted.responsibilities === bot.responsibilities &&
      wanted.state === bot.state &&
      wanted.avatar === bot.avatar &&
      isDeepStrictEqual(wanted.resources ?? null, bot.resources ?? null)
    )
      return
    if (expectedRevision !== undefined && expectedRevision !== bot.revision) throw stale()
    s.store.updateTask(id, (task) => ({
      ...task,
      bot: {
        ...bot,
        ...wanted,
        ...(wanted.resources ? {} : { resources: undefined }),
        revision: randomUUID(),
        updatedAt: new Date().toISOString(),
      },
    }))
    s.activity.add(
      'task',
      id,
      wanted.state !== bot.state
        ? wanted.state === 'paused'
          ? 'Bot paused'
          : 'Bot resumed'
        : isDeepStrictEqual(wanted.resources ?? null, bot.resources ?? null)
          ? 'Bot responsibilities updated'
          : 'Bot MCP servers and skills updated',
    )
  })
}

/** Human-only Bot identity changes. Harness and permission settings stay ordinary thread
 * settings; run tokens never reach these routes. */
export function botsRoute(request: IncomingMessage, path: string, agentAccess: boolean) {
  return routeProgram(
    Effect.gen(function* () {
      const s = yield* RuntimeServices
      if (agentAccess) throw new HttpError(403, 'Bots are managed from a paired human client.')
      const value = yield* serviceResult(
        body(request, path === '/api/bots/avatar/upload' ? 8 * 1024 * 1024 : 256 * 1024),
      )
      if (path === '/api/bots/avatar/upload') {
        const input = decode(botAvatarUploadSchema, value)
        const task = s.store.taskSummary(input.id)
        if (!task.bot || task.replica || task.archivedAt) throw new HttpError(404, 'Bot not found.')
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.data))
          throw new HttpError(400, 'Invalid image data.')
        return yield* serviceResult(botAvatarPreview(Buffer.from(input.data, 'base64')))
      }
      if (path === '/api/bots/avatar/generate')
        return yield* serviceResult(s.botAvatars.generate(value))
      if (path === '/api/bots/avatar/cancel') {
        const input = decode(botAvatarGenerateSchema, value)
        s.botAvatars.cancel(input.id, input.requestId)
        return { ok: true }
      }
      if (path === '/api/bots/reset-context') {
        const input = decode(botContextResetRequestSchema, value)
        return yield* runtimeOperation(() => {
          s.store.transaction(() => {
            const task = s.store.task(input.id)
            const bot = task.bot
            if (!bot || task.replica || task.archivedAt) throw new HttpError(404, 'Bot not found.')
            // An exact replay must not exclude messages sent after the first reset.
            if (
              bot.contextResets?.some(
                (reset) =>
                  reset.turnId === input.turnId && reset.requestRevision === input.expectedRevision,
              )
            )
              return
            if (bot.revision !== input.expectedRevision) throw stale()
            if (
              taskIsWorking(task) ||
              task.queue?.length ||
              taskSubagents(task, s.store.get().tasks, true).length > 0
            )
              throw new HttpError(
                409,
                'Finish or stop current work and clear the queue before resetting context.',
              )
            const turn = task.turns?.find((turn) => turn.id === input.turnId)
            if (!turn || turn.status === 'running')
              throw new HttpError(404, 'Finished reply not found.')
            if (
              !botContextMessages(task.messages, bot).some(
                (message) => message.id === turn.assistantId,
              )
            )
              throw new HttpError(409, 'Choose a reply in the current context.')
            const through = task.messages.at(-1)?.id
            if (!through || !turn.assistantId) throw new HttpError(409, 'No conversation to reset.')
            s.store.updateTask(task.id, (current) => ({
              ...current,
              sessionId: undefined,
              sessionAgentId: undefined,
              consumedMessageIds: undefined,
              contextUsage: undefined,
              runAttempt: undefined,
              bot: {
                ...bot,
                revision: randomUUID(),
                updatedAt: new Date().toISOString(),
                contextResets: [
                  ...(bot.contextResets ?? []),
                  {
                    requestRevision: input.expectedRevision,
                    turnId: turn.id,
                    afterMessageId: turn.assistantId,
                    throughMessageId: through,
                    at: new Date().toISOString(),
                  },
                ],
              },
            }))
            s.activity.add('task', task.id, 'Bot context reset', { turnId: turn.id })
          })
          return result(s, input.id)
        })
      }
      if (path === '/api/bots/create') {
        const input = decode(botCreateSchema, value)
        // Bots are standalone assistants. The runtime, not hidden controls, keeps them out
        // of projects; the internal no-project workspace backs their thread.
        const task = input.createTask
        if (
          task.repositoryId !== SCRATCH_PROJECT_ID ||
          task.execution === 'worktree' ||
          task.autoProject ||
          task.autoProjectExecution ||
          task.setupCommand ||
          task.existingWorktreePath ||
          task.worktreeBaseBranch ||
          task.worktreeIncludeChanges ||
          task.submodules
        )
          throw new HttpError(400, 'A Bot is standalone. Create it without a project.', {
            mutationRejected: true,
          })
        yield* startThreadEffect(s, {
          messageId: input.requestId,
          createTask: input.createTask,
          bot: { role: input.role, responsibilities: input.responsibilities },
        })
        return yield* runtimeOperation(() => result(s, input.createTask.id))
      }
      if (path === '/api/bots/update') {
        const input = decode(botUpdateSchema, s.store.restoreSecrets(value))
        const avatar =
          typeof input.avatar === 'string'
            ? (yield* serviceResult(
                botAvatarPreview(
                  Buffer.from(input.avatar.slice(input.avatar.indexOf(',') + 1), 'base64'),
                ),
              )).avatar
            : input.avatar
        return yield* runtimeOperation(() => {
          // Stored-secret references in resources become the saved values again.
          change(s, input.id, input.expectedRevision, (bot) => ({
            role: input.role ?? bot.role,
            responsibilities: input.responsibilities ?? bot.responsibilities,
            state: bot.state,
            avatar: avatar === null ? undefined : (avatar ?? bot.avatar),
            resources: input.resources
              ? isEmpty(input.resources)
                ? undefined
                : input.resources
              : bot.resources,
          }))
          return result(s, input.id)
        })
      }
      if (path === '/api/bots/lifecycle') {
        const input = decode(botLifecycleSchema, value)
        return yield* runtimeOperation(() => {
          change(s, input.id, input.expectedRevision, (bot) => ({
            role: bot.role,
            responsibilities: bot.responsibilities,
            state: input.action === 'pause' ? 'paused' : 'active',
            resources: bot.resources,
            avatar: bot.avatar,
          }))
          if (input.action === 'resume') s.tasks.releaseBotHold(input.id)
          return result(s, input.id)
        })
      }
      throw new HttpError(404, 'Unknown Bot action')
    }),
  )
}
