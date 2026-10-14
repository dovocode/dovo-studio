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
): Promise<SourceContext> {
  const validateBinding = validate
  let authorized = true
  validate = () => {
    validateBinding()
    if (!authorized)
      throw new HttpError(
        401,
        'Authentication failed for this source. Check the account on this runtime and refresh.',
      )
  }
  const unauthorized = () => {
    authorized = false
    if (connection) connections.forgetCredentials(connection.id)
  }
  validate()
  const provider = connection?.provider ?? 'github'
  let github: SourceContext['github']
  let http: ForgeHttp | undefined
  let account: string
  if (provider === 'github') {
    if (connection) connections.forgetCredentials(connection.id)
    const token = connection ? await connections.githubToken(connection.id, cwd) : undefined
    github = token
      ? {
          host,
          token,
          env: connection?.cliEnv,
          onUnauthorized: unauthorized,
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
    const user = decode(
      mutableStruct({
        id: Schema.Number.pipe(Schema.check(Schema.isInt()), Schema.check(Schema.isGreaterThan(0))),
        login: forgeIdentityTokenSchema,
      }),
      JSON.parse(
        await git.githubAccount(['api', '--hostname', host, 'user'], undefined, cwd, credential),
      ),
    )
    if (connection?.cliProfile && user.login.toLowerCase() !== connection.cliProfile.toLowerCase())
      throw new HttpError(409, 'The selected GitHub profile changed. Refresh before continuing.')
    account = String(user.id)
  } else {
    if (!connection) throw new HttpError(409, 'Connect this provider account before continuing.')
    connections.forgetCredentials(connection.id)
    const authorization = await connections.authorization(connection.id, false, cwd)
    http = new ForgeHttp(
      connection,
      () => {
        validate()
        return authorization
      },
      fetch,
      unauthorized,
    )
    if (provider === 'gitlab')
      account = String(
        decode(
          mutableStruct({
            id: Schema.Number.pipe(
              Schema.check(Schema.isInt()),
              Schema.check(Schema.isGreaterThan(0)),
            ),
          }),
          await http.json('api/v4/user'),
        ).id,
      )
    else if (provider === 'bitbucket')
      account = decode(
        mutableStruct({ uuid: forgeIdentityTokenSchema }),
        await http.json('user'),
      ).uuid
    else if (provider === 'azure-devops')
      account = decode(
        mutableStruct({ authenticatedUser: mutableStruct({ id: forgeIdentityTokenSchema }) }),
        await http.json('_apis/connectionData?connectOptions=1&lastChangeId=-1&lastChangeId64=-1'),
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
          await http.json('api/v1/user'),
        ).id,
      )
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
