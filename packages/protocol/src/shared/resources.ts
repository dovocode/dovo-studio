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
    /** Native MCP 2026-07-28 HTTP server; prefer the negotiated ACP binding. */
    acpTransport: Schema.optional(Schema.Boolean),
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
    /** Sign in with OAuth on each computer. Tokens stay on that computer, never in settings. */
    oauth: Schema.optional(
      mutableStruct({ scope: Schema.optional(maxValue(Schema.String, 1000)) }),
    ),
    headerEnv: Schema.Record(
      Schema.String.pipe(Schema.check(Schema.isPattern(/^[A-Za-z0-9-]+$/))),
      Schema.mutableKey(environmentName),
    ).pipe(Schema.withDecodingDefaultType(Effect.sync(() => ({})))),
  }),
  (server, context) => {
    if (server.acpTransport && server.transport !== 'http')
      context.addIssue({
        code: 'custom',
        path: ['acpTransport'],
        message: 'MCP-over-ACP requires an HTTP server supporting MCP 2026-07-28',
      })
    if (server.oauth && server.transport !== 'http')
      context.addIssue({
        code: 'custom',
        path: ['oauth'],
        message: 'OAuth sign-in requires a remote HTTP server',
      })
    if (server.oauth && server.acpTransport)
      context.addIssue({
        code: 'custom',
        path: ['oauth'],
        message: 'OAuth sign-in uses Streamable HTTP. Turn off MCP-over-ACP for this server.',
      })
    if (
      server.oauth &&
      (server.bearerTokenEnv ||
        [...Object.keys(server.headerEnv), ...Object.keys(server.headerValues ?? {})].some(
          (name) => name.toLowerCase() === 'authorization',
        ))
    )
      context.addIssue({
        code: 'custom',
        path: ['oauth'],
        message: 'Remove the bearer token or Authorization header when using OAuth sign-in',
      })
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
  sourcePackage: Schema.optional(Schema.Boolean),
})
export const agentHookEvents = [
  'before-turn',
  'after-turn',
  'session-start',
  'tool-start',
  'tool-complete',
  'tool-error',
  'permission-request',
  'permission-response',
  'before-compaction',
  'after-compaction',
  'subagent-start',
  'subagent-stop',
  'turn-error',
  'turn-interrupted',
] as const
export const agentHookEventChoices = agentHookEvents.map((id) => ({
  id,
  name:
    id === 'before-turn'
      ? 'Before each turn'
      : id === 'after-turn'
        ? 'After each turn'
        : id === 'session-start'
          ? 'Session attached'
          : id
              .split('-')
              .map((word) => word[0].toUpperCase() + word.slice(1))
              .join(' '),
}))
export const agentHookSchema = superRefine(
  mutableStruct({
    name,
    enabled: Schema.Boolean,
    event: Schema.Literals(agentHookEvents),
    matcher: Schema.optional(maxValue(Schema.String, 400)),
    command: maxValue(minValue(Schema.String.pipe(Schema.decodeTo(Schema.Trim)), 1), 4000),
    timeoutSeconds: Schema.Number.pipe(
      Schema.check(Schema.isInt()),
      Schema.check(Schema.isBetween({ minimum: 1, maximum: 600 })),
    ),
  }),
  (hook, context) => {
    if (!hook.matcher || hook.matcher === '*') return
    try {
      new RegExp(hook.matcher)
    } catch {
      context.addIssue({
        code: 'custom',
        path: ['matcher'],
        message: 'Enter a valid regular expression',
      })
    }
  },
)
export type AgentHook = Schema.Schema.Type<typeof agentHookSchema>
/** An installed plugin on this computer: `plugin@gh-<marketplace>:<harness>`. */
export const pluginActivationNamePattern =
  /^[a-z0-9][a-z0-9._-]{0,63}@gh-[a-f0-9]{12}:(claude|codex)$/i
/**
 * Turns an installed plugin on or off at one settings scope. Later scopes override earlier ones by
 * name; removing an entry reveals the inherited choice or the computer-wide default.
 */
export const pluginActivationSchema = mutableStruct({
  name: Schema.String.check(Schema.isPattern(pluginActivationNamePattern)),
  enabled: Schema.Boolean,
})
export type PluginActivation = Schema.Schema.Type<typeof pluginActivationSchema>
export const resourceSettingsSchema = superRefine(
  mutableStruct({
    additionalInstructions: Schema.optional(maxValue(Schema.String, 32000)),
    hooks: Schema.optional(maxValue(mutableArray(agentHookSchema), 20)),
    mcpServers: maxValue(mutableArray(mcpServerSchema), 30).pipe(
      Schema.withDecodingDefaultType(Effect.sync(() => [])),
    ),
    skills: maxValue(mutableArray(managedSkillSchema), 20).pipe(
      Schema.withDecodingDefaultType(Effect.sync(() => [])),
    ),
    plugins: Schema.optional(maxValue(mutableArray(pluginActivationSchema), 50)),
  }),
  (settings, context) => {
    // Codex reads plugin activation only from its own config.toml, for every session on the
    // computer. A per-scope Codex choice would silently apply machine-wide.
    if (settings.plugins?.some((plugin) => plugin.name.endsWith(':codex')))
      context.addIssue({
        code: 'custom',
        path: ['plugins'],
        message:
          'Codex turns plugins on for the whole computer. Use Agent plugins to enable or disable a Codex plugin.',
      })
    for (const key of ['mcpServers', 'skills', 'hooks', 'plugins'] as const)
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
  events: Schema.optional(
    mutableArray(
      mutableStruct({
        name: Schema.String,
        delivery: mutableArray(Schema.Literals(['poll', 'push', 'webhook'])),
      }),
    ),
  ),
})
export type McpServer = Schema.Schema.Type<typeof mcpServerSchema>
export type ManagedSkill = Schema.Schema.Type<typeof managedSkillSchema>
export type ResourceSettings = Schema.Schema.Type<typeof resourceSettingsSchema>
export function mergeResources(
  project?: ResourceSettings,
  agent?: ResourceSettings,
): ResourceSettings {
  const additionalInstructions = agent?.additionalInstructions ?? project?.additionalInstructions
  return {
    ...(additionalInstructions ? { additionalInstructions } : {}),
    ...(project?.hooks || agent?.hooks
      ? {
          hooks: [
            ...new Map(
              [...(project?.hooks ?? []), ...(agent?.hooks ?? [])].map((hook) => [hook.name, hook]),
            ).values(),
          ],
        }
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
    ...(project?.plugins || agent?.plugins
      ? {
          plugins: [
            ...new Map(
              [...(project?.plugins ?? []), ...(agent?.plugins ?? [])].map((plugin) => [
                plugin.name,
                plugin,
              ]),
            ).values(),
          ],
        }
      : {}),
  }
}

/**
 * Plugins to load: the computer-wide default for each installation, overridden by the resolved
 * scope choices. Choices for plugins that are not installed here are ignored.
 */
export function activePlugins(
  installed: readonly { id: string; enabled: boolean }[],
  resources: Pick<ResourceSettings, 'plugins'>,
) {
  const choices = new Map((resources.plugins ?? []).map((plugin) => [plugin.name, plugin.enabled]))
  return installed.filter((plugin) => choices.get(plugin.id) ?? plugin.enabled).map(({ id }) => id)
}
