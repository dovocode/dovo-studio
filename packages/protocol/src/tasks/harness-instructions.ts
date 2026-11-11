import { Schema } from 'effect'
import { mutableArray, mutableStruct, minValue, maxValue } from '../shared/schema.js'
import { providerSchema } from '../workspace.js'

export const harnessInstructionFileSchema = mutableStruct({
  id: Schema.String,
  provider: providerSchema,
  name: Schema.String,
  path: Schema.String,
  profiles: mutableArray(Schema.String),
  description: Schema.String,
})
export const harnessInstructionFilesSchema = mutableStruct({
  files: mutableArray(harnessInstructionFileSchema),
  notices: mutableArray(Schema.String),
})
export const harnessInstructionSelectionSchema = mutableStruct({
  id: maxValue(minValue(Schema.String, 1), 100),
})
export const harnessInstructionEditSchema = mutableStruct({
  ...harnessInstructionSelectionSchema.fields,
  version: maxValue(minValue(Schema.String, 1), 100),
  text: maxValue(Schema.String, 200_000),
})
export const harnessInstructionReadSchema = mutableStruct({
  text: Schema.String,
  version: Schema.String,
  exists: Schema.Boolean,
  resolvedPath: Schema.String,
})
export const harnessInstructionPreviewSchema = mutableStruct({
  diff: Schema.String,
  changed: Schema.Boolean,
})
export const harnessInstructionSaveSchema = mutableStruct({ version: Schema.String })
export type HarnessInstructionFile = typeof harnessInstructionFileSchema.Type
export type HarnessInstructionSelection = typeof harnessInstructionSelectionSchema.Type
export type HarnessInstructionEdit = typeof harnessInstructionEditSchema.Type
export type HarnessInstructionRead = typeof harnessInstructionReadSchema.Type
