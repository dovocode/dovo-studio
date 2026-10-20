import type { IncomingMessage } from 'node:http'
import { Effect, Schema } from 'effect'
import {
  decode,
  mutableStruct,
  projectTransferStartSchema,
  projectTransferManifestSchema,
  projectTransferChunkSchema,
} from '@dovo/protocol'
import { HttpError } from '../../errors.js'
import { RuntimeServices } from '../../services.js'
import { body } from '../support/body.js'
import { routeProgram, serviceResult } from '../support/effect.js'

const idSchema = mutableStruct({ id: Schema.String })
export function projectTransferRoute(
  request: IncomingMessage,
  path: string,
  device: string,
  token: string,
) {
  return routeProgram(
    Effect.gen(function* () {
      const s = yield* RuntimeServices
      const transfers = s.projectTransfers
      if (request.method !== 'POST') throw new HttpError(405, 'Use POST for project copies')
      const input = yield* serviceResult(body(request))
      switch (path.slice('/api/scm/project-transfer/'.length)) {
        case 'targets':
          return transfers.targets()
        case 'inspect':
          return yield* serviceResult(
            transfers.inspect(
              decode(mutableStruct({ repositoryId: Schema.String }), input).repositoryId,
            ),
          )
        case 'start':
          return transfers.start(decode(projectTransferStartSchema, input), device, () => {
            s.devices.authenticate(token)
          })
        case 'cancel':
          return yield* serviceResult(transfers.cancel(decode(idSchema, input).id))
        case 'retry':
          return transfers.retry(decode(idSchema, input).id, () => {
            s.devices.authenticate(token)
          })
        case 'begin':
          return yield* serviceResult(
            transfers.begin(decode(projectTransferManifestSchema, input), device),
          )
        case 'chunk':
          return yield* serviceResult(
            transfers.chunk(decode(projectTransferChunkSchema, input), device),
          )
        case 'commit':
          return yield* serviceResult(
            transfers.commit(decode(idSchema, input).id, device, () => {
              s.devices.authenticate(token)
            }),
          )
        case 'status':
          return transfers.status(decode(idSchema, input).id, device)
        case 'discard':
          return yield* serviceResult(transfers.discard(decode(idSchema, input).id, device))
        default:
          throw new HttpError(404, 'Unknown project copy operation')
      }
    }),
  )
}
