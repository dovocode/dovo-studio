import { Schema } from 'effect'
import { mutableArray, mutableStruct } from '../shared/schema.js'

/** Harnesses that can load a reviewed plugin snapshot on the computer that owns it. */
export const harnessPluginHarnesses = ['claude', 'codex'] as const
export const harnessPluginHarnessSchema = Schema.Literals(harnessPluginHarnesses)
export type HarnessPluginHarness = typeof harnessPluginHarnessSchema.Type
export const harnessPluginHarnessNames: Record<HarnessPluginHarness, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
}

const githubRepositoryPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/
const pluginRepositorySchema = Schema.String.check(Schema.isPattern(githubRepositoryPattern))
export const gitRevisionSchema = Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/))
const gitRefSchema = Schema.String.check(
  Schema.isPattern(/^(?!.*\.\.)(?!\/)(?!.*\/$)[A-Za-z0-9._/-]{1,200}$/),
)
const pluginNameSchema = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9._-]{0,63}$/i))
const marketplaceIdSchema = Schema.String.check(Schema.isPattern(/^gh-[a-f0-9]{12}$/))
const text = (max: number) => Schema.String.check(Schema.isMaxLength(max))

/** Accepts `owner/repo` or a github.com repository URL. Other hosts are not supported. */
export function parseGithubRepository(input: string) {
  const trimmed = input
    .trim()
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
  const path = /^https:\/\/github\.com\/([^/?#]+\/[^/?#]+)$/i.exec(trimmed)?.[1] ?? trimmed
  return githubRepositoryPattern.test(path) ? path : undefined
}

export const harnessPluginMarketplaceSchema = mutableStruct({
  id: marketplaceIdSchema,
  repository: pluginRepositorySchema,
  ref: Schema.optional(gitRefSchema),
  revision: gitRevisionSchema,
  name: text(100),
  addedAt: Schema.String,
})
export type HarnessPluginMarketplace = typeof harnessPluginMarketplaceSchema.Type

export const harnessPluginComponentsSchema = mutableStruct({
  skills: mutableArray(text(100)),
  commands: mutableArray(text(100)),
  agents: mutableArray(text(100)),
  /** Hook definitions run shell commands inside the harness. */
  hooks: Schema.Boolean,
  /** MCP servers start processes or connect to remote services inside the harness. */
  mcpServers: mutableArray(text(100)),
})
export type HarnessPluginComponents = typeof harnessPluginComponentsSchema.Type

/** One marketplace entry. Catalog fields are untrusted text from the repository. */
export const harnessPluginEntrySchema = mutableStruct({
  name: pluginNameSchema,
  description: Schema.optional(text(1000)),
  version: Schema.optional(text(100)),
  category: Schema.optional(text(100)),
  /** Repository-relative plugin folder; absent when the source is unsupported. */
  path: Schema.optional(text(500)),
  unsupported: Schema.optional(text(300)),
})
export type HarnessPluginEntry = typeof harnessPluginEntrySchema.Type

export const harnessPluginCatalogSchema = mutableStruct({
  marketplace: harnessPluginMarketplaceSchema,
  formats: mutableArray(Schema.Literals(['claude', 'codex'])),
  plugins: mutableArray(harnessPluginEntrySchema),
})
export type HarnessPluginCatalog = typeof harnessPluginCatalogSchema.Type

export const harnessPluginPreviewSchema = mutableStruct({
  marketplaceId: marketplaceIdSchema,
  repository: pluginRepositorySchema,
  revision: gitRevisionSchema,
  plugin: harnessPluginEntrySchema,
  components: harnessPluginComponentsSchema,
  files: Schema.Number,
  bytes: Schema.Number,
})
export type HarnessPluginPreview = typeof harnessPluginPreviewSchema.Type

export const installedHarnessPluginSchema = mutableStruct({
  /** `plugin@marketplaceId:harness`, unique per computer. */
  id: text(200),
  marketplaceId: marketplaceIdSchema,
  repository: pluginRepositorySchema,
  revision: gitRevisionSchema,
  name: pluginNameSchema,
  version: Schema.optional(text(100)),
  harness: harnessPluginHarnessSchema,
  /** The computer-wide default. Claude Code projects and organizations can override it. */
  enabled: Schema.Boolean,
  components: harnessPluginComponentsSchema,
  installedAt: Schema.String,
})
export type InstalledHarnessPlugin = typeof installedHarnessPluginSchema.Type

export const harnessPluginStateSchema = mutableStruct({
  marketplaces: mutableArray(harnessPluginMarketplaceSchema),
  plugins: mutableArray(installedHarnessPluginSchema),
})
export type HarnessPluginState = typeof harnessPluginStateSchema.Type

export const harnessPluginCommandSchema = Schema.Union([
  mutableStruct({ action: Schema.Literal('list') }),
  mutableStruct({
    action: Schema.Literal('add-marketplace'),
    repository: text(300),
    ref: Schema.optional(gitRefSchema),
  }),
  mutableStruct({
    action: Schema.Literal('refresh-marketplace'),
    marketplaceId: marketplaceIdSchema,
  }),
  mutableStruct({
    action: Schema.Literal('remove-marketplace'),
    marketplaceId: marketplaceIdSchema,
  }),
  mutableStruct({ action: Schema.Literal('catalog'), marketplaceId: marketplaceIdSchema }),
  mutableStruct({
    action: Schema.Literal('preview'),
    marketplaceId: marketplaceIdSchema,
    plugin: pluginNameSchema,
  }),
  mutableStruct({
    action: Schema.Literal('install'),
    marketplaceId: marketplaceIdSchema,
    plugin: pluginNameSchema,
    /** The revision shown in the reviewed preview. A refreshed marketplace needs a new review. */
    revision: gitRevisionSchema,
    harness: harnessPluginHarnessSchema,
    /** Turn the plugin on for every project on this computer. Off keeps it installed only. */
    enabled: Schema.Boolean,
  }),
  mutableStruct({ action: Schema.Literal('set-enabled'), id: text(200), enabled: Schema.Boolean }),
  mutableStruct({ action: Schema.Literal('remove'), id: text(200) }),
])
export type HarnessPluginCommand = typeof harnessPluginCommandSchema.Type
