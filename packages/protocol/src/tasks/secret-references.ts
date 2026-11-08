import { Schema } from 'effect'
import { mutableStruct, minValue, maxValue, decodeResult } from '../shared/schema.js'

const validEnvironmentName = (name: string) =>
  /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) &&
  !['DOVO_OWNER_TOKEN', 'ELECTRON_RUN_AS_NODE'].includes(name.toUpperCase())
export const agentEnvironmentNameSchema = Schema.String.pipe(
  Schema.check(Schema.makeFilter(validEnvironmentName)),
)
const name = maxValue(minValue(Schema.String, 1), 1024)
const identifier = name.pipe(Schema.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)))
export const agentSecretReferenceSchema = Schema.Union([
  mutableStruct({ provider: Schema.Literal('environment'), reference: agentEnvironmentNameSchema }),
  mutableStruct({
    provider: Schema.Literal('onepassword'),
    reference: name.pipe(
      Schema.check(Schema.isPattern(/^op:\/\/[^\r\n\0]+\/[^\r\n\0]+\/[^\r\n\0]+$/)),
    ),
    account: Schema.optional(identifier),
  }),
  mutableStruct({
    provider: Schema.Literal('bitwarden'),
    reference: identifier,
    field: Schema.optional(Schema.Literals(['password', 'username', 'totp'])),
  }),
  mutableStruct({
    provider: Schema.Literal('infisical'),
    reference: agentEnvironmentNameSchema,
    projectId: identifier,
    environment: identifier,
    path: name.pipe(Schema.check(Schema.isPattern(/^\/[^\r\n\0]*$/))),
    domain: Schema.optional(
      name.pipe(
        Schema.check(
          Schema.makeFilter((value) => {
            try {
              const url = new URL(value)
              return (
                ['http:', 'https:'].includes(url.protocol) &&
                !url.username &&
                !url.password &&
                !url.search &&
                !url.hash
              )
            } catch {
              return false
            }
          }),
        ),
      ),
    ),
  }),
])
export const agentSecretReferencesSchema = Schema.Record(
  Schema.String,
  agentSecretReferenceSchema,
).pipe(
  Schema.check(
    Schema.makeFilter(
      (refs) => Object.keys(refs).length <= 64 && Object.keys(refs).every(validEnvironmentName),
    ),
  ),
)
export type AgentSecretReference = typeof agentSecretReferenceSchema.Type
export type AgentSecretReferences = typeof agentSecretReferencesSchema.Type
export const secretReferenceProviders = [
  { id: 'onepassword', name: '1Password' },
  { id: 'bitwarden', name: 'Bitwarden' },
  { id: 'infisical', name: 'Infisical' },
  { id: 'environment', name: 'Host environment' },
] as const
export function defaultSecretReference(
  provider: AgentSecretReference['provider'],
): AgentSecretReference {
  if (provider === 'infisical')
    return { provider, reference: '', projectId: '', environment: 'dev', path: '/' }
  return { provider, reference: '' }
}
export function secretReferenceIssue(references: AgentSecretReferences | undefined) {
  for (const [name, reference] of Object.entries(references ?? {}))
    if (
      !decodeResult(agentEnvironmentNameSchema, name).success ||
      !decodeResult(agentSecretReferenceSchema, reference).success
    )
      return `Complete the secret reference for ${name}.`
  if (Object.keys(references ?? {}).length > 64)
    return 'Use at most 64 secret references per agent.'
  return ''
}
