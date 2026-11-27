import { Schema } from 'effect'
import {
  maxValue,
  minValue,
  mutableArray,
  mutableStruct,
  strictStruct,
  uuidSchema,
} from '../../shared/schema.js'

const id = maxValue(minValue(Schema.String, 1), 200)
const name = minValue(maxValue(Schema.Trim, 80), 1)
const team = maxValue(Schema.Trim, 40).check(Schema.isPattern(/^[a-z][a-z0-9_]*$/i))
const linearConnectionSchema = mutableStruct({ id: uuidSchema, name, revision: uuidSchema })
const linearBindingSchema = mutableStruct({
  repositoryId: id,
  connectionId: uuidSchema,
  team,
  revision: uuidSchema,
})
export const linearConnectionsSchema = mutableStruct({
  connections: maxValue(mutableArray(linearConnectionSchema), 20),
  bindings: maxValue(mutableArray(linearBindingSchema), 100),
})
export type LinearConnections = typeof linearConnectionsSchema.Type
export const linearConnectionCommandSchema = Schema.Union([
  strictStruct({
    action: Schema.Literal('save'),
    id: uuidSchema,
    name,
    key: Schema.String,
    expectedRevision: Schema.optional(uuidSchema),
  }),
  strictStruct({ action: Schema.Literal('remove'), id: uuidSchema, expectedRevision: uuidSchema }),
  strictStruct({
    action: Schema.Literal('bind'),
    repositoryId: id,
    connectionId: uuidSchema,
    team,
    expectedRevision: Schema.optional(uuidSchema),
  }),
  strictStruct({
    action: Schema.Literal('unbind'),
    repositoryId: id,
    expectedRevision: uuidSchema,
  }),
])
export type LinearConnectionCommand = typeof linearConnectionCommandSchema.Type

export const linearIssueQuerySchema = strictStruct({
  cursor: Schema.optional(maxValue(Schema.String, 1000)),
  search: Schema.optional(maxValue(Schema.String, 200)),
  connectionId: Schema.optional(uuidSchema),
  repositoryId: Schema.optional(id),
})

export function linearIssueSources(
  state: LinearConnections | undefined,
  repositories: readonly { id: string; name: string }[],
  hasDefault: boolean,
) {
  return [
    ...(hasDefault ? [{ id: 'default', name: 'Default Linear connection', input: {} }] : []),
    ...(state?.connections.map(({ id, name, revision }) => ({
      id: `connection:${id}:${revision}`,
      name,
      input: { connectionId: id },
    })) ?? []),
    ...(state?.bindings.flatMap((binding) => {
      const project = repositories.find((item) => item.id === binding.repositoryId)
      const connection = state.connections.find((item) => item.id === binding.connectionId)
      return project && connection
        ? [
            {
              id: `project:${binding.repositoryId}:${binding.revision}:${connection.revision}`,
              name: `${project.name} · ${binding.team}`,
              input: { repositoryId: binding.repositoryId },
            },
          ]
        : []
    }) ?? []),
  ]
}

const linearIssueSchema = mutableStruct({
  id: Schema.String,
  identifier: Schema.String,
  title: Schema.String,
  url: Schema.String,
  description: Schema.String,
  status: Schema.String,
})

export const linearIssuesSchema = mutableStruct({
  items: mutableArray(linearIssueSchema),
  next: Schema.optional(Schema.String),
})
export type LinearIssue = typeof linearIssueSchema.Type

const linearIssueTarget = {
  connectionId: Schema.optional(uuidSchema),
  repositoryId: Schema.optional(id),
  issueId: uuidSchema,
}
export const linearIssueActionsQuerySchema = strictStruct(linearIssueTarget)
const issueVersion = maxValue(minValue(Schema.String, 64), 64)
export const linearIssueActionSchema = Schema.Union([
  strictStruct({
    ...linearIssueTarget,
    sourceVersion: issueVersion,
    action: Schema.Literal('set-status'),
    expectedStateId: uuidSchema,
    stateId: uuidSchema,
  }),
  strictStruct({
    ...linearIssueTarget,
    sourceVersion: issueVersion,
    action: Schema.Literal('comment'),
    commentId: uuidSchema,
    body: maxValue(minValue(Schema.Trim, 1), 12000),
  }),
])
const linearIssueState = mutableStruct({ id: uuidSchema, name: Schema.String })
const linearIssueComment = mutableStruct({
  id: uuidSchema,
  body: Schema.String,
  author: Schema.String,
})
export const linearIssueActionsSchema = mutableStruct({
  sourceVersion: issueVersion,
  state: linearIssueState,
  states: mutableArray(linearIssueState),
  comments: mutableArray(linearIssueComment),
})
export type LinearIssueAction = typeof linearIssueActionSchema.Type
export type LinearIssueActions = typeof linearIssueActionsSchema.Type

export const linearKeySourceSchema = Schema.Literals(['none', 'saved', 'environment'])
export const linearKeyResultSchema = mutableStruct({ source: linearKeySourceSchema })
