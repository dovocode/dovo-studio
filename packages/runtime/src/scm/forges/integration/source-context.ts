import { createHash } from 'node:crypto'
import { Schema } from 'effect'
import {
  decode,
  mutableStruct,
  forgeIdentityTokenSchema,
  type ForgeConnection,
  type ForgeSourceIdentity,
} from '@dovo/protocol'
import type { GitService } from '../../git/git.js'
import type { ForgeConnections } from './forge-connections.js'
import { ForgeHttp } from './forge-http.js'
import { HttpError } from '../../../errors.js'

export function opaqueIdentity(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
type VerifiedAccount = { account: string; login?: string }
type Verification = {
  valid: boolean
  settled: boolean
  expires: number
  value: Promise<VerifiedAccount>
}
// Runtime-private: only a digest of the captured credential is used as the key.
const accounts = new WeakMap<GitService, Map<string, Verification>>()
function verifyAccount(
  git: GitService,
  key: string,
  refresh: boolean,
  load: () => Promise<VerifiedAccount>,
) {
  let cache = accounts.get(git)
  if (!cache) accounts.set(git, (cache = new Map()))
  const previous = cache.get(key)
  if (previous?.valid && previous.expires > Date.now() && (!refresh || !previous.settled))
    return previous
  if (previous && refresh) previous.valid = false
  const entry: Verification = {
    valid: true,
    settled: false,
    expires: Date.now() + 600_000,
    value: Promise.resolve().then(load),
  }
  cache.set(key, entry)
  while (cache.size > 256) cache.delete(cache.keys().next().value!)
  void entry.value.then(
    () => {
      entry.settled = true
    },
    () => {
      entry.valid = false
      entry.settled = true
      if (cache.get(key) === entry) cache.delete(key)
    },
  )
  return entry
}

export function guardSource(
  identity: ForgeSourceIdentity,
  input: { expectedDestination?: string; expectedReaderIdentity?: string },
) {
  if (input.expectedDestination !== undefined && input.expectedDestination !== identity.destination)
    throw new HttpError(
      409,
      'This integration destination or account changed. Refresh before continuing; your draft can be kept.',
    )
  if (
    input.expectedReaderIdentity !== undefined &&
    input.expectedReaderIdentity !== identity.readerIdentity
  )
    throw new HttpError(409, 'This integration reader account changed. Refresh before continuing.')
}
export type SourceContext = ForgeSourceIdentity & {
  provider: ForgeConnection['provider']
  repository: string
  host: string
  connection?: ForgeConnection
  http?: ForgeHttp
  github?: Awaited<ReturnType<GitService['githubCredential']>>
  validate: () => void
  viewerLogin?: string
}
/** Verify with the captured credential, then use that very credential for every request.
 * No global account switching and no writes are attempted during discovery. */
export async function verifySourceContext(
  git: GitService,
  connections: ForgeConnections,
  cwd: string,
  repository: string,
  host: string,
  connection: ForgeConnection | undefined,
  binding: unknown,
  validate: () => void,
  refresh = false,
): Promise<SourceContext> {
  const validateBinding = validate
  let authorized = true
  let verification: Verification | undefined
  validate = () => {
    validateBinding()
    if (!authorized || verification?.valid === false)
      throw new HttpError(
        401,
        'Authentication failed for this source. Check the account on this runtime and refresh.',
      )
  }
  const unauthorized = () => {
    authorized = false
    if (verification) verification.valid = false
    if (connection && connection.provider !== 'github') connections.forgetCredentials(connection.id)
  }
  validate()
  const provider = connection?.provider ?? 'github'
  let github: SourceContext['github']
  let http: ForgeHttp | undefined
  let account: string
  if (provider === 'github') {
    if (connection && refresh) connections.forgetCredentials(connection.id)
    const selected = connection ? await connections.githubCredential(connection.id, cwd) : undefined
    github = selected?.token
      ? {
          host,
          token: selected.token,
          env: connection?.cliEnv,
          onUnauthorized: selected.onUnauthorized,
          beforeDispatch: validate,
        }
      : await git.githubCredential(cwd, host, connection?.cliEnv, true)
    github.beforeDispatch = validate
    const credential = github
    const invalidate = credential.onUnauthorized
    credential.onUnauthorized = () => {
      invalidate?.()
      unauthorized()
    }
    validate()
    const key = opaqueIdentity([
      provider,
      host.toLowerCase(),
      connection?.id,
      connection?.revision,
      credential.token,
    ])
    verification = verifyAccount(git, key, refresh, async () => {
      const user = decode(
        mutableStruct({
          id: Schema.Number.pipe(
            Schema.check(Schema.isInt()),
            Schema.check(Schema.isGreaterThan(0)),
          ),
          login: forgeIdentityTokenSchema,
        }),
        JSON.parse(
          await git.githubAccount(['api', '--hostname', host, 'user'], undefined, cwd, credential),
        ),
      )
      if (
        connection?.cliProfile &&
        user.login.toLowerCase() !== connection.cliProfile.toLowerCase()
      )
        throw new HttpError(409, 'The selected GitHub profile changed. Refresh before continuing.')
      return { account: String(user.id), login: user.login }
    })
    account = (await verification.value).account
    git.confirmGithubHost(new URL(connection?.baseUrl ?? `https://${host}`).host)
  } else {
    if (!connection) throw new HttpError(409, 'Connect this provider account before continuing.')
    if (refresh) connections.forgetCredentials(connection.id)
    const authorization = await connections.authorization(connection.id, false, cwd)
    const providerHttp = new ForgeHttp(
      connection,
      () => {
        validate()
        return authorization
      },
      fetch,
      unauthorized,
    )
    http = providerHttp
    const key = opaqueIdentity([
      provider,
      connection.baseUrl,
      connection.id,
      connection.revision,
      authorization,
    ])
    verification = verifyAccount(git, key, refresh, async () => {
      let account: string
      if (provider === 'gitlab')
        account = String(
          decode(
            mutableStruct({
              id: Schema.Number.pipe(
                Schema.check(Schema.isInt()),
                Schema.check(Schema.isGreaterThan(0)),
              ),
            }),
            await providerHttp.json('api/v4/user'),
          ).id,
        )
      else if (provider === 'bitbucket')
        account = decode(
          mutableStruct({ uuid: forgeIdentityTokenSchema }),
          await providerHttp.json('user'),
        ).uuid
      else if (provider === 'azure-devops')
        account = decode(
          mutableStruct({ authenticatedUser: mutableStruct({ id: forgeIdentityTokenSchema }) }),
          await providerHttp.json(
            '_apis/connectionData?connectOptions=1&lastChangeId=-1&lastChangeId64=-1',
          ),
        ).authenticatedUser.id
      else
        account = String(
          decode(
            mutableStruct({
              id: Schema.Number.pipe(
                Schema.check(Schema.isInt()),
                Schema.check(Schema.isGreaterThan(0)),
              ),
            }),
            await providerHttp.json('api/v1/user'),
          ).id,
        )
      return { account }
    })
    account = (await verification.value).account
  }
  validate()
  const instance = connection
    ? new URL(connection.baseUrl).href.replace(/\/$/, '')
    : `https://${host}`
  const readerIdentity = opaqueIdentity([provider, instance, account])
  return {
    provider,
    host,
    repository,
    connection,
    http,
    github,
    viewerLogin: (await verification.value).login,
    validate,
    readerIdentity,
    destination: opaqueIdentity([
      binding,
      connection?.id,
      connection?.revision,
      provider,
      instance,
      repository.toLowerCase(),
      readerIdentity,
    ]),
  }
}
