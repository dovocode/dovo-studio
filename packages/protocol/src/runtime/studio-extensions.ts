import { Schema } from 'effect'
import { mutableArray, refine, strictStruct } from '../shared/schema.js'

import {
  extensionKeySchema,
  extensionViewComponents,
  extensionViewIssue,
  extensionViewSchema,
} from './studio-extension-views.js'
const label = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100))
const reference = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200))
const revision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const longText = Schema.String.check(Schema.isMaxLength(4096))
const value = Schema.Union([longText, Schema.Boolean])
const settings = Schema.Record(extensionKeySchema, value)

const common = { id: extensionKeySchema, title: label }
export const extensionViewContributionSchema = strictStruct({
  ...common,
  kind: Schema.Literal('view'),
  placement: Schema.Literals(['settings', 'tool']),
  view: extensionViewSchema,
})
export const extensionContributionSchema = Schema.Union([
  strictStruct({
    ...common,
    kind: Schema.Literal('studio'),
    destination: Schema.Literals(['tasks', 'terminal', 'browser', 'dashboards', 'jobs', 'pulls']),
  }),
  extensionViewContributionSchema,
  strictStruct({ ...common, kind: Schema.Literal('app'), taskId: reference, appId: reference }),
  strictStruct({
    ...common,
    kind: Schema.Literal('tool'),
    taskId: reference,
    server: reference,
    tool: reference,
    arguments: Schema.optionalKey(longText),
    inputs: Schema.optionalKey(Schema.Record(reference, extensionKeySchema)),
  }),
])
const fields = mutableArray(
  strictStruct({ id: extensionKeySchema, title: label, default: value }),
).check(Schema.isMaxLength(16))
const unique = (items: readonly { id: string }[]) =>
  new Set(items.map((item) => item.id)).size === items.length
export const studioExtensionManifestSchema = strictStruct({
  id: extensionKeySchema,
  version: Schema.Literal(1),
  name: label,
  contributions: refine(
    mutableArray(extensionContributionSchema).check(Schema.isMaxLength(16)),
    unique,
    'Contribution IDs must be unique',
  ),
  settings: Schema.optionalKey(refine(fields, unique, 'Setting IDs must be unique')),
}).pipe(
  Schema.check(
    Schema.makeFilter((manifest) => {
      const settings = new Map(manifest.settings?.map((field) => [field.id, field.default]))
      const tools = new Set(
        manifest.contributions.filter((item) => item.kind === 'tool').map((item) => item.id),
      )
      for (const contribution of manifest.contributions) {
        if (contribution.kind !== 'view') continue
        const issue = extensionViewIssue(contribution.view, settings, tools)
        if (issue) return { path: ['contributions', contribution.id, 'view'], issue }
      }
      return true
    }),
  ),
)
export type StudioExtensionManifest = typeof studioExtensionManifestSchema.Type
export type ExtensionContribution = typeof extensionContributionSchema.Type
export type ExtensionSettingValue = typeof value.Type

export const studioExtensionEntrySchema = strictStruct({
  id: extensionKeySchema,
  revision,
  enabled: Schema.Boolean,
  installed: Schema.optional(studioExtensionManifestSchema),
  draft: Schema.optional(studioExtensionManifestSchema),
  canRollback: Schema.Boolean,
  settings,
  error: Schema.optional(Schema.String),
})
export type StudioExtensionEntry = typeof studioExtensionEntrySchema.Type
export const studioExtensionsListSchema = strictStruct({
  extensions: mutableArray(studioExtensionEntrySchema),
  allowAgentInstall: Schema.optional(Schema.Boolean),
})
export const studioExtensionResultSchema = strictStruct({ extension: studioExtensionEntrySchema })
export const studioExtensionOpenResultSchema = strictStruct({
  contribution: extensionContributionSchema,
})
export const studioExtensionCallResultSchema = strictStruct({ data: Schema.Unknown })

const componentVersion = Schema.Literals([1, 2])
export type StudioExtensionComponentVersion = typeof componentVersion.Type

export const marketplaceDigestSchema = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/))
const marketplaceIdentity = { id: extensionKeySchema, digest: marketplaceDigestSchema }
export const marketplaceBindingSchema = strictStruct({
  contributionId: extensionKeySchema,
  taskId: Schema.optionalKey(reference),
  source: reference,
})
export type MarketplaceBinding = typeof marketplaceBindingSchema.Type
export const studioMarketplaceRequestSchema = Schema.Union([
  strictStruct({ action: Schema.Literal('list'), query: Schema.optionalKey(label) }),
  strictStruct({ action: Schema.Literal('read'), ...marketplaceIdentity }),
  strictStruct({ action: Schema.Literal('sources'), taskId: Schema.optionalKey(reference) }),
  strictStruct({
    action: Schema.Literal('stage'),
    ...marketplaceIdentity,
    expectedRevision: revision,
    bindings: mutableArray(marketplaceBindingSchema).check(Schema.isMaxLength(16)),
  }),
])
export type StudioMarketplaceRequest = typeof studioMarketplaceRequestSchema.Type

const edit = { id: extensionKeySchema, expectedRevision: revision }
export const studioExtensionCommandSchema = Schema.Union([
  strictStruct({
    action: Schema.Literal('marketplace'),
    marketplace: studioMarketplaceRequestSchema,
  }),
  strictStruct({
    action: Schema.Literal('list'),
    componentVersion: Schema.optional(componentVersion),
  }),
  strictStruct({
    action: Schema.Literal('catalog'),
    component: Schema.optional(
      refine(
        extensionKeySchema,
        (key) =>
          key === 'manifest' ||
          key === 'marketplace' ||
          Object.hasOwn(extensionViewComponents, key),
        'Unknown component kind',
      ),
    ),
  }),
  strictStruct({ action: Schema.Literal('read'), id: extensionKeySchema }),
  strictStruct({ action: Schema.Literal('agent-install-policy'), enabled: Schema.Boolean }),
  strictStruct({
    action: Schema.Literal('stage'),
    manifest: studioExtensionManifestSchema,
    expectedRevision: revision,
  }),
  strictStruct({ action: Schema.Literal('validate'), manifest: studioExtensionManifestSchema }),
  strictStruct({
    ...edit,
    action: Schema.Literals(['discard', 'enable', 'disable', 'remove']),
  }),
  strictStruct({
    ...edit,
    action: Schema.Literals(['install', 'rollback']),
    componentVersion: Schema.optional(componentVersion),
  }),
  strictStruct({ ...edit, action: Schema.Literal('settings'), settings }),
  strictStruct({
    ...edit,
    action: Schema.Literal('open'),
    contributionId: extensionKeySchema,
    componentVersion: Schema.optional(componentVersion),
  }),
  strictStruct({ ...edit, action: Schema.Literal('call'), contributionId: extensionKeySchema }),
])
export type StudioExtensionCommand = typeof studioExtensionCommandSchema.Type
