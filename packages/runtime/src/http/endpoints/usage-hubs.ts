import { Effect, Schema } from 'effect'
import { decode, usageHubInputSchema, mutableStruct, type UsageHubInput } from '@dovo/protocol'
import type { IncomingMessage } from 'node:http'
import { RuntimeServices } from '../../runtime-services.js'
import { HttpError } from '../../errors.js'
import { body } from '../support/body.js'
import { serviceResult } from '../support/effect.js'
export const usageHubs = (request: IncomingMessage, path: string) =>
  Effect.gen(function* () {
    const s = yield* RuntimeServices
    if (path.endsWith('/read')) return s.store.usageHubs.list()
    const raw = yield* serviceResult(body(request))
    if (path.endsWith('/write')) {
      // Schema errors must not echo a submitted management key.
      let input: UsageHubInput
      try {
        input = decode(usageHubInputSchema, raw)
      } catch {
        throw new HttpError(400, 'Enter a hub name, HTTP(S) URL and management key.')
      }
      s.store.usageHubs.save(input)
    } else {
      const { id } = decode(mutableStruct({ id: Schema.String }), raw)
      s.store.usageHubs.remove(id)
    }
    return s.store.usageHubs.list()
  })
