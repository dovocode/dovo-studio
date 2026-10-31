import { GithubApiError, type GithubApiRequest } from './github-transport.js'

export type GithubCredentialSource = 'settings' | 'environment' | 'gh' | 'gh-wrapper'
/** Non-secret provenance captured before a credential is injected into the CLI environment. */
export type GithubAccessContext = {
  host: string
  repository?: string
  login?: string
  source?: GithubCredentialSource
}

export function githubRequestRepository(request: GithubApiRequest): string | undefined {
  const match = /^\/?repos\/([^/]+)\/([^/?#]+)/.exec(request.path)
  if (!match) return
  try {
    return `${decodeURIComponent(match[1]!)}/${decodeURIComponent(match[2]!)}`
  } catch {
    return
  }
}

/** Preserve typed rejection/rate-limit handling and never copy upstream error bodies. */
export function githubAccessError(error: unknown, context: GithubAccessContext): unknown {
  if (
    !(error instanceof GithubApiError) ||
    error.rateLimit ||
    ![401, 403, 404].includes(error.status)
  )
    return error
  const host = /^[a-zA-Z0-9.-]+(?::\d+)?$/.test(context.host) ? context.host : 'GitHub'
  const repository =
    context.repository && /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(context.repository)
      ? ` · ${context.repository}`
      : ''
  const login = context.login && /^[a-zA-Z0-9_-]+$/.test(context.login) ? ` · ${context.login}` : ''
  const sourceNames = {
    settings: 'saved GitHub token',
    environment: 'runtime environment token',
    gh: 'GitHub CLI login',
    'gh-wrapper': 'configured GitHub CLI wrapper',
  }
  const source = context.source ? sourceNames[context.source] : 'selected GitHub credential'
  const repair =
    context.source === 'environment'
      ? 'Update its token on the runtime computer, or change the selected connection in Settings → Source Control.'
      : context.source === 'settings'
        ? 'Update the saved token in Settings → Source Control.'
        : context.source === 'gh-wrapper'
          ? 'Check the configured GitHub CLI wrapper on the runtime computer.'
          : context.source === 'gh'
            ? `Check gh auth login --hostname ${host} on the runtime computer.`
            : 'Check the selected connection in Settings → Source Control.'
  const reason =
    error.status === 401
      ? 'GitHub rejected this credential.'
      : error.status === 404
        ? 'The repository or item is missing or inaccessible to this credential.'
        : 'This credential does not have access to this operation.'
  return new GithubApiError(
    error.status,
    `${reason} ${host}${repository}${login} · ${source}. ${repair} Check repository access, token permissions and organization SSO authorization; use the connection check in Settings → Source Control. (HTTP ${error.status})`,
    error.retryAfter,
    error.rateLimit,
  )
}
