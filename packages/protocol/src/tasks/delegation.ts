import { Schema } from 'effect'
import { mutableStruct, maxValue, minValue } from '../shared/schema.js'
import { agentSchema, providerSchema } from '../workspace.js'
const id = maxValue(minValue(Schema.String, 1), 200)
export const subagentScopeSchema = mutableStruct({ taskId: id, parentRunId: Schema.optional(id) })
export const subagentSpawnSchema = mutableStruct({
  ...subagentScopeSchema.fields,
  checkoutId: Schema.optional(id),
  key: maxValue(minValue(Schema.String, 1), 100),
  name: maxValue(minValue(Schema.String, 1), 100),
  prompt: maxValue(minValue(Schema.String, 1), 20000),
  agentId: Schema.optional(id),
  provider: Schema.optional(providerSchema),
  model: Schema.optional(maxValue(Schema.String, 500)),
  reasoning: Schema.optional(maxValue(Schema.String, 100)),
  permission: Schema.optional(agentSchema.fields.permission),
})
export type SubagentSpawn = Schema.Schema.Type<typeof subagentSpawnSchema>
export const subagentReadSchema = mutableStruct({
  ...subagentScopeSchema.fields,
  id,
  timeoutMs: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.between(0, 20000))),
})
/** Never grant a child wider access than its parent, even when selecting a saved preset. */
export function delegatedAccess(
  parent: (typeof agentSchema.Type)['permission'],
  requested: (typeof agentSchema.Type)['permission'],
) {
  const allowed = {
    'read-only': ['read-only'],
    ask: ['read-only', 'ask'],
    'workspace-write': ['read-only', 'ask', 'workspace-write'],
    auto: ['read-only', 'ask', 'workspace-write', 'auto'],
    'full-access': ['read-only', 'ask', 'workspace-write', 'auto', 'full-access'],
  }
  return allowed[parent].includes(requested) ? requested : parent
}
