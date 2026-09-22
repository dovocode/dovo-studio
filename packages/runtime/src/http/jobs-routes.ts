import type { IncomingMessage } from 'node:http'
import { z } from 'zod'
import type { Services } from '../services.js'
import { HttpError } from '../errors.js'
import { body } from './body.js'
import { newSecret, hashSecret } from '../auth/devices.js'
const idSchema = z.string().min(1).max(200)
export async function jobsRoute(
  request: IncomingMessage,
  path: string,
  s: Services,
  owner: () => void,
): Promise<unknown> {
  const method = request.method
  if (method === 'POST' && path === '/api/jobs/run') {
    const { id, requestId } = z
      .object({ id: idSchema, requestId: idSchema.optional() })
      .parse(await body(request))
    return { id: s.jobs.startManual(id, requestId) }
  }
  if (method === 'POST' && path === '/api/jobs/retry') {
    const { id } = z.object({ id: idSchema }).parse(await body(request))
    return { id: s.jobs.retry(id) }
  }
  if (method === 'POST' && path === '/api/jobs/review') {
    const input = z.object({ id: idSchema, allow: z.boolean() }).parse(await body(request))
    s.jobs.approve(input.id, input.allow)
    return { ok: true }
  }
  if (method === 'POST' && path === '/api/jobs/cancel') {
    s.jobs.cancel(z.object({ id: idSchema }).parse(await body(request)).id)
    return { ok: true }
  }
  if (method === 'POST' && path === '/api/jobs/webhook-secret') {
    owner()
    const { id } = z.object({ id: idSchema }).parse(await body(request))
    if (!s.store.get().automations.some((f) => f.id === id))
      throw new HttpError(404, 'Automation not found')
    const secret = newSecret()
    s.db
      .prepare(
        'INSERT INTO documents VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
      )
      .run(`webhook:${id}`, hashSecret(secret))
    return { secret, path: `/api/webhooks/${encodeURIComponent(id)}` }
  }
  throw new HttpError(404, 'Endpoint not found')
}
