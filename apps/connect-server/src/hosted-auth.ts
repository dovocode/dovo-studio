import { DatabaseSync } from 'node:sqlite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { getMigrations } from 'better-auth/db/migration'
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node'
import type { IdentityProvider } from './oidc.js'
import { hash, secret } from './store.js'
import { RequestError } from './http.js'

/** Hosted browser identity only. Runtime and artifact capabilities remain separately scoped. */
export async function hostedAuth(options: {
  path: string
  origin: string
  secret: string
  github: { clientId: string; clientSecret: string }
  /** Operator-verified GitHub subject -> existing Dovo owner ID; never match by email. */
  owners?: Readonly<Record<string, string>>
}) {
  if (options.secret.length < 32) throw new Error('Configure a random 32+ character auth secret')
  if (!options.github.clientId || !options.github.clientSecret)
    throw new Error('Configure GitHub OAuth client ID and secret')
  const origin = new URL(options.origin).origin
  const db = new DatabaseSync(options.path)
  db.exec('PRAGMA journal_mode=WAL')
  const config = {
    appName: 'Dovo Studio',
    baseURL: origin,
    basePath: '/api/auth',
    secret: options.secret,
    database: db,
    trustedOrigins: [origin],
    socialProviders: { github: options.github },
    account: { encryptOAuthTokens: true, accountLinking: { enabled: false } },
    session: { expiresIn: 8 * 3600, cookieCache: { enabled: false } },
    advanced: { useSecureCookies: origin.startsWith('https:') },
  } satisfies BetterAuthOptions
  try {
    await (await getMigrations(config)).runMigrations()
  } catch (error) {
    db.close()
    throw error
  }
  const auth = betterAuth(config)
  const nodeHandler = toNodeHandler(auth)
  const provider: IdentityProvider = {
    authorizationOrigin: 'https://github.com',
    async authorize(login) {
      login.state = secret()
      // A one-use completion secret is also bound to the requesting browser by browserAuth.
      login.verifier = secret()
      const callback = new URL('/auth/callback', origin)
      callback.search = new URLSearchParams({ state: login.state, code: login.verifier }).toString()
      const response = await auth.api.signInSocial({
        body: { provider: 'github', callbackURL: callback.href },
        asResponse: true,
      })
      const data: unknown = await response.json()
      if (
        !response.ok ||
        !data ||
        typeof data !== 'object' ||
        !('url' in data) ||
        typeof data.url !== 'string'
      )
        throw new RequestError(502, 'Sign-in is temporarily unavailable')
      // OAuth state cookies must reach the same browser; consumed once by browserAuth.
      login.identityCookies = response.headers.getSetCookie()
      return data.url
    },
    async exchange(login, code, headers) {
      if (!login.verifier || hash(code) !== hash(login.verifier) || !headers)
        throw new RequestError(400, 'Sign-in request did not match')
      const session = await auth.api.getSession({ headers: fromNodeHeaders(headers) })
      if (!session) throw new RequestError(401, 'Sign in again')
      const account = db
        .prepare('SELECT accountId FROM account WHERE userId=? AND providerId=?')
        .get(session.user.id, 'github')
      if (typeof account?.accountId !== 'string') throw new RequestError(401, 'Sign in again')
      return {
        id: options.owners?.[account.accountId] ?? `auth:${session.user.id}`,
        name: session.user.name,
      }
    },
  }
  return {
    ...provider,
    auth,
    db,
    async handle(this: void, req: IncomingMessage, res: ServerResponse, url: URL) {
      if (!url.pathname.startsWith('/api/auth/')) return false
      await nodeHandler(req, res)
      return true
    },
    async deleteIdentity(this: void, id: string) {
      const existing = Object.entries(options.owners ?? {}).find(([, owner]) => owner === id)
      const row = existing
        ? db
            .prepare('SELECT userId AS id FROM account WHERE providerId=? AND accountId=?')
            .get('github', existing[0])
        : id.startsWith('auth:')
          ? { id: id.slice(5) }
          : undefined
      if (!row || typeof row.id !== 'string') return
      const context = await auth.$context
      await context.internalAdapter.deleteUser(row.id)
    },
    close: () => db.close(),
  }
}

/** Explicit administrator mapping, never inferred from email, name or number of users. */
export function ownerMappings(value: unknown): Readonly<Record<string, string>> {
  if (!Array.isArray(value) || value.length > 1000) throw new Error('Invalid auth owner mappings')
  const owners: Record<string, string> = {}
  const ids = new Set<string>()
  for (const item of value) {
    if (
      !item ||
      typeof item !== 'object' ||
      !('githubId' in item) ||
      typeof item.githubId !== 'string' ||
      !/^[1-9][0-9]{0,19}$/.test(item.githubId) ||
      !('accountId' in item) ||
      typeof item.accountId !== 'string' ||
      !item.accountId ||
      item.accountId.length > 200 ||
      owners[item.githubId] ||
      ids.has(item.accountId)
    )
      throw new Error('Invalid or duplicate auth owner mapping')
    owners[item.githubId] = item.accountId
    ids.add(item.accountId)
  }
  return owners
}
