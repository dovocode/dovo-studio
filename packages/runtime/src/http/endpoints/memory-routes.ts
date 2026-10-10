import type { IncomingMessage } from 'node:http'
import { Schema, Effect } from 'effect'
import {
  decode,
  strictStruct,
  memoryConfigureSchema,
  memoryDeleteSchema,
  memoryListRequestSchema,
  memoryReadSchema,
  memoryMetadataSchema,
  memoryScopeSchema,
  memoryWriteSchema,
} from '@dovo/protocol'
import { RuntimeServices } from '../../services.js'
import { HttpError } from '../../errors.js'
import { body } from '../support/body.js'
import { routeProgram, serviceResult } from '../support/effect.js'

export function memoryRoute(request: IncomingMessage, path: string, owner: boolean) {
  return routeProgram(
    Effect.gen(function* () {
      const s = yield* RuntimeServices
      const input = yield* serviceResult(body(request, 100_000))
      if (path === '/api/memory/projects/read') return s.memory.projects()
      if (path === '/api/memory/settings/read') return s.memory.settings()
      if (path === '/api/memory/settings/save')
        return s.memory.configure(decode(memoryConfigureSchema, input))
      if (path.startsWith('/api/memory/agent/')) {
        if (!owner) throw new HttpError(403, 'Agent memory access requires the runtime owner token')
        const base = { taskId: Schema.String, scope: memoryScopeSchema }
        const operation = path.slice('/api/memory/agent/'.length)
        if (operation === 'list') {
          const value = decode(
            strictStruct({
              ...base,
              query: memoryListRequestSchema.fields.query,
              offset: memoryListRequestSchema.fields.offset,
            }),
            input,
          )
          const scope = s.memory.agentScope(value.taskId, value.scope)
          const result = s.memory.list({ ...scope, query: value.query, offset: value.offset })
          return {
            ...result,
            entries: result.entries.map((entry) => decode(memoryMetadataSchema, entry)),
          }
        }
        if (operation === 'read') {
          const value = decode(strictStruct({ ...base, key: memoryReadSchema.fields.key }), input)
          return {
            memory: s.memory.read({
              ...s.memory.agentScope(value.taskId, value.scope),
              key: value.key,
            }),
          }
        }
        if (operation === 'write') {
          const value = decode(
            strictStruct({
              ...base,
              key: memoryWriteSchema.fields.key,
              content: memoryWriteSchema.fields.content,
              expectedRevision: memoryWriteSchema.fields.expectedRevision,
            }),
            input,
          )
          return {
            memory: s.memory.write({
              ...value,
              ...s.memory.agentScope(value.taskId, value.scope, true),
            }),
          }
        }
        if (operation === 'delete') {
          const value = decode(
            strictStruct({
              ...base,
              key: memoryDeleteSchema.fields.key,
              expectedRevision: memoryDeleteSchema.fields.expectedRevision,
            }),
            input,
          )
          return s.memory.remove({
            ...value,
            ...s.memory.agentScope(value.taskId, value.scope, true),
          })
        }
      }
      if (path === '/api/memory/list') return s.memory.list(decode(memoryListRequestSchema, input))
      if (path === '/api/memory/read')
        return { memory: s.memory.read(decode(memoryReadSchema, input)) }
      if (path === '/api/memory/write')
        return { memory: s.memory.write(decode(memoryWriteSchema, input)) }
      if (path === '/api/memory/delete') return s.memory.remove(decode(memoryDeleteSchema, input))
      throw new HttpError(404, 'Unknown memory action')
    }),
  )
}
