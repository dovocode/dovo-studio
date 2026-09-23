import { routeProgram, serviceResult } from './effect.js'
import { mutableStruct } from '@dovo/protocol'
import { minValue, maxValue, decode } from '@dovo/protocol'
import type { IncomingMessage } from 'node:http'
import { Schema, Effect } from 'effect'
import { RuntimeServices } from '../services.js'
import { HttpError } from '../errors.js'
import { body } from './body.js'
import { newSecret, hashSecret } from '../auth/devices.js'
const idSchema = maxValue(minValue(Schema.String, 1), 200)
export function jobsRoute(request: IncomingMessage, path: string, owner: () => void) {
  return routeProgram(
    Effect.gen(function* () {
      const s = yield* RuntimeServices
      const method = request.method
      if (method === 'POST' && path === '/api/jobs/run') {
        const { id, requestId } = decode(
          mutableStruct({
            id: idSchema,
            requestId: Schema.optional(idSchema),
          }),
          yield* serviceResult(body(request)),
        )
        return yield* serviceResult({
          id: s.jobs.startManual(id, requestId),
        })
      }
      if (method === 'POST' && path === '/api/jobs/retry') {
        const { id } = decode(
          mutableStruct({
            id: idSchema,
          }),
          yield* serviceResult(body(request)),
        )
        return yield* serviceResult({
          id: s.jobs.retry(id),
        })
      }
      if (method === 'POST' && path === '/api/jobs/review') {
        const input = decode(
          mutableStruct({
            id: idSchema,
            allow: Schema.Boolean,
          }),
          yield* serviceResult(body(request)),
        )
        s.jobs.approve(input.id, input.allow)
        return yield* serviceResult({
          ok: true,
        })
      }
      if (method === 'POST' && path === '/api/jobs/cancel') {
        s.jobs.cancel(
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
      if (method === 'POST' && path === '/api/jobs/webhook-secret') {
        owner()
        const { id } = decode(
          mutableStruct({
            id: idSchema,
          }),
          yield* serviceResult(body(request)),
        )
        if (!s.store.get().automations.some((f) => f.id === id))
          throw new HttpError(404, 'Automation not found')
        const secret = newSecret()
        s.db
          .prepare(
            'INSERT INTO documents VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
          )
          .run(`webhook:${id}`, hashSecret(secret))
        return yield* serviceResult({
          secret,
          path: `/api/webhooks/${encodeURIComponent(id)}`,
        })
      }
      throw new HttpError(404, 'Endpoint not found')
    }),
  )
}
