import { mutableArray, mutableStruct } from './schema.js'
import { maxValue, urlSchema, superRefine, minValue } from './schema.js'
import { Schema } from 'effect'
const name = Schema.String.pipe(Schema.compose(Schema.Trim)).pipe(
  Schema.pattern(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/),
)
const environmentName = Schema.String.pipe(Schema.pattern(/^[A-Za-z_][A-Za-z0-9_]*$/))
export const mcpServerSchema = superRefine(
  mutableStruct({
    name,
    enabled: Schema.Boolean,
    transport: Schema.Literal('stdio', 'http'),
    command: Schema.optionalWith(maxValue(Schema.String, 2000), {
      default: () => '',
    }),
    args: Schema.optionalWith(maxValue(mutableArray(maxValue(Schema.String, 4000)), 100), {
      default: () => [],
    }),
    url: Schema.optionalWith(maxValue(Schema.String, 4000), {
      default: () => '',
    }),
    env: Schema.optionalWith(
      Schema.mutable(
        Schema.Record({
          key: environmentName,
          value: environmentName,
        }),
      ),
      {
        default: () => ({}),
      },
    ),
    bearerTokenEnv: Schema.optionalWith(Schema.Union(Schema.Literal(''), environmentName), {
      default: () => '',
    }),
    envValues: Schema.optional(
      Schema.mutable(
        Schema.Record({
          key: environmentName,
          value: maxValue(Schema.String, 4000),
        }),
      ),
    ),
    headerValues: Schema.optional(
      Schema.mutable(
        Schema.Record({
          key: Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9-]+$/)),
          value: maxValue(Schema.String, 4000),
        }),
      ),
    ),
    sourceUrl: Schema.optional(urlSchema()),
    sourceRevision: Schema.optional(maxValue(Schema.String, 200)),
    headerEnv: Schema.optionalWith(
      Schema.mutable(
        Schema.Record({
          key: Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9-]+$/)),
          value: environmentName,
        }),
      ),
      {
        default: () => ({}),
      },
    ),
  }),
  (server, context) => {
    if (server.transport === 'stdio' && !server.command.trim())
      context.addIssue({
        code: 'custom',
        path: ['command'],
        message: 'Enter an executable',
      })
    if (server.transport === 'http') {
      try {
        const url = new URL(server.url)
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
          throw new Error()
      } catch {
        context.addIssue({
          code: 'custom',
          path: ['url'],
          message: 'Enter an HTTP(S) URL without embedded credentials',
        })
      }
    }
  },
)
export const managedSkillSchema = mutableStruct({
  name,
  description: maxValue(minValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 1), 2000),
  enabled: Schema.Boolean,
  content: maxValue(minValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 1), 64000),
  sourceUrl: Schema.optional(urlSchema()),
  sourceRevision: Schema.optional(maxValue(Schema.String, 200)),
  sourcePath: Schema.optional(maxValue(Schema.String, 4000)),
})
export const resourceSettingsSchema = superRefine(
  mutableStruct({
    mcpServers: Schema.optionalWith(maxValue(mutableArray(mcpServerSchema), 30), {
      default: () => [],
    }),
    skills: Schema.optionalWith(maxValue(mutableArray(managedSkillSchema), 20), {
      default: () => [],
    }),
  }),
  (settings, context) => {
    for (const key of ['mcpServers', 'skills'] as const)
      if (new Set(settings[key].map((item) => item.name)).size !== settings[key].length)
        context.addIssue({
          code: 'custom',
          path: [key],
          message: 'Names must be unique within this scope',
        })
    if (settings.skills.reduce((size, skill) => size + skill.content.length, 0) > 200000)
      context.addIssue({
        code: 'custom',
        path: ['skills'],
        message: 'Skills exceed the 200 KB limit for this scope',
      })
  },
)
export const mcpTestResultSchema = mutableStruct({
  tools: mutableArray(Schema.String),
  server: Schema.String,
})
export type McpServer = Schema.Schema.Type<typeof mcpServerSchema>
export type ManagedSkill = Schema.Schema.Type<typeof managedSkillSchema>
export type ResourceSettings = Schema.Schema.Type<typeof resourceSettingsSchema>
export function mergeResources(
  project?: ResourceSettings,
  agent?: ResourceSettings,
): ResourceSettings {
  return {
    mcpServers: [
      ...new Map(
        [...(project?.mcpServers ?? []), ...(agent?.mcpServers ?? [])].map((server) => [
          server.name,
          server,
        ]),
      ).values(),
    ],
    skills: [
      ...new Map(
        [...(project?.skills ?? []), ...(agent?.skills ?? [])].map((skill) => [skill.name, skill]),
      ).values(),
    ],
  }
}
