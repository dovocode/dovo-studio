import type { IncomingMessage } from 'node:http'
import { Effect } from 'effect'
import {
  decode,
  doCompleteRequestSchema,
  doDeleteRequestSchema,
  doDiscoverRequestSchema,
  doReadRequestSchema,
  doRemoteDispatchRequestSchema,
  doRemoteInspectRequestSchema,
  doRemoteStopRequestSchema,
  doRetryRequestSchema,
  doSaveRequestSchema,
  doStartRequestSchema,
} from '@dovo/protocol'
import { RuntimeServices } from '../services.js'
import { HttpError } from '../errors.js'
import { body } from '../http/support/body.js'
import { routeProgram, serviceResult } from '../http/support/effect.js'

// A full plan carries up to 32 instructions; JSON can escape each character as six.
const SAVE_BODY_LIMIT = 4_000_000
const BODY_LIMIT = 256 * 1024

/** Paired-client Do API. Run tokens never reach it; see `@dovo/protocol` runtime/do.ts. */
export function doRoute(request: IncomingMessage, path: string) {
  return routeProgram(
    Effect.gen(function* () {
      const s = yield* RuntimeServices
      if (request.method !== 'POST') throw new HttpError(405, 'Use POST for Do actions')
      const input = yield* serviceResult(
        body(request, path === '/api/do/save' ? SAVE_BODY_LIMIT : BODY_LIMIT),
      )
      const runs = s.doRuns
      if (path.startsWith('/api/do/remote/')) {
        // Paired computers are addressed by runtime ID; a reused address must not take the work.
        const target = (runtimeId: string) => {
          if (runtimeId !== s.runtimeId)
            throw new HttpError(409, 'This address now belongs to a different runtime')
        }
        // Keys are namespaced by their origin runtime, apart from this runtime's own Do threads.
        const owner = (key: string) => `origin:${key.slice(0, key.indexOf(':'))}`
        if (path === '/api/do/remote/dispatch') {
          const request = decode(doRemoteDispatchRequestSchema, input)
          target(request.runtimeId)
          if (!runs.enabled())
            throw new HttpError(403, 'Experimental Do is turned off on this paired computer')
          return yield* serviceResult(s.doThreads.dispatch(owner(request.key), request))
        }
        if (path === '/api/do/remote/inspect') {
          const { runtimeId, keys } = decode(doRemoteInspectRequestSchema, input)
          target(runtimeId)
          return { observations: keys.map((key) => s.doThreads.observe(owner(key), key)) }
        }
        // Stops stay available while Do is disabled, so running work can always be stopped.
        if (path === '/api/do/remote/stop') {
          const { runtimeId, stops } = decode(doRemoteStopRequestSchema, input)
          target(runtimeId)
          return {
            stops: stops.map(({ key, messageId }) => ({
              key,
              stop: s.doThreads.stop(owner(key), key, messageId),
            })),
          }
        }
        throw new HttpError(404, 'Unknown Do action')
      }
      if (path === '/api/do/list') return { runs: runs.list() }
      if (path === '/api/do/read') return { run: runs.read(decode(doReadRequestSchema, input).id) }
      if (path === '/api/do/cancel')
        return { run: runs.cancel(decode(doReadRequestSchema, input).id) }
      if (path === '/api/do/save') return { run: runs.save(decode(doSaveRequestSchema, input)) }
      if (path === '/api/do/start') {
        const { id, expectedRevision } = decode(doStartRequestSchema, input)
        return { run: runs.start(id, expectedRevision) }
      }
      if (path === '/api/do/retry') {
        const { id, itemIds } = decode(doRetryRequestSchema, input)
        return { run: runs.retry(id, itemIds) }
      }
      if (path === '/api/do/complete') {
        const { id, decision, note } = decode(doCompleteRequestSchema, input)
        return { run: runs.complete(id, decision, note) }
      }
      if (path === '/api/do/delete') {
        const { id, expectedRevision } = decode(doDeleteRequestSchema, input)
        return runs.delete(id, expectedRevision)
      }
      if (path === '/api/do/discover') {
        const { runtimeId, repositoryId } = decode(doDiscoverRequestSchema, input)
        return yield* serviceResult(runs.discover(runtimeId, repositoryId))
      }
      throw new HttpError(404, 'Unknown Do action')
    }),
  )
}
