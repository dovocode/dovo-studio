import { Schema } from 'effect'
import { strictStruct, minValue, maxValue, mutableArray } from '../shared/schema.js'
import { workflowPhaseSchema } from '../conversation/workflow/workflows.js'

const id = maxValue(minValue(Schema.String, 1), 200)
export const workflowCommandSchema = Schema.Union([
  strictStruct({ action: Schema.Literal('list') }),
  strictStruct({ action: Schema.Literal('read'), id }),
  strictStruct({
    action: Schema.Literal('create'),
    id,
    name: maxValue(minValue(Schema.String, 1), 200),
    description: Schema.optional(maxValue(Schema.String, 2000)),
    phases: maxValue(minValue(mutableArray(workflowPhaseSchema), 1), 50),
  }),
  strictStruct({ action: Schema.Literal('attach'), id, phaseId: id, childId: id }),
])
export type WorkflowCommand = typeof workflowCommandSchema.Type
