import { createHmac, randomBytes } from 'node:crypto'
import { Schema } from 'effect'
import { decode, customTurnSchema, normalizeTurnUrl, type PeerRelay } from '@dovo/protocol'
import { casdoor, type IdentityProvider } from './oidc.js'
import { hash, type AccountStore } from './store.js'
import { managedRelayCredentials, type PeerRelayIssuer } from './relay-credentials.js'

const text = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(2048)),
)
const configSchema = Schema.Array(
  Schema.Struct({
    id: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,63}$/))),
    name: text,
    issuer: text,
    clientId: text,
    clientSecret: Schema.optional(text),
    endpointOrigins: Schema.optional(Schema.Array(text)),
    requiredClaim: Schema.optional(
      Schema.Struct({
        name: text,
        values: Schema.Array(text).pipe(Schema.check(Schema.isMinLength(1))),
      }),
    ),
    sessionHours: Schema.optional(
      Schema.Number.pipe(Schema.check(Schema.isBetween({ minimum: 0.25, maximum: 8 }))),
    ),
    hourlyLimit: Schema.optional(Schema.Number),
    relay: Schema.Union([
      customTurnSchema,
      Schema.Struct({
        urls: customTurnSchema.fields.urls,
        secret: text.pipe(Schema.check(Schema.isMinLength(32))),
      }),
    ]),
  }),
).pipe(Schema.check(Schema.isMaxLength(20)))
export type Organization = {
  id: string
  name: string
  policy: string
  provider: IdentityProvider
  endpointOrigins: readonly string[]
  issue: PeerRelayIssuer
}

/** This file is a broker administrator trust boundary, never client-submitted discovery. */
export function organizations(value: unknown, origin: string): Organization[] {
  const configs = decode(configSchema, value)
  if (new Set(configs.map((config) => config.id)).size !== configs.length)
    throw new Error('Organization IDs must be unique')
  return configs.map((config) => {
    const endpointOrigins = config.endpointOrigins ?? []
    for (const endpoint of endpointOrigins) {
      const url = new URL(endpoint)
      if (url.origin !== endpoint || url.protocol !== 'https:')
        throw new Error('OIDC endpoint origins must be HTTPS origins')
    }
    const policy = hash(
      JSON.stringify([
        config.id,
        config.issuer,
        config.clientId,
        config.requiredClaim ?? null,
        endpointOrigins,
        config.sessionHours ?? 8,
      ]),
    )
    const urls = [...new Set(config.relay.urls.map(normalizeTurnUrl))]
    const issue = managedRelayCredentials(
      async (installation) => {
        const expiresAt = Math.floor(Date.now() / 1000) * 1000 + 600_000
        let username: string, credential: string
        if ('secret' in config.relay) {
          username = `${expiresAt / 1000}:org-${config.id}-${hash(installation ?? '').slice(0, 16)}-${randomBytes(12).toString('hex')}`
          credential = createHmac('sha1', config.relay.secret).update(username).digest('base64')
        } else {
          username = config.relay.username
          credential = config.relay.credential
        }
        return {
          provider: 'custom',
          expiresAt,
          iceServers: [{ urls, username, credential }],
        } satisfies PeerRelay
      },
      { hourlyLimit: config.hourlyLimit },
    )
    return {
      id: config.id,
      name: config.name,
      policy,
      endpointOrigins,
      issue,
      provider: casdoor({
        ...config,
        origin,
        organization: {
          id: config.id,
          name: config.name,
          policy,
          sessionHours: config.sessionHours ?? 8,
        },
      }),
    }
  })
}
export async function organizationRelay(
  configs: readonly Organization[],
  store: AccountStore,
  host: { session: string; identity: string },
) {
  const membership = store.organizationSession(host.session)
  const organization = configs.find((config) => config.id === membership?.id)
  if (!organization) return undefined
  try {
    const relay = await organization.issue(host.identity, 'organization', host.identity)
    return { name: organization.name, relay }
  } catch {
    // Credential quota/outage is a relay failure, not loss of account authorization.
    return { name: organization.name, unavailable: true as const }
  }
}
