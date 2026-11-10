import type { IncomingMessage } from 'node:http'
import { Schema, Effect } from 'effect'
import {
  decode,
  mutableStruct,
  maxValue,
  minValue,
  runtimeDictationInputSchema,
} from '@dovo/protocol'
import { RuntimeServices } from '../../runtime-services.js'
import { HttpError } from '../../errors.js'
import { body } from '../support/body.js'
import { routeProgram, serviceResult } from '../support/effect.js'

const sessionSchema = mutableStruct({ id: maxValue(minValue(Schema.String, 1), 100) })
export function dictationRoute(request: IncomingMessage, path: string, token: string) {
  return routeProgram(
    Effect.gen(function* () {
      const s = yield* RuntimeServices
      // Speech is a paired human operation; agent run tokens cannot send audio or install models.
      const device = s.devices.authenticate(token)
      if (request.method !== 'POST') throw new HttpError(405, 'Use POST')
      if (path === '/api/dictation/status') return yield* serviceResult(s.dictation.engine.status())
      const controller = new AbortController()
      const abort = () => controller.abort()
      request.on('aborted', abort)
      request.socket.on('close', abort)
      const timer = setInterval(() => {
        try {
          s.devices.authenticate(token)
        } catch {
          controller.abort()
        }
      }, 1000)
      try {
        if (path === '/api/dictation/cancel') {
          const input = decode(sessionSchema, yield* serviceResult(body(request)))
          yield* serviceResult(s.dictation.cancel(device.id, input.id))
          return { ok: true }
        }
        if (path === '/api/dictation/install') {
          const input = decode(sessionSchema, yield* serviceResult(body(request)))
          yield* serviceResult(
            s.dictation.run(device.id, input.id, controller.signal, (signal) =>
              s.dictation.engine.install(signal),
            ),
          )
          return s.dictation.engine.status()
        }
        if (path === '/api/dictation/transcribe') {
          const input = decode(
            runtimeDictationInputSchema,
            yield* serviceResult(body(request, 13 * 1024 * 1024)),
          )
          s.store.taskSummary(input.taskId)
          const result = yield* serviceResult(
            s.dictation.transcribe(
              device.id,
              input,
              AbortSignal.any([controller.signal, AbortSignal.timeout(270000)]),
            ),
          )
          s.devices.authenticate(token)
          return result
        }
        throw new HttpError(404, 'Speech operation not found')
      } finally {
        clearInterval(timer)
        request.off('aborted', abort)
        request.socket.off('close', abort)
      }
    }),
  )
}
