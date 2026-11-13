import { Schema } from 'effect'
import { managedSkillSchema } from '../shared/resources.js'
import { maxValue, minValue, mutableStruct, uuidSchema } from '../shared/schema.js'
export const botSkillProposalInputSchema = mutableStruct({
  key: maxValue(minValue(Schema.String, 1), 120),
  sourceTaskId: uuidSchema,
  sourceTurnId: uuidSchema,
  name: managedSkillSchema.fields.name,
  description: managedSkillSchema.fields.description,
  content: maxValue(minValue(Schema.String, 1), 16000),
})
export const botSkillProposalSchema = mutableStruct({
  id: uuidSchema,
  sourceTaskId: uuidSchema,
  sourceTurnId: uuidSchema,
  skill: managedSkillSchema,
  before: Schema.optional(managedSkillSchema),
  patch: maxValue(Schema.String, 40000),
  status: Schema.Literals(['pending', 'applied', 'rejected']),
  createdAt: Schema.String,
})
export const botSkillDecisionSchema = mutableStruct({
  id: uuidSchema,
  proposalId: uuidSchema,
  expectedRevision: uuidSchema,
  accept: Schema.Boolean,
})
