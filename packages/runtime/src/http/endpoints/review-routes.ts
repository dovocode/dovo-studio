import type { IncomingMessage } from 'node:http'
import { Effect } from 'effect'
import {
  decode,
  reviewOrganizeSchema,
  reviewReadSchema,
  reviewSetSchema,
  reviewGuideSetSchema,
  taskReviewReadSchema,
  taskReviewStartSchema,
  taskReviewFindingSchema,
  taskReviewFixSchema,
  taskReviewChangesSchema,
  taskReviewApprovalSchema,
} from '@dovo/protocol'
import { RuntimeServices } from '../../runtime-services.js'
import { body } from '../support/body.js'
import { routeProgram, serviceResult } from '../support/effect.js'
import { HttpError } from '../../errors.js'
export function reviewRoute(request: IncomingMessage, path: string) {
  return routeProgram(
    Effect.gen(function* () {
      const s = yield* RuntimeServices
      if (
        path.startsWith('/api/review/task/') &&
        path !== '/api/review/task/stop' &&
        !s.preferences.get().enableCodeReviews
      )
        throw new HttpError(403, 'Enable experimental code reviews in computer settings first.')
      const input = yield* serviceResult(
        body(request, path === '/api/review/organize' ? 2_500_000 : 16_000),
      )
      if (request.method !== 'POST') throw new HttpError(405, 'Use POST for file review actions')
      if (path === '/api/review/task/read')
        return yield* serviceResult(s.taskReviews.read(decode(taskReviewReadSchema, input).taskId))
      if (path === '/api/review/task/start') {
        const { taskId, requestId, agentId, scope } = decode(taskReviewStartSchema, input)
        return yield* serviceResult(s.taskReviews.start(taskId, requestId, agentId, scope))
      }
      if (path === '/api/review/task/finding') {
        const { taskId, reviewId, findingId, status, resolution } = decode(
          taskReviewFindingSchema,
          input,
        )
        return yield* serviceResult(
          s.taskReviews.finding(taskId, reviewId, findingId, status, resolution),
        )
      }
      if (path === '/api/review/task/fix') {
        const { taskId, reviewId, findingIds, messageId } = decode(taskReviewFixSchema, input)
        return yield* serviceResult(s.taskReviews.fix(taskId, reviewId, findingIds, messageId))
      }
      if (path === '/api/review/task/approve') {
        const { taskId, reviewId, approved } = decode(taskReviewApprovalSchema, input)
        return yield* serviceResult(s.taskReviews.approve(taskId, reviewId, approved))
      }
      if (path === '/api/review/task/changes' || path === '/api/review/task/stop') {
        const { taskId, reviewId } = decode(taskReviewChangesSchema, input)
        return yield* serviceResult(
          path.endsWith('/stop')
            ? s.taskReviews.stop(taskId, reviewId)
            : s.taskReviews.changes(taskId, reviewId),
        )
      }
      if (path === '/api/review/organize') {
        const { context, selection, files, guided, revision } = decode(reviewOrganizeSchema, input)
        return yield* serviceResult(
          s.fileReviews.organize(context, selection, files, s.titles, guided, revision),
        )
      }
      if (path === '/api/review/guide') {
        const { context, move, knownGuide } = decode(reviewGuideSetSchema, input)
        return yield* serviceResult(s.fileReviews.request(context, undefined, { move }, knownGuide))
      }
      if (path === '/api/review/read') {
        const { context, knownGuide } = decode(reviewReadSchema, input)
        return yield* serviceResult(
          s.fileReviews.request(context, undefined, undefined, knownGuide),
        )
      }
      if (path === '/api/review/set') {
        const { context, knownGuide, ...mark } = decode(reviewSetSchema, input)
        return yield* serviceResult(s.fileReviews.request(context, mark, undefined, knownGuide))
      }
      throw new HttpError(404, 'Unknown file review action')
    }),
  )
}
