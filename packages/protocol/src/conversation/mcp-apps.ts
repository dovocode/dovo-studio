import { Schema } from 'effect'
import { mutableArray, mutableStruct, decodeResult, uuidSchema } from '../shared/schema.js'
export const mcpAppReferenceSchema = mutableStruct({
  id: Schema.String,
  taskId: Schema.String,
  title: Schema.String,
  revision: Schema.optional(Schema.Number),
})
export type McpAppReference = Schema.Schema.Type<typeof mcpAppReferenceSchema>
export const mcpAppSchema = mutableStruct({
  ...mcpAppReferenceSchema.fields,
  server: Schema.String,
  tool: Schema.String,
  input: Schema.Unknown,
  result: Schema.Unknown,
  resource: Schema.Unknown,
  format: Schema.Literals(['apps', 'legacy']),
  connected: Schema.Boolean,
})
export type McpApp = Schema.Schema.Type<typeof mcpAppSchema>
export const mcpAppResponseSchema = mutableStruct({ app: mcpAppSchema })
export const mcpAppRpcResponseSchema = mutableStruct({ result: Schema.Unknown })
export const mcpAppRpcSchema = mutableStruct({
  taskId: uuidSchema,
  id: uuidSchema,
  requestId: Schema.String,
  method: Schema.String,
  params: Schema.optional(Schema.Unknown),
})
export function mcpAppReferences(payload: unknown): McpAppReference[] {
  try {
    return (
      decodeResult(
        mutableStruct({ mcpApps: mutableArray(mcpAppReferenceSchema) }),
        typeof payload === 'string' ? JSON.parse(payload) : payload,
      ).data?.mcpApps ?? []
    )
  } catch {
    return []
  }
}
