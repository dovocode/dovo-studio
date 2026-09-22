import type { IncomingMessage } from 'node:http'
import { z } from 'zod'
import type { Services } from '../services.js'
import { HttpError } from '../errors.js'
import { body } from './body.js'
const idSchema = z.string().min(1).max(200)
export async function terminalsRoute(
  request: IncomingMessage,
  path: string,
  s: Services,
  token: string,
): Promise<unknown> {
  const method = request.method
  if (method === 'POST' && path === '/api/terminals') {
    const { taskId } = z.object({ taskId: idSchema }).parse(await body(request))
    const task = s.store.task(taskId),
      repo = s.store.get().repositories.find((r) => r.id === task.repositoryId)
    if (!repo || task.example) throw new HttpError(400, 'Select a real task with a repository')
    const cwd = await s.checkouts.directory(taskId)
    return s.terminals.create(taskId, cwd)
  }
  if (method === 'POST' && path === '/api/terminals/close') {
    s.terminals.close(z.object({ id: idSchema }).parse(await body(request)).id)
    return { ok: true }
  }
  if (method === 'POST' && path === '/api/terminals/ticket') {
    const { id } = z.object({ id: idSchema }).parse(await body(request))
    s.terminals.get(id)
    return { ticket: s.tickets.issue(token, id) }
  }
  throw new HttpError(404, 'Endpoint not found')
}
