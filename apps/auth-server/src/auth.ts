import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { getMigrations } from 'better-auth/db/migration'
import { jwt } from 'better-auth/plugins'
import { oauthProvider } from '@better-auth/oauth-provider'

const hashClientSecret = (value: string) => createHash('sha256').update(value).digest('base64url')

export async function createAuth(options: {
  path: string
  origin: string
  secret: string
  github: { clientId: string; clientSecret: string }
  connectOrigin: string
  clientId: string
  clientSecret: string
  owners?: Readonly<Record<string, string>>
}) {
  if (options.secret.length < 32 || options.clientSecret.length < 32)
    throw new Error('Configure persistent 32+ character auth and Connect client secrets')
  if (!options.github.clientId || !options.github.clientSecret || !options.clientId)
    throw new Error('Configure GitHub credentials and a Connect client ID')
  const origin = new URL(options.origin).origin
  const db = new DatabaseSync(options.path)
  db.exec('PRAGMA journal_mode=WAL')
  const ownerId = (userId: string) => {
    const account = db
      .prepare('SELECT accountId FROM account WHERE userId=? AND providerId=?')
      .get(userId, 'github')
    if (typeof account?.accountId !== 'string') throw new Error('GitHub identity is required')
    return options.owners?.[account.accountId] ?? `auth:${userId}`
  }
  const config = {
    appName: 'Dovo Studio',
    baseURL: origin,
    basePath: '/api/auth',
    secret: options.secret,
    database: db,
    trustedOrigins: [origin],
    onAPIError: { errorURL: origin + '/error' },
    socialProviders: { github: options.github },
    account: { encryptOAuthTokens: true, accountLinking: { enabled: false } },
    session: { expiresIn: 8 * 3600, cookieCache: { enabled: false } },
    advanced: { useSecureCookies: origin.startsWith('https:') },
    disabledPaths: ['/token'],
    plugins: [
      jwt({ jwks: { keyPairConfig: { alg: 'ES256' } } }),
      oauthProvider({
        loginPage: '/sign-in',
        consentPage: '/consent',
        scopes: ['openid', 'profile'],
        grantTypes: ['authorization_code'],
        allowDynamicClientRegistration: false,
        clientPrivileges: () => false,
        cachedTrustedClients: new Set([options.clientId]),
        storeClientSecret: {
          hash: hashClientSecret,
        },
        customIdTokenClaims: ({ user }) => ({
          'https://dovo.studio/account_id': ownerId(user.id),
          name: user.name,
        }),
      }),
    ],
  } satisfies BetterAuthOptions
  try {
    await (await getMigrations(config)).runMigrations()
    const auth = betterAuth(config)
    // Register one operator-controlled first-party client; browser users cannot register clients.
    const context = await auth.$context
    const existing = await context.adapter.findOne<{ id: string }>({
      model: 'oauthClient',
      where: [{ field: 'clientId', value: options.clientId }],
    })
    const client = {
      clientId: options.clientId,
      clientSecret: hashClientSecret(options.clientSecret),
      name: 'Dovo Connect',
      redirectUris: [new URL('/auth/callback', options.connectOrigin).href],
      tokenEndpointAuthMethod: 'client_secret_post',
      grantTypes: ['authorization_code'],
      responseTypes: ['code'],
      scopes: ['openid', 'profile'],
      skipConsent: true,
      requirePKCE: true,
      disabled: false,
      clientSecretExpiresAt: null,
    }
    if (existing)
      await context.adapter.update({
        model: 'oauthClient',
        where: [{ field: 'clientId', value: options.clientId }],
        update: client,
      })
    else await context.adapter.create({ model: 'oauthClient', data: client })
    return {
      auth,
      connectOrigin: new URL(options.connectOrigin).origin,
      db,
      ownerId,
      async deleteIdentity(id: string) {
        const existingOwner = Object.entries(options.owners ?? {}).find(([, owner]) => owner === id)
        const row = existingOwner
          ? db
              .prepare('SELECT userId AS id FROM account WHERE providerId=? AND accountId=?')
              .get('github', existingOwner[0])
          : id.startsWith('auth:')
            ? { id: id.slice(5) }
            : undefined
        if (row && typeof row.id === 'string') await context.internalAdapter.deleteUser(row.id)
      },
      close: () => db.close(),
    }
  } catch (error) {
    db.close()
    throw error
  }
}
