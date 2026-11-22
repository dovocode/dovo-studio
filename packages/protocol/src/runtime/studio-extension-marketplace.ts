import { Schema } from 'effect'
import { mutableArray, refine, strictStruct, uuidSchema } from '../shared/schema.js'
import { extensionKeySchema } from './studio-extension-views.js'
import {
  marketplaceDigestSchema,
  studioExtensionManifestSchema,
  type ExtensionContribution,
} from './studio-extensions.js'

const title = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100))
const description = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1000))
const releaseVersion = Schema.String.check(
  Schema.isPattern(/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/),
)

export const marketplaceOriginSchema = strictStruct({
  version: releaseVersion,
  digest: marketplaceDigestSchema,
})
export type MarketplaceOrigin = typeof marketplaceOriginSchema.Type

const dashboard = strictStruct({
  id: uuidSchema,
  title,
  tiles: mutableArray(strictStruct({ title, contributionId: extensionKeySchema })).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(16),
  ),
})
export const marketplaceSourcePlaceholder = 'marketplace-source'

export const marketplaceReleaseSchema = refine(
  strictStruct({
    publisher: title,
    description,
    version: releaseVersion,
    manifest: studioExtensionManifestSchema,
    dashboard: Schema.optionalKey(dashboard),
  }),
  ({ manifest, dashboard }) => {
    const contributions = new Set(manifest.contributions.map(({ id }) => id))
    return (
      manifest.contributions.every((item) => {
        if (item.kind === 'cli') return item.repositoryId === marketplaceSourcePlaceholder
        if (item.kind === 'tool')
          return (
            item.taskId === marketplaceSourcePlaceholder &&
            item.server === marketplaceSourcePlaceholder
          )
        if (item.kind === 'app')
          return (
            item.taskId === marketplaceSourcePlaceholder &&
            item.appId === marketplaceSourcePlaceholder
          )
        return true
      }) &&
      (dashboard?.tiles.every((tile) => contributions.has(tile.contributionId)) ?? true)
    )
  },
  'Marketplace releases must use portable sources and dashboard tiles must refer to contributions in the release',
)
export type MarketplaceRelease = typeof marketplaceReleaseSchema.Type

export type MarketplaceSourceContribution = Extract<
  ExtensionContribution,
  { kind: 'tool' | 'app' | 'cli' }
>

export function marketplaceNeedsSource(
  item: ExtensionContribution,
): item is MarketplaceSourceContribution {
  return item.kind === 'tool' || item.kind === 'app' || item.kind === 'cli'
}

export const marketplaceSourcesSchema = strictStruct({
  servers: mutableArray(Schema.String),
  apps: mutableArray(strictStruct({ id: Schema.String, title: Schema.String })),
})
export const marketplaceListSchema = strictStruct({
  packages: mutableArray(
    strictStruct({
      id: extensionKeySchema,
      name: title,
      publisher: title,
      description,
      version: releaseVersion,
      digest: marketplaceDigestSchema,
      installed: Schema.optionalKey(marketplaceOriginSchema),
      draft: Schema.optionalKey(marketplaceOriginSchema),
    }),
  ),
})
export const marketplaceDetailSchema = strictStruct({
  package: marketplaceReleaseSchema,
  digest: marketplaceDigestSchema,
})
export type MarketplacePackage = (typeof marketplaceListSchema.Type)['packages'][number]
