import { Effect } from 'effect'
import type { IncomingMessage } from 'node:http'
import { dirname, basename, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import {
  decode,
  codexSessionDiscoverySchema,
  codexSessionSelectionSchema,
  codexSessionImportSchema,
} from '@dovo/protocol'
import { RuntimeServices } from '../../runtime-services.js'
import { HttpError } from '../../errors.js'
import { CodexSessionImports } from '../../agents/providers/codex/session-import.js'
import { PiSessionImports } from '../../agents/providers/pi/session-import.js'
import { body } from '../support/body.js'
import { routeProgram, serviceResult } from '../support/effect.js'

const memoryDirectories = new WeakMap<object, string>()
function piStorage(db: { name: string }) {
  if (db.name !== ':memory:') {
    const file = resolve(db.name)
    return join(dirname(file), `${basename(file)}.pi-sessions`)
  }
  let directory = memoryDirectories.get(db)
  if (!directory) {
    directory = join(tmpdir(), `dovo-pi-${randomUUID()}`)
    memoryDirectories.set(db, directory)
  }
  return directory
}

export function codexSessionRoute(request: IncomingMessage, path: string) {
  return routeProgram(
    Effect.gen(function* () {
      const s = yield* RuntimeServices
      if (request.method !== 'POST') throw new HttpError(405, 'Use POST for Codex session imports')
      const pi = path.startsWith('/api/tasks/pi-sessions/')
      const importer = pi
        ? new PiSessionImports(s.store, s.agents, s.git, piStorage(s.db))
        : new CodexSessionImports(s.store, s.agents, s.git)
      const input = yield* serviceResult(body(request, 16000))
      if (path === `/api/tasks/${pi ? 'pi' : 'codex'}-sessions/list`)
        return yield* serviceResult(importer.list(decode(codexSessionDiscoverySchema, input)))
      if (path === `/api/tasks/${pi ? 'pi' : 'codex'}-sessions/preview`)
        return yield* serviceResult(importer.preview(decode(codexSessionSelectionSchema, input)))
      if (path === `/api/tasks/${pi ? 'pi' : 'codex'}-sessions/import`)
        return yield* serviceResult(importer.import(decode(codexSessionImportSchema, input)))
      throw new HttpError(404, 'Unknown Codex session operation')
    }),
  )
}
