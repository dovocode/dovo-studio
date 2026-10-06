import type { IncomingMessage } from 'node:http'
import { Effect } from 'effect'
import {
  decode,
  transferPrepareSchema,
  transferEnvelopeSchema,
  transferReceiptSchema,
  transferProofSchema,
  transferIdSchema,
  transferAbortSourceSchema,
  TRANSFER_MAX_BYTES,
} from '@dovo/protocol'
import { RuntimeServices } from '../../services.js'
import { taskTransfers } from '../../agents/transfer/task-transfer.js'
import { HttpError } from '../../errors.js'
import { body } from '../support/body.js'
import { routeProgram, serviceResult } from '../support/effect.js'

export function taskTransferRoute(request: IncomingMessage, path: string) {
  return routeProgram(
    Effect.gen(function* () {
      const services = yield* RuntimeServices
      const transfers = taskTransfers(services)
      if (path === '/api/tasks/transfer/options') return yield* serviceResult(transfers.options())
      const input = yield* serviceResult(
        body(request, path.endsWith('/stage') ? TRANSFER_MAX_BYTES : 16384),
      )
      switch (path) {
        case '/api/tasks/transfer/prepare':
          return yield* serviceResult(transfers.prepare(decode(transferPrepareSchema, input)))
        case '/api/tasks/transfer/stage':
          return yield* serviceResult(transfers.stage(decode(transferEnvelopeSchema, input)))
        case '/api/tasks/transfer/seal':
          return yield* serviceResult(transfers.seal(decode(transferReceiptSchema, input)))
        case '/api/tasks/transfer/activate':
          return yield* serviceResult(transfers.activate(decode(transferProofSchema, input)))
        case '/api/tasks/transfer/status':
          return transfers.status(decode(transferIdSchema, input).id)
        case '/api/tasks/transfer/read':
          return transfers.request(decode(transferIdSchema, input).id)
        case '/api/tasks/transfer/abort':
          return yield* serviceResult(transfers.abort(decode(transferProofSchema, input)))
        case '/api/tasks/transfer/begin-abort': {
          return yield* serviceResult(transfers.beginAbort(decode(transferPrepareSchema, input)))
        }
        case '/api/tasks/transfer/abort-source': {
          const { id, taskId } = decode(transferAbortSourceSchema, input)
          return yield* serviceResult(transfers.abortSource(id, taskId))
        }
        default:
          throw new HttpError(404, 'Transfer operation not found')
      }
    }),
  )
}
