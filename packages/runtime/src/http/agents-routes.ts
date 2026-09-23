import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { searchRegistry } from '../agents/catalogs/registry.js'
import { searchSkills, installCatalogSkill } from '../agents/catalogs/skills.js'
import { importSkill, testMcpServer } from '../agents/resources.js'
import { attachmentIdsSchema } from '@dovo/protocol'
import { agentDiscoverySchema, modelCatalogSchema, questionReplySchema } from '@dovo/protocol'
import type { IncomingMessage } from 'node:http'
import { z } from 'zod'
import type { Services } from '../services.js'
import { HttpError } from '../errors.js'
import { body } from './body.js'
const idSchema = z.string().min(1).max(200)
export async function agentsRoute(
  request: IncomingMessage,
  path: string,
  s: Services,
): Promise<unknown> {
  const method = request.method
  if (method === 'POST' && path === '/api/agents/catalogs/mcp')
    return searchRegistry(await body(request))
  if (method === 'POST' && path === '/api/agents/catalogs/skills')
    return searchSkills(await body(request))
  if (method === 'POST' && path === '/api/agents/catalogs/skills/import')
    return installCatalogSkill(
      await body(request),
      s.db.name === ':memory:'
        ? join(tmpdir(), 'dovo-catalog-skills')
        : join(dirname(resolve(s.db.name)), 'skills'),
    )
  if (method === 'POST' && path === '/api/agents/skills/import')
    return importSkill(await body(request))
  if (method === 'POST' && path === '/api/agents/mcp/test')
    return testMcpServer(await body(request))
  if (method === 'POST' && path === '/api/agents/title-settings/read') return s.titles.read()
  if (method === 'POST' && path === '/api/agents/title-settings/save')
    return s.titles.save(await body(request))
  if (method === 'POST' && path === '/api/tasks/lifecycle') {
    const { id, action } = z
      .object({
        id: idSchema,
        action: z.enum(['archive', 'restore', 'delete']),
      })
      .strict()
      .parse(await body(request))
    // Missing deletes are successful retries after a lost response.
    if (action === 'delete' && !s.store.get().tasks.some((task) => task.id === id))
      return { ok: true }
    s.tasks.requireIdle(id)
    s.jobs.requireTaskIdle(id)
    if (action !== 'restore') {
      if (s.terminals.list().some((terminal) => terminal.taskId === id && !terminal.exited))
        throw new HttpError(409, 'Close this thread’s terminals before archiving or deleting it.')
      await s.browsers.close(id)
      await s.simulators.closeTask(id)
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
    return { ok: true }
  }
  if (method === 'POST' && path === '/api/tasks/viewed') {
    const { id, turnId, viewed, expectedRevision } = z
      .object({
        id: idSchema,
        turnId: idSchema,
        viewed: z.boolean().default(true),
        expectedRevision: z.number().int().nonnegative(),
      })
      .strict()
      .parse(await body(request))
    s.store.markTaskViewed(id, turnId, expectedRevision, viewed)
    return { ok: true }
  }
  if (method === 'POST' && path === '/api/tasks/title')
    return s.titles.generate(await body(request))
  if (method === 'POST' && path === '/api/tasks/dictation/cleanup')
    return s.titles.cleanup(await body(request))
  if (method === 'POST' && path === '/api/tasks/answer') {
    const input = questionReplySchema.parse(await body(request))
    s.questions.respond(input.id, input.answers)
    return { ok: true }
  }
  if (method === 'POST' && path === '/api/agents/models') {
    const agent = agentDiscoverySchema.parse(await body(request))
    const adapter = await s.agents.get(agent.provider)
    if (!adapter.models) throw new HttpError(400, 'This integration does not advertise models')
    return modelCatalogSchema.parse(await adapter.models(agent))
  }
  if (method === 'POST' && path === '/api/approvals') {
    const input = z.object({ id: idSchema, allow: z.boolean() }).parse(await body(request))
    s.approvals.respond(input.id, input.allow)
    return { ok: true }
  }
  if (method === 'POST' && path === '/api/agents/probe') {
    const { id } = z.object({ id: idSchema }).parse(await body(request))
    const agent = s.store.get().agents.find((a) => a.id === id)
    if (!agent) throw new HttpError(404, 'Agent not found')
    return (await s.agents.get(agent.provider)).probe(agent)
  }
  if (method === 'POST' && (path === '/api/tasks/message' || path === '/api/tasks/steer')) {
    const input = z
      .object({
        id: idSchema,
        messageId: idSchema,
        text: z.string().trim().max(120000),
        attachmentIds: attachmentIdsSchema.default([]),
      })
      .parse(await body(request))
    if (!input.text && !input.attachmentIds.length)
      throw new HttpError(400, 'Add a message or attachment')
    if (path === '/api/tasks/steer')
      return s.tasks.steer(input.id, input.messageId, input.text, input.attachmentIds)
    return s.tasks.send(input.id, input.messageId, input.text, input.attachmentIds)
  }
  if (method === 'POST' && path === '/api/tasks/queue') {
    const input = z
      .object({
        id: idSchema,
        action: z.enum(['remove', 'up', 'down', 'pause', 'resume']),
        messageId: idSchema.optional(),
      })
      .parse(await body(request))
    if (input.action === 'resume') {
      if (!s.store.task(input.id).queue?.length) return { ok: true }
      if (s.store.task(input.id).status === 'running')
        s.store.updateTask(input.id, (t) => ({ ...t, queuePaused: false }))
      else await s.tasks.start(input.id)
    } else s.tasks.queue.change(input.id, input.action, input.messageId)
    return { ok: true }
  }
  if (method === 'POST' && path === '/api/tasks/feedback')
    return s.tasks.feedback(await body(request))
  if (method === 'POST' && path === '/api/tasks/run') {
    const { id } = z.object({ id: idSchema }).parse(await body(request))
    await s.tasks.start(id)
    return { ok: true }
  }
  if (method === 'POST' && path === '/api/tasks/cancel') {
    s.tasks.cancel(z.object({ id: idSchema }).parse(await body(request)).id)
    return { ok: true }
  }
  if (method === 'POST' && path === '/api/tasks/new-session') {
    const { id } = z.object({ id: idSchema }).parse(await body(request))
    if (s.store.task(id).status === 'running')
      throw new HttpError(409, 'Cancel the active turn first')
    s.store.updateTask(id, (t) => ({
      ...t,
      sessionId: undefined,
      sessionAgentId: undefined,
      consumedMessageIds: undefined,
    }))
    return { ok: true }
  }
  throw new HttpError(404, 'Endpoint not found')
}
