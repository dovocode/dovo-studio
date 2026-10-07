import { createHash } from 'node:crypto'
import { exec, ProcessError } from '../../process.js'

/** A GitHub request described the way call sites already do: as `gh api` arguments. The
 * transport sends it to GitHub's API itself; `gh` only mints the token (see GithubCredentials). */
export type GithubApiRequest = {
  host: string
  method: string
  graphql: boolean
  path: string
  query: [string, string][]
  fields: Record<string, unknown>
  body?: string
  paginate: boolean
  slurp: boolean
}
export class GithubApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message)
  }
}
const typed = (value: string): unknown => {
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === 'null') return null
  if (/^-?\d+$/.test(value)) return Number(value)
  return value
}
function assign(fields: Record<string, unknown>, key: string, value: unknown) {
  if (key.endsWith('[]')) {
    const name = key.slice(0, -2)
    const current = fields[name]
    fields[name] = [...(Array.isArray(current) ? current : []), value]
  } else fields[key] = value
}
/** Supports the flag subset the runtime uses: --hostname, --method, -f, -F, --input -,
 * --paginate and --slurp. Anything else is rejected rather than silently dropped. */
export function parseGithubApiArgs(args: readonly string[], input?: string): GithubApiRequest {
  if (args[0] !== 'api') throw new Error('Not a gh api command')
  const request: GithubApiRequest = {
    host: 'github.com',
    method: 'GET',
    graphql: false,
    path: '',
    query: [],
    fields: {},
    paginate: false,
    slurp: false,
  }
  let explicitMethod = false
  for (let index = 1; index < args.length; index++) {
    const arg = args[index]!
    const next = () => {
      const value = args[++index]
      if (value === undefined) throw new Error(`gh api ${arg} needs a value`)
      return value
    }
    if (arg === '--hostname') request.host = next()
    else if (arg === '--method' || arg === '-X') {
      request.method = next().toUpperCase()
      explicitMethod = true
    } else if (arg === '-f' || arg === '--raw-field' || arg === '-F' || arg === '--field') {
      const pair = next()
      const separator = pair.indexOf('=')
      if (separator <= 0) throw new Error(`gh api field needs key=value: ${pair}`)
      const key = pair.slice(0, separator)
      const value = pair.slice(separator + 1)
      assign(request.fields, key, arg === '-F' || arg === '--field' ? typed(value) : value)
    } else if (arg === '--input') {
      if (next() !== '-') throw new Error('gh api --input only supports stdin')
      request.body = input ?? ''
    } else if (arg === '--paginate') request.paginate = true
    else if (arg === '--slurp') request.slurp = true
    else if (arg.startsWith('-')) throw new Error(`Unsupported gh api flag: ${arg}`)
    else if (request.path) throw new Error(`Unexpected gh api argument: ${arg}`)
    else request.path = arg
  }
  if (!request.path) throw new Error('gh api needs an endpoint')
  request.graphql = request.path === 'graphql'
  if (request.graphql) request.method = 'POST'
  else if (!explicitMethod && (Object.keys(request.fields).length || request.body !== undefined))
    request.method = 'POST'
  if (request.method === 'GET' && !request.graphql) {
    for (const [key, value] of Object.entries(request.fields))
      for (const item of Array.isArray(value) ? value : [value])
        request.query.push([key, String(item)])
    request.fields = {}
  }
  return request
}
/** github.com, GitHub Enterprise Cloud tenants and GitHub Enterprise Server API roots. */
export function githubApiUrl(host: string, path: string) {
  const base =
    host === 'github.com'
      ? 'https://api.github.com/'
      : host.endsWith('.ghe.com')
        ? `https://api.${host}/`
        : `https://${host}/api/v3/`
  if (path === 'graphql' && host !== 'github.com' && !host.endsWith('.ghe.com'))
    return new URL(`https://${host}/api/graphql`)
  const url = new URL(path.replace(/^\//, ''), base)
  if (url.origin !== new URL(base).origin) throw new Error('GitHub API path leaves its host')
  return url
}
const nextLink = (header: string | null) =>
  header
    ?.split(',')
    .map((part) => part.trim())
    .find((part) => /rel="next"/.test(part))
    ?.match(/^<([^>]+)>/)?.[1]
const ETAG_ENTRIES = 500
/** Sends GitHub API requests with one bearer token. Conditional GET requests reuse cached
 * bodies on 304, which GitHub does not count against the quota. */
export class GithubTransport {
  private etags = new Map<string, { etag: string; body: string }>()
  constructor(private fetcher: typeof fetch = fetch) {}
  async send(
    request: GithubApiRequest,
    token: string,
    options: { onUnauthorized?: () => void } = {},
  ): Promise<string> {
    const pages: string[] = []
    let url: URL | undefined = githubApiUrl(request.host, request.path)
    for (const [key, value] of request.query) url.searchParams.append(key, value)
    const body =
      request.body ??
      (request.graphql
        ? JSON.stringify({
            query: request.fields.query,
            variables: Object.fromEntries(
              Object.entries(request.fields).filter(([key]) => key !== 'query'),
            ),
          })
        : request.method !== 'GET' && Object.keys(request.fields).length
          ? JSON.stringify(request.fields)
          : undefined)
    const credential = createHash('sha256').update(token).digest('hex').slice(0, 16)
    for (let page = 0; url && page < 100; page++) {
      const cacheKey = `${credential} ${url.href}`
      const cached = request.method === 'GET' ? this.etags.get(cacheKey) : undefined
      let response: Response
      try {
        response = await this.fetcher(url, {
          method: request.method,
          redirect: 'manual',
          signal: AbortSignal.timeout(30000),
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'dovo-studio',
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...(cached ? { 'If-None-Match': cached.etag } : {}),
          },
          ...(body === undefined ? {} : { body }),
        })
      } catch (error) {
        throw new GithubApiError(
          502,
          `Could not reach ${request.host}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
      const text = await response.text()
      if (response.status === 304 && cached) pages.push(cached.body)
      else if (response.ok) {
        const etag = response.headers.get('etag')
        if (etag && request.method === 'GET') {
          this.etags.delete(cacheKey)
          this.etags.set(cacheKey, { etag, body: text })
          if (this.etags.size > ETAG_ENTRIES) {
            const oldest = this.etags.keys().next().value
            if (oldest !== undefined) this.etags.delete(oldest)
          }
        }
        pages.push(text)
      } else {
        if (response.status === 401) options.onUnauthorized?.()
        throw githubError(response, text)
      }
      const link = request.paginate ? nextLink(response.headers.get('link')) : undefined
      url = link ? new URL(link) : undefined
      if (url && url.host !== githubApiUrl(request.host, request.path).host)
        throw new GithubApiError(502, 'GitHub pagination left its API host')
    }
    if (!request.paginate) return pages[0] ?? ''
    if (request.slurp) return `[${pages.join(',')}]`
    // Without --slurp, gh concatenates array pages; the runtime only uses --slurp.
    return pages.join('\n')
  }
}
function githubError(response: Response, text: string) {
  let detail = ''
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed && typeof parsed === 'object' && 'message' in parsed)
      detail = String((parsed as { message: unknown }).message)
  } catch {
    detail = text.slice(0, 200)
  }
  const remaining = response.headers.get('x-ratelimit-remaining')
  const retryAfter = response.headers.get('retry-after')
  const reset = response.headers.get('x-ratelimit-reset')
  const limited =
    response.status === 429 ||
    (response.status === 403 && (remaining === '0' || /rate limit/i.test(detail)))
  if (limited) {
    const seconds = retryAfter
      ? Number(retryAfter)
      : reset
        ? Math.max(1, Number(reset) - Math.floor(Date.now() / 1000))
        : undefined
    const secondary = /secondary|abuse/i.test(detail)
    return new GithubApiError(
      response.status,
      `GitHub ${secondary ? 'secondary rate limit' : 'rate limit'} (HTTP ${response.status}): ${detail}${seconds ? ` retry-after: ${seconds}` : ''}`,
      seconds,
    )
  }
  return new GithubApiError(
    response.status,
    `GitHub API HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
  )
}

const TOKEN_TTL = 300_000
/** One token per host and checkout. Environment tokens win, like gh's own precedence; otherwise
 * `gh auth token` mints the active (or per-directory configured) account's token. Rejected
 * tokens are dropped so a new login applies on the next request. */
export class GithubCredentials {
  private tokens = new Map<string, { value: Promise<string>; expires: number }>()
  constructor(
    private executable: () => string,
    private runner: (
      command: string,
      args: string[],
      options: { cwd: string; env: NodeJS.ProcessEnv; timeout: number; maxBuffer: number },
    ) => Promise<{ stdout: string }> = (command, args, options) => exec(command, args, options),
  ) {}
  static environmentToken(host: string, env: NodeJS.ProcessEnv) {
    const enterprise = env.GH_ENTERPRISE_TOKEN || env.GITHUB_ENTERPRISE_TOKEN
    const token = env.GH_TOKEN || env.GITHUB_TOKEN
    if (host === 'github.com') return token || undefined
    return enterprise || (env.GH_HOST === host ? token : undefined) || undefined
  }
  private key(host: string, cwd: string, env: NodeJS.ProcessEnv) {
    return JSON.stringify([host, cwd, env.GH_CONFIG_DIR ?? '', env.GH_HOST ?? ''])
  }
  token(host: string, cwd: string, env: NodeJS.ProcessEnv): Promise<string> {
    const fromEnvironment = GithubCredentials.environmentToken(host, env)
    if (fromEnvironment) return Promise.resolve(fromEnvironment)
    const key = this.key(host, cwd, env)
    const now = Date.now()
    const cached = this.tokens.get(key)
    if (cached && cached.expires > now) return cached.value
    const value = this.runner(this.executable(), ['auth', 'token', '--hostname', host], {
      cwd,
      // Never let gh print the token into a debug log or wait for a prompt.
      env: { ...env, GH_DEBUG: '', GH_PROMPT_DISABLED: '1' },
      timeout: 20000,
      maxBuffer: 1024 * 1024,
    }).then(({ stdout }) => {
      const token = stdout.trim()
      if (!token || /\s/.test(token))
        throw new GithubApiError(
          401,
          `No GitHub login for ${host}. Run gh auth login --hostname ${host} on the runtime host.`,
        )
      return token
    })
    const entry = { value, expires: now + TOKEN_TTL }
    this.tokens.set(key, entry)
    value.catch(() => {
      if (this.tokens.get(key) === entry) this.tokens.delete(key)
    })
    if (this.tokens.size > 200)
      for (const [old, item] of this.tokens) if (item.expires <= now) this.tokens.delete(old)
    return value.catch((error: unknown) => {
      if (error instanceof ProcessError)
        throw new GithubApiError(
          401,
          `No GitHub login for ${host}. Run gh auth login --hostname ${host} on the runtime host. ${String(error.stderr).trim()}`.trim(),
        )
      throw error
    })
  }
  invalidate(host: string, cwd: string, env: NodeJS.ProcessEnv) {
    this.tokens.delete(this.key(host, cwd, env))
  }
}
