import { Schema } from 'effect'
import { mutableStruct, mutableArray, minValue, maxValue } from './schema.js'
export const repositoryFolderSchema = mutableStruct({
  path: minValue(Schema.String, 1),
})
export const repositoryGitStatusSchema = mutableStruct({
  initialized: Schema.Boolean,
  remotes: mutableArray(Schema.String),
})
export const createGithubRepositorySchema = mutableStruct({
  ...repositoryFolderSchema.fields,
  name: maxValue(
    Schema.String.pipe(
      Schema.pattern(/^[A-Za-z0-9][A-Za-z0-9_.-]*(\/[A-Za-z0-9][A-Za-z0-9_.-]*)?$/),
    ),
    200,
  ),
  visibility: Schema.Literal('private', 'public'),
})
export const openRepositorySchema = mutableStruct({
  target: Schema.Literal('finder', 'vscode', 'cursor'),
})
