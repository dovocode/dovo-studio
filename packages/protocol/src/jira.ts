import { mutableStruct, mutableArray } from './schema.js'
import { urlSchema, refine, minValue, maxValue } from './schema.js'
import { Schema } from 'effect'
export const jiraBindingSchema = mutableStruct({
  site: refine(
    urlSchema({
      protocol: /^https$/,
    }),
    (value) => {
      try {
        const url = new URL(value)
        return (
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash &&
          !url.port &&
          url.pathname === '/' &&
          url.hostname.endsWith('.atlassian.net')
        )
      } catch {
        return false
      }
    },
    'Use your Jira Cloud site URL, for example https://team.atlassian.net',
  ),
  project: Schema.String.pipe(Schema.compose(Schema.Trim))
    .pipe(Schema.compose(Schema.Uppercase))
    .pipe(Schema.pattern(/^[A-Z][A-Z0-9_]{1,49}$/)),
})
export type JiraBinding = Schema.Schema.Type<typeof jiraBindingSchema>
export const jiraProjectsSchema = mutableStruct({
  site: jiraBindingSchema.fields.site,
  projects: mutableArray(
    mutableStruct({
      key: jiraBindingSchema.fields.project,
      name: Schema.String,
    }),
  ),
  truncated: Schema.Boolean,
})
export type JiraProjects = Schema.Schema.Type<typeof jiraProjectsSchema>

/** A Jira namespace is an independent issue source, not a Dovo code project. */
export const jiraSourceSchema = mutableStruct({
  ...jiraBindingSchema.fields,
  ...{
    id: maxValue(minValue(Schema.String, 1), 200),
    name: Schema.optional(
      maxValue(minValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 1), 200),
    ),
  },
})
export type JiraSource = Schema.Schema.Type<typeof jiraSourceSchema>
export const jiraIssueLinkSchema = mutableStruct({
  sourceId: jiraSourceSchema.fields.id,
  issueId: maxValue(minValue(Schema.String, 1), 300),
  repositoryId: maxValue(minValue(Schema.String, 1), 200),
})
export type JiraIssueLink = Schema.Schema.Type<typeof jiraIssueLinkSchema>
