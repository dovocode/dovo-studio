import { mutableArray, mutableStruct } from './schema.js'
import { maxValue, urlSchema, superRefine, minValue } from './schema.js'
import { Schema, Effect } from 'effect'
const name = Schema.String.pipe(Schema.decodeTo(Schema.Trim)).pipe(
  Schema.check(Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/)),
)
const environmentName = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_]*$/)),
)
export const mcpServerSchema = superRefine(
  mutableStruct({
    name,
    enabled: Schema.Boolean,
    transport: Schema.Literals(['stdio', 'http']),
    command: maxValue(Schema.String, 2000).pipe(
      Schema.withDecodingDefaultType(Effect.sync(() => '')),
    ),
    args: maxValue(mutableArray(maxValue(Schema.String, 4000)), 100).pipe(
      Schema.withDecodingDefaultType(Effect.sync(() => [])),
    ),
    url: maxValue(Schema.String, 4000).pipe(Schema.withDecodingDefaultType(Effect.sync(() => ''))),
    env: Schema.Record(environmentName, Schema.mutableKey(environmentName)).pipe(
      Schema.withDecodingDefaultType(Effect.sync(() => ({}))),
    ),
    bearerTokenEnv: Schema.Union([Schema.Literal(''), environmentName]).pipe(
      Schema.withDecodingDefaultType(Effect.sync(() => '')),
    ),
    envValues: Schema.optional(
      Schema.Record(environmentName, Schema.mutableKey(maxValue(Schema.String, 4000))),
    ),
    headerValues: Schema.optional(
      Schema.Record(
        Schema.String.pipe(Schema.check(Schema.isPattern(/^[A-Za-z0-9-]+$/))),
        Schema.mutableKey(maxValue(Schema.String, 4000)),
      ),
    ),
    sourceUrl: Schema.optional(urlSchema()),
    sourceRevision: Schema.optional(maxValue(Schema.String, 200)),
    headerEnv: Schema.Record(
      Schema.String.pipe(Schema.check(Schema.isPattern(/^[A-Za-z0-9-]+$/))),
      Schema.mutableKey(environmentName),
    ).pipe(Schema.withDecodingDefaultType(Effect.sync(() => ({})))),
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
  description: maxValue(minValue(Schema.String.pipe(Schema.decodeTo(Schema.Trim)), 1), 2000),
  enabled: Schema.Boolean,
  content: maxValue(minValue(Schema.String.pipe(Schema.decodeTo(Schema.Trim)), 1), 64000),
  sourceUrl: Schema.optional(urlSchema()),
  sourceRevision: Schema.optional(maxValue(Schema.String, 200)),
  sourcePath: Schema.optional(maxValue(Schema.String, 4000)),
})
export const agentHookSchema = mutableStruct({
  name,
  enabled: Schema.Boolean,
  event: Schema.Literals(['before-turn', 'after-turn']),
  command: maxValue(minValue(Schema.String.pipe(Schema.decodeTo(Schema.Trim)), 1), 4000),
  timeoutSeconds: Schema.Number.pipe(
    Schema.check(Schema.isInt()),
    Schema.check(Schema.isBetween({ minimum: 1, maximum: 600 })),
  ),
})
export type AgentHook = Schema.Schema.Type<typeof agentHookSchema>
export const resourceSettingsSchema = superRefine(
  mutableStruct({
    hooks: Schema.optional(maxValue(mutableArray(agentHookSchema), 20)),
    mcpServers: maxValue(mutableArray(mcpServerSchema), 30).pipe(
      Schema.withDecodingDefaultType(Effect.sync(() => [])),
    ),
    skills: maxValue(mutableArray(managedSkillSchema), 20).pipe(
      Schema.withDecodingDefaultType(Effect.sync(() => [])),
    ),
  }),
  (settings, context) => {
    for (const key of ['mcpServers', 'skills', 'hooks'] as const)
      if (
        new Set((settings[key] ?? []).map((item) => item.name)).size !==
        (settings[key] ?? []).length
      )
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
    ...(project?.hooks || agent?.hooks
      ? { hooks: [...(project?.hooks ?? []), ...(agent?.hooks ?? [])] }
      : {}),
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
