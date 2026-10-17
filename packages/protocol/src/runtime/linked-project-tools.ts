import { Schema } from 'effect'
import { mutableStruct, minValue, maxValue } from '../shared/schema.js'
import { linkedCheckoutSchema } from '../workspace.js'

const id = maxValue(minValue(Schema.String, 1), 200)
export const linkedProjectsCommandSchema = Schema.Union([
  mutableStruct({ action: Schema.Literal('list') }),
  mutableStruct({ action: Schema.Literal('projects') }),
  mutableStruct({ action: Schema.Literal('worktrees'), repositoryId: id }),
  mutableStruct({ action: Schema.Literal('add'), checkout: linkedCheckoutSchema }),
])
export const linkedProjectsRequestSchema = mutableStruct({
  taskId: id,
  parentRunId: id,
  command: linkedProjectsCommandSchema,
})
