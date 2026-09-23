import { routeProgram, serviceResult } from './effect.js'
import { mutableStruct } from '@dovo/protocol'
import { minValue, maxValue, decode } from '@dovo/protocol'
import type { IncomingMessage } from 'node:http'
import { Schema, Effect } from 'effect'
import { RuntimeServices } from '../services.js'
import { HttpError } from '../errors.js'
import { body } from './body.js'
const idSchema = maxValue(minValue(Schema.String, 1), 200)
export function terminalsRoute(request: IncomingMessage, path: string, token: string) {
  return routeProgram(
    Effect.gen(function* () {
      const s = yield* RuntimeServices
      const method = request.method
      if (method === 'POST' && path === '/api/terminals') {
        const { taskId } = decode(
          mutableStruct({
            taskId: idSchema,
          }),
          yield* serviceResult(body(request)),
        )
        const task = s.store.task(taskId),
          repo = s.store.get().repositories.find((r) => r.id === task.repositoryId)
        if (!repo || task.example) throw new HttpError(400, 'Select a real task with a repository')
        const cwd = yield* serviceResult(s.checkouts.directory(taskId))
        return yield* serviceResult(s.terminals.create(taskId, cwd))
      }
      if (method === 'POST' && path === '/api/terminals/close') {
        s.terminals.close(
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
      if (method === 'POST' && path === '/api/terminals/ticket') {
        const { id } = decode(
          mutableStruct({
            id: idSchema,
          }),
          yield* serviceResult(body(request)),
        )
        s.terminals.get(id)
        return yield* serviceResult({
          ticket: s.tickets.issue(token, id),
        })
      }
      throw new HttpError(404, 'Endpoint not found')
    }),
  )
}
