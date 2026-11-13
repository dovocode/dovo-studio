import { randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { Effect } from 'effect'
import {
  botCreateSchema,
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
      const value = yield* serviceResult(body(request, 256 * 1024))
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
        return yield* runtimeOperation(() => {
          // Stored-secret references in resources become the saved values again.
          const input = decode(botUpdateSchema, s.store.restoreSecrets(value))
          change(s, input.id, input.expectedRevision, (bot) => ({
            role: input.role ?? bot.role,
            responsibilities: input.responsibilities ?? bot.responsibilities,
            state: bot.state,
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
          }))
          if (input.action === 'resume') s.tasks.releaseBotHold(input.id)
          return result(s, input.id)
        })
      }
      throw new HttpError(404, 'Unknown Bot action')
    }),
  )
}
