import { repositoryOpenTargetSchema } from '../../scm/repositories/repository-tools.js'
import { Schema } from 'effect'
import { mutableStruct, minValue, maxValue } from '../../shared/schema.js'
export const taskFileRequestSchema = mutableStruct({
  taskId: maxValue(minValue(Schema.String, 1), 200),
  path: maxValue(minValue(Schema.String, 1), 4000),
})
export const taskFileShareSchema = mutableStruct({ url: Schema.String })

export const taskFileOpenSchema = mutableStruct({
  ...taskFileRequestSchema.fields,
  target: repositoryOpenTargetSchema,
})
