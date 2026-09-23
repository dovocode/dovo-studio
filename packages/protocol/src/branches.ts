import { mutableStruct, mutableArray } from './schema.js'
import { minValue, maxValue } from './schema.js'
import { Schema } from 'effect'
export const branchesSchema = mutableStruct({
  current: Schema.String,
  revision: Schema.String,
  branches: mutableArray(
    mutableStruct({
      name: Schema.String,
      ref: Schema.String,
      remote: Schema.Boolean,
      checkedOut: Schema.Boolean,
    }),
  ),
})
export const switchBranchSchema = mutableStruct({
  action: Schema.Literal('switch', 'create'),
  name: maxValue(minValue(Schema.String, 1), 250),
  revision: minValue(Schema.String, 1),
})
