import { Schema, Effect } from 'effect'
import type { IncomingMessage } from 'node:http'
import {
  decode,
  mutableStruct,
  minValue,
  maxValue,
  localCommitTargetSchema,
  commitShaSchema,
} from '@dovo/protocol'
import { RuntimeServices } from '../../runtime-services.js'
import { HttpError } from '../../errors.js'
import { LocalCommits } from '../../scm/git/local-commits.js'
import { body } from '../support/body.js'
import { routeProgram, serviceResult } from '../support/effect.js'

export function localCommitRoute(request: IncomingMessage, path: string) {
  return routeProgram(
    Effect.gen(function* () {
      const s = yield* RuntimeServices
      if (request.method !== 'POST') throw new HttpError(405, 'Use POST for commit reads')
      const input = decode(
        mutableStruct({
          ...localCommitTargetSchema.fields,
          sha: Schema.optional(commitShaSchema),
          path: Schema.optional(maxValue(minValue(Schema.String, 1), 4000)),
          full: Schema.optional(Schema.Boolean),
          patch: Schema.optional(Schema.Boolean),
        }),
        yield* serviceResult(body(request, 16_000)),
      )
      const cwd = yield* serviceResult(s.checkouts.commitDirectory(input.id, input.checkoutId))
      if (!(yield* serviceResult(s.git.isRepository(cwd))))
        throw new HttpError(400, 'This project does not use Git')
      const commits = new LocalCommits(s.git)
      if (path === '/api/tasks/commits/read')
        return yield* serviceResult(commits.list(cwd, input.sha))
      if (!input.sha) throw new HttpError(400, 'Choose a commit')
      if (path === '/api/tasks/commits/changes')
        return yield* serviceResult(commits.changes(cwd, input.sha))
      if (path === '/api/tasks/commits/file-preview' && input.path)
        return yield* serviceResult(
          commits.preview(cwd, input.sha, input.path, input.full, input.patch),
        )
      throw new HttpError(404, 'Unknown commit read')
    }),
  )
}
