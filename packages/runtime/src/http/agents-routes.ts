import { acpRoute } from './acp-routes.js'
import { routeProgram, serviceResult } from './effect.js'
import { runtimeSetupSchema } from '@dovo/protocol'
import { mutableStruct } from '@dovo/protocol'
import { minValue, maxValue, decode } from '@dovo/protocol'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { searchRegistry } from '../agents/catalogs/registry.js'
import { searchSkills, installCatalogSkill } from '../agents/catalogs/skills.js'
import { importSkill, testMcpServer } from '../agents/resources.js'
import { attachmentIdsSchema } from '@dovo/protocol'
import { agentDiscoverySchema, modelCatalogSchema, questionReplySchema } from '@dovo/protocol'
import type { IncomingMessage } from 'node:http'
import { Schema, Effect } from 'effect'
import { RuntimeServices } from '../services.js'
import { HttpError } from '../errors.js'
import { body } from './body.js'
const idSchema = maxValue(minValue(Schema.String, 1), 200)
export function agentsRoute(request: IncomingMessage, path: string) {
  return routeProgram(
    Effect.gen(function* () {
      const s = yield* RuntimeServices
      const method = request.method
      if (path.startsWith('/api/agents/acp/')) return yield* acpRoute(request, path)
      if (method === 'POST' && path === '/api/agents/catalogs/mcp')
        return yield* serviceResult(searchRegistry(yield* serviceResult(body(request))))
      if (method === 'POST' && path === '/api/agents/catalogs/skills')
        return yield* serviceResult(searchSkills(yield* serviceResult(body(request))))
      if (method === 'POST' && path === '/api/agents/catalogs/skills/import')
        return yield* serviceResult(
          installCatalogSkill(
            yield* serviceResult(body(request)),
            s.db.name === ':memory:'
              ? join(tmpdir(), 'dovo-catalog-skills')
              : join(dirname(resolve(s.db.name)), 'skills'),
          ),
        )
      if (method === 'POST' && path === '/api/agents/skills/import')
        return yield* serviceResult(importSkill(yield* serviceResult(body(request))))
      if (method === 'POST' && path === '/api/agents/mcp/test')
        return yield* serviceResult(
          testMcpServer(s.store.restoreSecrets(yield* serviceResult(body(request)))),
        )
      if (method === 'POST' && path === '/api/agents/setup/read')
        return yield* serviceResult({ defaults: s.defaults.get(), titles: s.titles.read() })
      if (method === 'POST' && path === '/api/agents/setup/save') {
        const input = decode(runtimeSetupSchema, yield* serviceResult(body(request)))
        if (input.defaults.harness.acpInstallationId) s.agents.launch(input.defaults.harness)
        return yield* serviceResult(
          s.db.transaction(() => ({
            defaults: s.defaults.save(input.defaults),
            titles: s.titles.save(input.titles),
          }))(),
        )
      }
      if (method === 'POST' && path === '/api/agents/title-settings/read')
        return yield* serviceResult(s.titles.read())
      if (method === 'POST' && path === '/api/agents/title-settings/save')
        return yield* serviceResult(s.titles.save(yield* serviceResult(body(request))))
      if (method === 'POST' && path === '/api/tasks/lifecycle') {
        const { id, action } = decode(
          mutableStruct({
            id: idSchema,
            action: Schema.Literal('archive', 'restore', 'delete'),
          }).annotations({
            parseOptions: {
              onExcessProperty: 'error',
            },
          }),
          yield* serviceResult(body(request)),
        )
        // Missing deletes are successful retries after a lost response.
        if (action === 'delete' && !s.store.get().tasks.some((task) => task.id === id))
          return yield* serviceResult({
            ok: true,
          })
        s.tasks.requireIdle(id)
        s.jobs.requireTaskIdle(id)
        if (action !== 'restore') {
          if (s.terminals.list().some((terminal) => terminal.taskId === id && !terminal.exited))
            throw new HttpError(
              409,
              'Close this thread’s terminals before archiving or deleting it.',
            )
          yield* serviceResult(s.browsers.close(id))
          yield* serviceResult(s.simulators.closeTask(id))
          s.tasks.requireIdle(id)
          s.jobs.requireTaskIdle(id)
        }
        if (action === 'delete') {
          s.db.transaction(() => {
            s.db.prepare('DELETE FROM activity WHERE scope = ?').run(id)
            s.db.prepare('DELETE FROM attachments WHERE task = ?').run(id)
            s.store.update((workspace) => ({
              ...workspace,
              tasks: workspace.tasks.filter((task) => task.id !== id),
            }))
          })()
        } else {
          s.store.updateTask(id, (task) => ({
            ...task,
            archived: action === 'archive',
            archivedAt:
              action === 'archive' ? (task.archivedAt ?? new Date().toISOString()) : undefined,
            snoozedUntil: null,
          }))
        }
        return yield* serviceResult({
          ok: true,
        })
      }
      if (method === 'POST' && path === '/api/tasks/viewed') {
        const { id, turnId, viewed, expectedRevision } = decode(
          mutableStruct({
            id: idSchema,
            turnId: idSchema,
            viewed: Schema.optionalWith(Schema.Boolean, {
              default: () => true,
            }),
            expectedRevision: Schema.Number.pipe(Schema.finite())
              .pipe(Schema.int(), Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER))
              .pipe(Schema.nonNegative()),
          }).annotations({
            parseOptions: {
              onExcessProperty: 'error',
            },
          }),
          yield* serviceResult(body(request)),
        )
        s.store.markTaskViewed(id, turnId, expectedRevision, viewed)
        return yield* serviceResult({
          ok: true,
        })
      }
      if (method === 'POST' && path === '/api/tasks/title')
        return yield* s.titles.generateEffect(yield* serviceResult(body(request)))
      if (method === 'POST' && path === '/api/tasks/dictation/cleanup')
        return yield* s.titles.cleanupEffect(yield* serviceResult(body(request)))
      if (method === 'POST' && path === '/api/tasks/answer') {
        const input = decode(questionReplySchema, yield* serviceResult(body(request)))
        s.questions.respond(input.id, input.answers)
        return yield* serviceResult({
          ok: true,
        })
      }
      if (method === 'POST' && path === '/api/agents/models') {
        const agent = decode(agentDiscoverySchema, yield* serviceResult(body(request)))
        const adapter = yield* serviceResult(s.agents.get(agent.provider))
        if (!adapter.models) throw new HttpError(400, 'This integration does not advertise models')
        return yield* serviceResult(
          decode(modelCatalogSchema, yield* serviceResult(adapter.models(agent))),
        )
      }
      if (method === 'POST' && path === '/api/approvals') {
        const input = decode(
          mutableStruct({
            id: idSchema,
            allow: Schema.Boolean,
          }),
          yield* serviceResult(body(request)),
        )
        s.approvals.respond(input.id, input.allow)
        return yield* serviceResult({
          ok: true,
        })
      }
      if (method === 'POST' && path === '/api/agents/probe') {
        const { id } = decode(
          mutableStruct({
            id: idSchema,
          }),
          yield* serviceResult(body(request)),
        )
        const agent = s.store.get().agents.find((a) => a.id === id)
        if (!agent) throw new HttpError(404, 'Agent not found')
        return yield* serviceResult(
          (yield* serviceResult(s.agents.get(agent.provider))).probe(agent),
        )
      }
      if (method === 'POST' && (path === '/api/tasks/message' || path === '/api/tasks/steer')) {
        const input = decode(
          mutableStruct({
            id: idSchema,
            messageId: idSchema,
            text: maxValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 120000),
            attachmentIds: Schema.optionalWith(attachmentIdsSchema, {
              default: () => [],
            }),
          }),
          yield* serviceResult(body(request)),
        )
        if (!input.text && !input.attachmentIds.length)
          throw new HttpError(400, 'Add a message or attachment')
        if (path === '/api/tasks/steer')
          return yield* s.tasks.steerEffect(
            input.id,
            input.messageId,
            input.text,
            input.attachmentIds,
          )
        return yield* s.tasks.sendEffect(input.id, input.messageId, input.text, input.attachmentIds)
      }
      if (method === 'POST' && path === '/api/tasks/queue') {
        const input = decode(
          mutableStruct({
            id: idSchema,
            action: Schema.Literal('remove', 'up', 'down', 'pause', 'resume'),
            messageId: Schema.optional(idSchema),
          }),
          yield* serviceResult(body(request)),
        )
        if (input.action === 'resume') {
          if (!s.store.task(input.id).queue?.length)
            return yield* serviceResult({
              ok: true,
            })
          if (s.store.task(input.id).status === 'running')
            s.store.updateTask(input.id, (t) => ({
              ...t,
              queuePaused: false,
            }))
          else yield* s.tasks.startEffect(input.id)
        } else s.tasks.queue.change(input.id, input.action, input.messageId)
        return yield* serviceResult({
          ok: true,
        })
      }
      if (method === 'POST' && path === '/api/tasks/feedback')
        return yield* serviceResult(s.tasks.feedback(yield* serviceResult(body(request))))
      if (method === 'POST' && path === '/api/tasks/run') {
        const { id } = decode(
          mutableStruct({
            id: idSchema,
          }),
          yield* serviceResult(body(request)),
        )
        yield* s.tasks.startEffect(id)
        return yield* serviceResult({
          ok: true,
        })
      }
      if (method === 'POST' && path === '/api/tasks/cancel') {
        s.tasks.cancel(
          decode(
            mutableStruct({
              id: idSchema,
            }),
            yield* serviceResult(body(request)),
          ).id,
        )
        return yield* serviceResult({
          ok: true,
        })
      }
      if (method === 'POST' && path === '/api/tasks/new-session') {
        const { id } = decode(
          mutableStruct({
            id: idSchema,
          }),
          yield* serviceResult(body(request)),
        )
        if (s.store.task(id).status === 'running')
          throw new HttpError(409, 'Cancel the active turn first')
        s.store.updateTask(id, (t) => ({
          ...t,
          sessionId: undefined,
          sessionAgentId: undefined,
          consumedMessageIds: undefined,
        }))
        return yield* serviceResult({
          ok: true,
        })
      }
      throw new HttpError(404, 'Endpoint not found')
    }),
  )
}
