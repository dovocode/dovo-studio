import { z } from 'zod'
const name = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/, 'Use letters, numbers, dashes or underscores')
const environmentName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
export const mcpServerSchema = z
  .object({
    name,
    enabled: z.boolean(),
    transport: z.enum(['stdio', 'http']),
    command: z.string().max(2000).default(''),
    args: z.array(z.string().max(4000)).max(100).default([]),
    url: z.string().max(4000).default(''),
    env: z.record(environmentName, environmentName).default({}),
    bearerTokenEnv: z.union([z.literal(''), environmentName]).default(''),
    envValues: z.record(environmentName, z.string().max(4000)).optional(),
    headerValues: z.record(z.string().regex(/^[A-Za-z0-9-]+$/), z.string().max(4000)).optional(),
    sourceUrl: z.url().optional(),
    sourceRevision: z.string().max(200).optional(),
    headerEnv: z.record(z.string().regex(/^[A-Za-z0-9-]+$/), environmentName).default({}),
  })
  .superRefine((server, context) => {
    if (server.transport === 'stdio' && !server.command.trim())
      context.addIssue({ code: 'custom', path: ['command'], message: 'Enter an executable' })
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
  })
export const managedSkillSchema = z.object({
  name,
  description: z.string().trim().min(1).max(2000),
  enabled: z.boolean(),
  content: z.string().trim().min(1).max(64000),
  sourceUrl: z.url().optional(),
  sourceRevision: z.string().max(200).optional(),
  sourcePath: z.string().max(4000).optional(),
})
export const resourceSettingsSchema = z
  .object({
    mcpServers: z.array(mcpServerSchema).max(30).default([]),
    skills: z.array(managedSkillSchema).max(20).default([]),
  })
  .superRefine((settings, context) => {
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
  })
export const mcpTestResultSchema = z.object({ tools: z.array(z.string()), server: z.string() })
export type McpServer = z.infer<typeof mcpServerSchema>
export type ManagedSkill = z.infer<typeof managedSkillSchema>
export type ResourceSettings = z.infer<typeof resourceSettingsSchema>
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
