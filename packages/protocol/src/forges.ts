import { z } from 'zod'

export const forgeProviderSchema = z.enum([
  'github',
  'bitbucket',
  'forgejo',
  'gitea',
  'azure-devops',
])
export type ForgeProvider = z.infer<typeof forgeProviderSchema>
export const forgeLabels: Record<ForgeProvider, string> = {
  github: 'GitHub',
  bitbucket: 'Bitbucket',
  forgejo: 'Forgejo',
  gitea: 'Gitea',
  'azure-devops': 'Azure DevOps',
}
const serverURL = z.url({ protocol: /^https?$/ }).refine((value) => {
  try {
    const url = new URL(value)
    return !url.username && !url.password && !url.search && !url.hash
  } catch {
    return false
  }
}, 'Use a server URL without credentials, a query or a fragment')
export const forgeConnectionSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().trim().min(1).max(100),
  provider: forgeProviderSchema,
  baseUrl: serverURL,
  username: z.string().max(200).optional(),
  credential: z.enum(['gh', 'token', 'environment', 'cli']),
  tokenEnv: z.string().optional(),
  cliTool: z.enum(['fj', 'tea']).optional(),
  cliProfile: z
    .string()
    .trim()
    .max(200)
    .refine((value) => !/[\p{Cc}]/u.test(value))
    .optional(),
  revision: z.string(),
})
export type ForgeConnection = z.infer<typeof forgeConnectionSchema>
export const forgeConnectionsSchema = z.object({ connections: z.array(forgeConnectionSchema) })
export const forgeCliProfileQuerySchema = z.object({
  provider: forgeProviderSchema,
  baseUrl: serverURL,
  cliTool: z.enum(['fj', 'tea']).optional(),
  repositoryId: z.string().min(1).max(200).optional(),
})
export type ForgeCliProfileQuery = z.infer<typeof forgeCliProfileQuerySchema>
export const forgeCliProfilesSchema = z.object({
  profiles: z.array(
    z.object({
      id: z.string().min(1).max(200),
      name: z.string().min(1).max(300),
      baseUrl: serverURL.optional(),
      username: z.string().max(200).optional(),
      active: z.boolean().optional(),
    }),
  ),
  message: z.string().optional(),
})
export type ForgeCliProfiles = z.infer<typeof forgeCliProfilesSchema>
export const forgeConnectionInputSchema = forgeConnectionSchema
  .omit({ id: true, revision: true })
  .extend({
    id: z.string().min(1).max(200).optional(),
    token: z.string().trim().min(1).max(8192).optional(),
    tokenEnv: z
      .string()
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.cliTool && !['forgejo', 'gitea'].includes(value.provider))
      ctx.addIssue({
        code: 'custom',
        message: 'fj and tea are only available for Forgejo and Gitea',
        path: ['cliTool'],
      })
    if (value.credential === 'gh' && value.provider !== 'github')
      ctx.addIssue({
        code: 'custom',
        message: 'GitHub CLI authentication is only available for GitHub',
        path: ['credential'],
      })
    if (value.credential === 'environment' && !value.tokenEnv)
      ctx.addIssue({
        code: 'custom',
        message: 'Enter the runtime environment variable containing the token',
        path: ['tokenEnv'],
      })
    if (value.credential === 'cli' && value.provider === 'github')
      ctx.addIssue({
        code: 'custom',
        message: 'Use GitHub CLI authentication for GitHub',
        path: ['credential'],
      })
    if (
      value.credential === 'cli' &&
      value.provider !== 'azure-devops' &&
      value.cliTool !== 'fj' &&
      !value.cliProfile
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Enter the named CLI login/profile',
        path: ['cliProfile'],
      })
    if (value.provider === 'bitbucket' && value.credential !== 'cli' && !value.username)
      ctx.addIssue({
        code: 'custom',
        message: 'Enter the Atlassian account email for the API token',
        path: ['username'],
      })
  })
export const forgeBindingSchema = z.object({
  connectionId: z.string().min(1),
  repository: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .refine((value) => {
      const parts = value.split('/')
      return (
        parts.length === 2 &&
        parts.every(
          (part) => part.trim() && !['.', '..'].includes(part) && !/[\p{Cc}?#\\]/u.test(part),
        )
      )
    }, 'Use owner/repository, or project/repository for Azure DevOps'),
  revision: z.string().optional(),
})
export const forgeRepositorySchema = z.object({
  id: z.string(),
  name: z.string(),
  fullName: z.string(),
  url: serverURL,
  cloneUrl: serverURL,
  defaultBranch: z.string().optional(),
})
export type ForgeRepository = z.infer<typeof forgeRepositorySchema>
export const forgeRepositoryPageSchema = z.object({
  repositories: z.array(forgeRepositorySchema),
  page: z.number().int().positive(),
  hasMore: z.boolean(),
})
export type ForgeRepositoryPage = z.infer<typeof forgeRepositoryPageSchema>
export const forgeCapabilitiesSchema = z.object({
  inlineRange: z.boolean().optional(),
  draft: z.boolean().optional(),
  actions: z.array(
    z.enum([
      'create',
      'edit',
      'comment',
      'inline-comment',
      'review',
      'reply',
      'resolve',
      'reviewers',
      'merge',
      'close',
      'reopen',
    ]),
  ),
  reviewDecisions: z.array(z.enum(['comment', 'approve', 'request-changes'])),
  mergeMethods: z.array(z.enum(['merge', 'squash', 'rebase'])),
})
export type ForgeCapabilities = z.infer<typeof forgeCapabilitiesSchema>
const text = z.string().trim().min(1).max(60000)
const number = z.number().int().positive()
const revision = z.string().regex(/^[a-f0-9]{40}$/)
const action = z.object({ number, headSha: revision })
export const pullActionSchema = z.discriminatedUnion('action', [
  action.extend({ action: z.literal('comment'), body: text }),
  action.extend({
    action: z.literal('review'),
    body: z.string().trim().max(60000).default(''),
    event: z.enum(['comment', 'approve', 'request-changes']),
  }),
  action.extend({
    action: z.literal('reply'),
    body: text,
    commentId: z.string().min(1),
    threadId: z.string().optional(),
  }),
  action.extend({
    action: z.literal('resolve'),
    threadId: z.string().min(1),
    resolved: z.boolean(),
  }),
  action.extend({
    action: z.literal('edit'),
    title: z.string().trim().min(1).max(300),
    body: z.string().max(60000),
    base: z.string().trim().min(1).optional(),
  }),
  action.extend({
    action: z.literal('reviewers'),
    operation: z.enum(['add', 'remove']).default('add'),
    reviewers: z.array(z.string().trim().min(1).max(200)).max(30),
    teams: z.array(z.string().trim().min(1).max(200)).max(30).default([]),
  }),
  action.extend({
    action: z.literal('merge'),
    method: z.enum(['merge', 'squash', 'rebase']),
    message: z.string().max(60000).optional(),
  }),
  action.extend({ action: z.literal('close') }),
  action.extend({ action: z.literal('reopen') }),
])
export type PullAction = z.infer<typeof pullActionSchema>
export const pullCreateSchema = z.object({
  title: z.string().trim().min(1).max(300),
  body: z.string().max(60000).default(''),
  head: z.string().trim().min(1).max(500),
  base: z.string().trim().min(1).max(500),
  draft: z.boolean().default(false),
})
export type PullCreate = z.infer<typeof pullCreateSchema>
export const pullCreateOptionsSchema = z.object({
  provider: forgeProviderSchema,
  draft: z.boolean(),
})
export const pullActionResultSchema = z.object({
  number,
  url: z.url({ protocol: /^https?$/ }).refine((value) => {
    try {
      const url = new URL(value)
      return !url.username && !url.password
    } catch {
      return false
    }
  }, 'URLs must not contain credentials'),
  status: z.enum(['created', 'updated', 'submitted', 'merged', 'queued']),
  message: z.string().optional(),
})
export type PullActionResult = z.infer<typeof pullActionResultSchema>
