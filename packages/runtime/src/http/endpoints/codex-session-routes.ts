import { Effect } from 'effect'
import type { IncomingMessage } from 'node:http'
import {
  decode,
  codexSessionDiscoverySchema,
  codexSessionSelectionSchema,
  codexSessionImportSchema,
} from '@dovo/protocol'
import { RuntimeServices } from '../../runtime-services.js'
import { HttpError } from '../../errors.js'
import { CodexSessionImports } from '../../agents/providers/codex/session-import.js'
import { body } from '../support/body.js'
import { routeProgram, serviceResult } from '../support/effect.js'

export function codexSessionRoute(request: IncomingMessage, path: string) {
  return routeProgram(
    Effect.gen(function* () {
      const s = yield* RuntimeServices
      if (request.method !== 'POST') throw new HttpError(405, 'Use POST for Codex session imports')
      const importer = new CodexSessionImports(s.store, s.agents, s.git)
      const input = yield* serviceResult(body(request, 16000))
      if (path === '/api/tasks/codex-sessions/list')
        return yield* serviceResult(importer.list(decode(codexSessionDiscoverySchema, input)))
      if (path === '/api/tasks/codex-sessions/preview')
        return yield* serviceResult(importer.preview(decode(codexSessionSelectionSchema, input)))
      if (path === '/api/tasks/codex-sessions/import')
        return yield* serviceResult(importer.import(decode(codexSessionImportSchema, input)))
      throw new HttpError(404, 'Unknown Codex session operation')
    }),
  )
}
