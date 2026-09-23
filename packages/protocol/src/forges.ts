import { mutableStruct, mutableArray } from './schema.js'
import { urlSchema, refine, minValue, maxValue, superRefine } from './schema.js'
import { Schema } from 'effect'
export const forgeProviderSchema = Schema.Literal(
  'github',
  'bitbucket',
  'forgejo',
  'gitea',
  'azure-devops',
)
export type ForgeProvider = Schema.Schema.Type<typeof forgeProviderSchema>
export const forgeLabels: Record<ForgeProvider, string> = {
  github: 'GitHub',
  bitbucket: 'Bitbucket',
  forgejo: 'Forgejo',
  gitea: 'Gitea',
  'azure-devops': 'Azure DevOps',
}
const serverURL = refine(
  urlSchema({
    protocol: /^https?$/,
  }),
  (value) => {
    try {
      const url = new URL(value)
      return !url.username && !url.password && !url.search && !url.hash
    } catch {
      return false
    }
  },
  'Use a server URL without credentials, a query or a fragment',
)
export const forgeConnectionSchema = mutableStruct({
  id: maxValue(minValue(Schema.String, 1), 200),
  name: maxValue(minValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 1), 100),
  provider: forgeProviderSchema,
  baseUrl: serverURL,
  username: Schema.optional(maxValue(Schema.String, 200)),
  credential: Schema.Literal('gh', 'token', 'environment', 'cli'),
  tokenEnv: Schema.optional(Schema.String),
  cliTool: Schema.optional(Schema.Literal('fj', 'tea')),
  cliProfile: Schema.optional(
    refine(
      maxValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 200),
      (value) => !/[\p{Cc}]/u.test(value),
    ),
  ),
  revision: Schema.String,
})
export type ForgeConnection = Schema.Schema.Type<typeof forgeConnectionSchema>
export const forgeConnectionsSchema = mutableStruct({
  connections: mutableArray(forgeConnectionSchema),
})
export const forgeCliProfileQuerySchema = mutableStruct({
  provider: forgeProviderSchema,
  baseUrl: serverURL,
  cliTool: Schema.optional(Schema.Literal('fj', 'tea')),
  repositoryId: Schema.optional(maxValue(minValue(Schema.String, 1), 200)),
})
export type ForgeCliProfileQuery = Schema.Schema.Type<typeof forgeCliProfileQuerySchema>
export const forgeCliProfilesSchema = mutableStruct({
  profiles: mutableArray(
    mutableStruct({
      id: maxValue(minValue(Schema.String, 1), 200),
      name: maxValue(minValue(Schema.String, 1), 300),
      baseUrl: Schema.optional(serverURL),
      username: Schema.optional(maxValue(Schema.String, 200)),
      active: Schema.optional(Schema.Boolean),
    }),
  ),
  message: Schema.optional(Schema.String),
})
export type ForgeCliProfiles = Schema.Schema.Type<typeof forgeCliProfilesSchema>
export const forgeConnectionInputSchema = superRefine(
  mutableStruct({
    ...forgeConnectionSchema.omit('id', 'revision').fields,
    ...{
      id: Schema.optional(maxValue(minValue(Schema.String, 1), 200)),
      token: Schema.optional(
        maxValue(minValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 1), 8192),
      ),
      tokenEnv: Schema.optional(Schema.String.pipe(Schema.pattern(/^[A-Za-z_][A-Za-z0-9_]*$/))),
    },
  }),
  (value, ctx) => {
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
  },
)
export const forgeBindingSchema = mutableStruct({
  connectionId: minValue(Schema.String, 1),
  repository: refine(
    maxValue(minValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 1), 500),
    (value) => {
      const parts = value.split('/')
      return (
        parts.length === 2 &&
        parts.every(
          (part) => part.trim() && !['.', '..'].includes(part) && !/[\p{Cc}?#\\]/u.test(part),
        )
      )
    },
    'Use owner/repository, or project/repository for Azure DevOps',
  ),
  revision: Schema.optional(Schema.String),
})
export const forgeRepositorySchema = mutableStruct({
  id: Schema.String,
  name: Schema.String,
  fullName: Schema.String,
  url: serverURL,
  cloneUrl: serverURL,
  defaultBranch: Schema.optional(Schema.String),
})
export type ForgeRepository = Schema.Schema.Type<typeof forgeRepositorySchema>
export const forgeRepositoryPageSchema = mutableStruct({
  repositories: mutableArray(forgeRepositorySchema),
  page: Schema.Number.pipe(Schema.finite())
    .pipe(Schema.int(), Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER))
    .pipe(Schema.positive()),
  hasMore: Schema.Boolean,
})
export type ForgeRepositoryPage = Schema.Schema.Type<typeof forgeRepositoryPageSchema>
export const forgeCapabilitiesSchema = mutableStruct({
  inlineRange: Schema.optional(Schema.Boolean),
  draft: Schema.optional(Schema.Boolean),
  actions: mutableArray(
    Schema.Literal(
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
    ),
  ),
  reviewDecisions: mutableArray(Schema.Literal('comment', 'approve', 'request-changes')),
  mergeMethods: mutableArray(Schema.Literal('merge', 'squash', 'rebase')),
})
export type ForgeCapabilities = Schema.Schema.Type<typeof forgeCapabilitiesSchema>
const text = maxValue(minValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 1), 60000)
const number = Schema.Number.pipe(Schema.finite())
  .pipe(Schema.int(), Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER))
  .pipe(Schema.positive())
const revision = Schema.String.pipe(Schema.pattern(/^[a-f0-9]{40}$/))
const action = mutableStruct({
  number,
  headSha: revision,
})
export const pullActionSchema = Schema.Union(
  ...[
    mutableStruct({
      ...action.fields,
      ...{
        action: Schema.Literal('comment'),
        body: text,
      },
    }),
    mutableStruct({
      ...action.fields,
      ...{
        action: Schema.Literal('review'),
        body: Schema.optionalWith(
          maxValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 60000),
          {
            default: () => '',
          },
        ),
        event: Schema.Literal('comment', 'approve', 'request-changes'),
      },
    }),
    mutableStruct({
      ...action.fields,
      ...{
        action: Schema.Literal('reply'),
        body: text,
        commentId: minValue(Schema.String, 1),
        threadId: Schema.optional(Schema.String),
      },
    }),
    mutableStruct({
      ...action.fields,
      ...{
        action: Schema.Literal('resolve'),
        threadId: minValue(Schema.String, 1),
        resolved: Schema.Boolean,
      },
    }),
    mutableStruct({
      ...action.fields,
      ...{
        action: Schema.Literal('edit'),
        title: maxValue(minValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 1), 300),
        body: maxValue(Schema.String, 60000),
        base: Schema.optional(minValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 1)),
      },
    }),
    mutableStruct({
      ...action.fields,
      ...{
        action: Schema.Literal('reviewers'),
        operation: Schema.optionalWith(Schema.Literal('add', 'remove'), {
          default: () => 'add',
        }),
        reviewers: maxValue(
          mutableArray(maxValue(minValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 1), 200)),
          30,
        ),
        teams: Schema.optionalWith(
          maxValue(
            mutableArray(
              maxValue(minValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 1), 200),
            ),
            30,
          ),
          {
            default: () => [],
          },
        ),
      },
    }),
    mutableStruct({
      ...action.fields,
      ...{
        action: Schema.Literal('merge'),
        method: Schema.Literal('merge', 'squash', 'rebase'),
        message: Schema.optional(maxValue(Schema.String, 60000)),
      },
    }),
    mutableStruct({
      ...action.fields,
      ...{
        action: Schema.Literal('close'),
      },
    }),
    mutableStruct({
      ...action.fields,
      ...{
        action: Schema.Literal('reopen'),
      },
    }),
  ],
)
export type PullAction = Schema.Schema.Type<typeof pullActionSchema>
export const pullCreateSchema = mutableStruct({
  title: maxValue(minValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 1), 300),
  body: Schema.optionalWith(maxValue(Schema.String, 60000), {
    default: () => '',
  }),
  head: maxValue(minValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 1), 500),
  base: maxValue(minValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 1), 500),
  draft: Schema.optionalWith(Schema.Boolean, {
    default: () => false,
  }),
})
export type PullCreate = Schema.Schema.Type<typeof pullCreateSchema>
export const pullCreateOptionsSchema = mutableStruct({
  provider: forgeProviderSchema,
  draft: Schema.Boolean,
})
export const pullActionResultSchema = mutableStruct({
  number,
  url: refine(
    urlSchema({
      protocol: /^https?$/,
    }),
    (value) => {
      try {
        const url = new URL(value)
        return !url.username && !url.password
      } catch {
        return false
      }
    },
    'URLs must not contain credentials',
  ),
  status: Schema.Literal('created', 'updated', 'submitted', 'merged', 'queued'),
  message: Schema.optional(Schema.String),
})
export type PullActionResult = Schema.Schema.Type<typeof pullActionResultSchema>
