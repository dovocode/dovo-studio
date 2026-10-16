import { isDeepStrictEqual } from 'node:util'
import { Schema } from 'effect'
import {
  decode,
  mutableStruct,
  type githubConnectionCheckQuerySchema,
  type GithubConnectionCheck,
} from '@dovo/protocol'
import type { Services } from '../../../services.js'
import { HttpError } from '../../../errors.js'
import { GithubApiError } from '../../git/github-transport.js'
import { ProcessError } from '../../../process.js'
import { verifySourceContext, type SourceContext } from './source-context.js'

/** Read-only diagnostics use the same captured credential and binding guards as PR reads. */
export async function checkGithubConnection(
  s: Pick<Services, 'git' | 'forges' | 'pulls' | 'store'>,
  input: Schema.Schema.Type<typeof githubConnectionCheckQuerySchema>,
): Promise<GithubConnectionCheck> {
  const project = input.repositoryId
    ? s.store.get().repositories.find((repo) => repo.id === input.repositoryId)
    : undefined
  if (input.repositoryId && !project) throw new HttpError(404, 'Project not found')
  const connection = input.connectionId ? s.forges.get(input.connectionId) : undefined
  if (connection && connection.provider !== 'github')
    throw new HttpError(400, 'Choose a GitHub connection')
  if (project && project.forge?.connectionId !== input.connectionId)
    throw new HttpError(409, 'This project connection changed. Reload connections before testing.')
  const validate = () => {
    if (connection && s.forges.get(connection.id).revision !== connection.revision)
      throw new HttpError(409, 'This connection changed. Reload connections before testing.')
    const current = project && s.store.get().repositories.find((repo) => repo.id === project.id)
    if (
      project &&
      (!current ||
        current.path !== project.path ||
        !isDeepStrictEqual(current.forge, project.forge))
    )
      throw new HttpError(409, 'This project changed. Reload connections before testing.')
  }
  let host = connection ? new URL(connection.baseUrl).hostname : 'github.com'
  let stage: GithubConnectionCheck['stage'] = project && !connection ? 'discovery' : 'account'
  let login: string | undefined
  let repository = project?.forge?.repository
  const result = (
    status: GithubConnectionCheck['status'],
    message: string,
  ): GithubConnectionCheck => ({
    status,
    stage,
    host,
    login,
    repository,
    checkedAt: new Date().toISOString(),
    message,
  })
  try {
    let scope: SourceContext
    if (project && !connection) {
      scope = await s.pulls.sourceContext(project.path, input.refresh === true)
      host = scope.host
      repository = scope.repository
    } else {
      scope = await verifySourceContext(
        s.git,
        s.forges,
        project?.path ?? process.cwd(),
        repository ?? '',
        host,
        connection,
        [project?.id, connection?.id],
        validate,
        input.refresh === true,
      )
    }
    validate()
    scope.validate()
    login = scope.viewerLogin
    if (!scope.github || !login) throw new HttpError(400, 'Choose a GitHub source')
    if (repository) {
      stage = 'repository'
      decode(
        mutableStruct({ full_name: Schema.String }),
        JSON.parse(
          await s.git.githubAccount(
            [
              'api',
              '--hostname',
              host,
              `repos/${repository.split('/').map(encodeURIComponent).join('/')}`,
            ],
            undefined,
            project?.path,
            scope.github,
          ),
        ),
      )
      validate()
      scope.validate()
      stage = 'actions'
      decode(
        mutableStruct({ total_count: Schema.Number }),
        JSON.parse(
          await s.git.githubAccount(
            [
              'api',
              '--hostname',
              host,
              `repos/${repository.split('/').map(encodeURIComponent).join('/')}/actions/runs?per_page=1`,
            ],
            undefined,
            project?.path,
            scope.github,
          ),
        ),
      )
      validate()
      scope.validate()
      return result(
        'verified',
        'Account verified · Repository and Actions runs readable. Write permissions and branch rules are checked when you act.',
      )
    }
    return result('verified', 'Account verified. Test a project below to check repository access.')
  } catch (error) {
    const status =
      error instanceof HttpError || error instanceof GithubApiError ? error.status : undefined
    if (
      status === 409 ||
      (status === 404 && stage !== 'repository' && stage !== 'actions' && connection)
    )
      throw error
    if (status === 429)
      return result(
        'failed',
        'GitHub rate limit reached. Wait for the quota to reset before testing again; cached PR data remains available.',
      )
    if (
      status === 401 ||
      (error instanceof ProcessError && stage === 'account') ||
      (status === 400 &&
        stage === 'account' &&
        (connection?.credential === 'token' || connection?.credential === 'environment'))
    )
      return result(
        'failed',
        connection?.credential === 'token' || connection?.credential === 'environment'
          ? 'GitHub rejected or could not load this token. Check its value and expiry on this computer, then test again.'
          : `Check GitHub CLI authentication on this computer: gh auth login --hostname ${host}. Then test again.`,
      )
    if (stage === 'actions' && (status === 403 || status === 404))
      return result(
        'failed',
        'Account verified · Repository readable, but Actions access could not be verified. Enable GitHub Actions for this repository and grant this account or token Actions read access; check organization SSO authorization. Polling requires Actions read access. Rerun and cancel permissions are checked when you act.',
      )
    if (status === 403 || (status === 404 && stage === 'repository'))
      return result(
        'failed',
        'Access could not be verified. Check repository access, token permissions and organization SSO authorization for this account.',
      )
    if (stage === 'discovery')
      return result(
        'failed',
        'Could not resolve this checkout’s GitHub connection. Check its Git remote, the configured gh command and GitHub CLI login on this computer, then test again.',
      )
    return result(
      'failed',
      'GitHub could not be reached or returned an invalid response. Check this computer’s network and connection configuration, then test again.',
    )
  }
}
