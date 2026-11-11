import { Effect } from 'effect'
import type { IncomingMessage } from 'node:http'
import {
  decode,
  harnessInstructionSelectionSchema,
  harnessInstructionEditSchema,
} from '@dovo/protocol'
import { HarnessInstructions } from '../../agents/configuration/harness-instructions.js'
import { RuntimeServices } from '../../runtime-services.js'
import { HttpError } from '../../errors.js'
import { body } from '../support/body.js'
import { routeProgram, serviceResult } from '../support/effect.js'

export function harnessInstructionRoute(request: IncomingMessage, path: string) {
  return routeProgram(
    Effect.gen(function* () {
      if (request.method !== 'POST') throw new HttpError(405, 'Use POST for harness instructions.')
      const services = yield* RuntimeServices
      const files = new HarnessInstructions(services.store, services.agents)
      if (path === '/api/agents/instructions/list') return yield* serviceResult(files.list())
      const input = yield* serviceResult(body(request, 2 * 1024 * 1024))
      if (path === '/api/agents/instructions/read')
        return yield* serviceResult(files.read(decode(harnessInstructionSelectionSchema, input)))
      if (path === '/api/agents/instructions/preview')
        return yield* serviceResult(files.preview(decode(harnessInstructionEditSchema, input)))
      if (path === '/api/agents/instructions/save')
        return yield* serviceResult(files.save(decode(harnessInstructionEditSchema, input)))
      throw new HttpError(404, 'Unknown harness instruction operation.')
    }),
  )
}
