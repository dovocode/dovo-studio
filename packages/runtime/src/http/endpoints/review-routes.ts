import type { IncomingMessage } from 'node:http'
import { Effect } from 'effect'
import { decode, reviewOrganizeSchema, reviewReadSchema, reviewSetSchema } from '@dovo/protocol'
import { RuntimeServices } from '../../services.js'
import { body } from '../support/body.js'
import { routeProgram, serviceResult } from '../support/effect.js'
import { HttpError } from '../../errors.js'
export function reviewRoute(request: IncomingMessage, path: string) {
  return routeProgram(
    Effect.gen(function* () {
      const s = yield* RuntimeServices
      const input = yield* serviceResult(
        body(request, path === '/api/review/organize' ? 2_500_000 : 16_000),
      )
      if (request.method !== 'POST') throw new HttpError(405, 'Use POST for file review actions')
      if (path === '/api/review/organize') {
        const { context, selection, files } = decode(reviewOrganizeSchema, input)
        return yield* serviceResult(s.fileReviews.organize(context, selection, files, s.titles))
      }
      if (path === '/api/review/read')
        return yield* serviceResult(s.fileReviews.request(decode(reviewReadSchema, input).context))
      if (path === '/api/review/set') {
        const { context, ...mark } = decode(reviewSetSchema, input)
        return yield* serviceResult(s.fileReviews.request(context, mark))
      }
      throw new HttpError(404, 'Unknown file review action')
    }),
  )
}
