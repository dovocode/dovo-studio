import { Schema } from 'effect'
import {
  strictStruct,
  mutableStruct,
  mutableArray,
  minValue,
  maxValue,
  decodeResult,
} from '../../shared/schema.js'
import { agentSchema } from '../../workspace.js'

const label = maxValue(minValue(Schema.String.pipe(Schema.decodeTo(Schema.Trim)), 1), 200)
const providerOverride = strictStruct({
  locked: Schema.Boolean,
  executablePath: agentSchema.fields.executablePath,
  configDirectory: agentSchema.fields.configDirectory,
  args: agentSchema.fields.args,
  env: agentSchema.fields.env,
})
const updatePolicy = strictStruct({
  mode: Schema.Literals(['auto', 'off']),
  allowNightly: Schema.optional(Schema.Boolean),
  feedUrl: Schema.optional(
    Schema.String.pipe(
      Schema.check(
        Schema.makeFilter((value) => {
          try {
            const url = new URL(value)
            return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
          } catch {
            return false
          }
        }),
      ),
    ),
  ),
})
export const managedPolicyLimitsSchema = strictStruct({
  maxPermission: Schema.optional(agentSchema.fields.permission),
  clients: Schema.optional(
    minValue(mutableArray(Schema.Literals(['desktop', 'local-browser', 'remote'])), 1),
  ),
  sharing: Schema.optional(Schema.Boolean),
  connect: Schema.optional(Schema.Boolean),
  webhookTasks: Schema.optional(Schema.Boolean),
  browserCookieImport: Schema.optional(Schema.Boolean),
  telemetry: Schema.optional(Schema.Literal(false)),
  providers: Schema.optional(
    strictStruct({
      allowed: Schema.optional(minValue(mutableArray(agentSchema.fields.provider), 1)),
      instances: Schema.optional(
        Schema.Record(Schema.String, providerOverride).pipe(
          Schema.check(
            Schema.makeFilter((instances) =>
              Object.keys(instances).every(
                (provider) => decodeResult(agentSchema.fields.provider, provider).success,
              ),
            ),
          ),
        ),
      ),
    }),
  ),
  updates: Schema.optional(updatePolicy),
})
export const managedPolicySchema = strictStruct({
  schemaVersion: Schema.Literal(1),
  organization: label,
  supportUrl: Schema.optional(
    Schema.String.pipe(
      Schema.check(
        Schema.makeFilter((value) => {
          try {
            const url = new URL(value)
            return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
          } catch {
            return false
          }
        }),
      ),
    ),
  ),
  settings: Schema.optional(
    Schema.Record(Schema.String, strictStruct({ value: Schema.Unknown, locked: Schema.Boolean })),
  ),
  limits: Schema.optional(managedPolicyLimitsSchema),
})
export type ManagedPolicyDocument = typeof managedPolicySchema.Type

// Wire summaries contain neither environment values nor update-feed credentials/paths.
export const managedPolicySummarySchema = mutableStruct({
  organization: label,
  supportUrl: Schema.optional(Schema.String),
  fingerprint: Schema.String,
  lockedSettings: mutableArray(Schema.String),
  maxPermission: Schema.optional(agentSchema.fields.permission),
  allowedProviders: Schema.optional(mutableArray(agentSchema.fields.provider)),
  allowedClients: Schema.optional(
    mutableArray(Schema.Literals(['desktop', 'local-browser', 'remote'])),
  ),
  disabledCapabilities: mutableArray(Schema.String),
  lockedProviderFields: Schema.Record(Schema.String, mutableArray(Schema.String)),
})
export type ManagedPolicySummary = typeof managedPolicySummarySchema.Type

export function managedPolicyMessage(
  policy: Pick<ManagedPolicySummary, 'organization'>,
  capability: string,
) {
  return `${policy.organization}'s policy does not allow ${capability}.`
}
