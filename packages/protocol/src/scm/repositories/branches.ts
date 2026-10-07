import { mutableStruct, mutableArray } from '../../shared/schema.js'
import { minValue, maxValue } from '../../shared/schema.js'
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
  /** origin's default branch (`refs/remotes/origin/HEAD` target), when known. */
  originDefault: Schema.optional(Schema.String),
})
export const switchBranchSchema = mutableStruct({
  action: Schema.Literals(['switch', 'create']),
  name: maxValue(minValue(Schema.String, 1), 250),
  revision: minValue(Schema.String, 1),
})
