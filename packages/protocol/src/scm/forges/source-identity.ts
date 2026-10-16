import { Schema } from 'effect'
import { mutableStruct, minValue, maxValue, refine } from '../../shared/schema.js'

/** Opaque, non-secret identities supplied by a verified runtime. */
export const forgeIdentityTokenSchema = maxValue(minValue(Schema.String, 1), 512)
export const forgeReadGuardFields = {
  expectedReaderIdentity: Schema.optional(forgeIdentityTokenSchema),
}
export const forgeDestinationGuardFields = {
  expectedDestination: Schema.optional(forgeIdentityTokenSchema),
}
export const forgeSourceIdentitySchema = mutableStruct({
  readerIdentity: forgeIdentityTokenSchema,
  destination: forgeIdentityTokenSchema,
})
export type ForgeSourceIdentity = typeof forgeSourceIdentitySchema.Type
export const forgeSourceIdentityQuerySchema = refine(
  mutableStruct({
    repositoryId: Schema.optional(maxValue(minValue(Schema.String, 1), 4096)),
    refresh: Schema.optional(Schema.Boolean),
    connectionId: Schema.optional(maxValue(minValue(Schema.String, 1), 200)),
    jiraSourceId: Schema.optional(maxValue(minValue(Schema.String, 1), 200)),
  }),
  (value) => !!value.repositoryId !== !!value.jiraSourceId,
  'Choose exactly one source',
)
