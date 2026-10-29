import { createHash } from 'node:crypto'
import { exec, ProcessError } from '../../process.js'
import {
  githubResponseInfo,
  githubGraphqlInfo,
  type GithubResponseInfo,
  type GithubRateLimit,
} from './github-rate-limit.js'

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
    readonly rateLimit?: GithubRateLimit,
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
const RESPONSE_BYTES = 16 * 1024 * 1024
const CACHE_BYTES = 32 * 1024 * 1024

async function responseText(response: Response, limit: number) {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > limit) throw new GithubApiError(502, 'GitHub response exceeded its byte limit')
      chunks.push(next.value)
    }
    return Buffer.concat(chunks).toString('utf8')
  } catch (error) {
    if (error instanceof GithubApiError) throw error
    throw new GithubApiError(
      502,
      'GitHub response was interrupted. Refresh before retrying a write; it may have completed.',
    )
  } finally {
    await reader.cancel().catch(() => {}) // A broken stream may also reject cancellation.
    reader.releaseLock()
  }
}
/** Sends GitHub API requests with one bearer token. Conditional GET requests reuse cached
 * bodies on 304, which GitHub does not count against the quota. */
export class GithubTransport {
  private etags = new Map<
    string,
    { etag: string; body: string; link: string | null; bytes: number }
  >()
  private cachedBytes = 0
  constructor(private fetcher: typeof fetch = fetch) {}
  async send(
    request: GithubApiRequest,
    token: string,
    options: {
      onUnauthorized?: () => void
      maxBytes?: number
      onResponse?: (info: GithubResponseInfo) => void
    } = {},
  ): Promise<string> {
    const pages: string[] = []
    let total = 0
    const limit = options.maxBytes ?? RESPONSE_BYTES
    const apiUrl = githubApiUrl(request.host, request.path)
    let url: URL | undefined = apiUrl
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
      const cacheKey: string = `${credential} ${url.href}`
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
      const info = githubResponseInfo(response, request.graphql)
      if (response.status === 401) options.onUnauthorized?.()
      let text: string
      try {
        text = await responseText(response, Math.min(RESPONSE_BYTES, limit - total))
      } catch (error) {
        options.onResponse?.(info)
        // Authentication/permission rejection remains authoritative even when its
        // body is interrupted. A 502 here would incorrectly permit private cache fallback.
        if (!response.ok) throw githubError(response, '')
        throw error
      }
      const graphql = request.graphql ? githubGraphqlInfo(text) : undefined
      if (graphql?.quota) info.quota = graphql.quota
      if (graphql?.cost !== undefined) info.cost = graphql.cost
      options.onResponse?.(info)
      if (response.ok && graphql?.limited)
        throw new GithubApiError(429, 'GitHub GraphQL rate limit reached', undefined, {
          resource: 'graphql',
          secondary: graphql.secondary,
          resetAt: graphql.secondary ? undefined : info.quota?.resetAt,
        })
      const linkHeader: string | null =
        response.status === 304 && cached
          ? (response.headers.get('link') ?? cached.link)
          : response.headers.get('link')
      const bytes = Buffer.byteLength(response.status === 304 && cached ? cached.body : text)
      total += bytes
      if (total > limit)
        throw new GithubApiError(502, 'GitHub paginated response exceeded its byte limit')
      if (response.status === 304 && cached) {
        cached.link = linkHeader
        cached.etag = response.headers.get('etag') ?? cached.etag
        this.etags.delete(cacheKey)
        this.etags.set(cacheKey, cached)
        pages.push(cached.body)
      } else if (response.ok) {
        const etag = response.headers.get('etag')
        if (request.method === 'GET' && cached) {
          this.etags.delete(cacheKey)
          this.cachedBytes -= cached.bytes
        }
        if (etag && request.method === 'GET') {
          this.etags.set(cacheKey, { etag, body: text, link: linkHeader, bytes })
          this.cachedBytes += bytes
          while (this.etags.size > ETAG_ENTRIES || this.cachedBytes > CACHE_BYTES) {
            const oldest = this.etags.keys().next().value
            if (oldest === undefined) break
            this.cachedBytes -= this.etags.get(oldest)!.bytes
            this.etags.delete(oldest)
          }
        }
        pages.push(text)
      } else {
        throw githubError(response, text)
      }
      const link = request.paginate ? nextLink(linkHeader) : undefined
      url = link ? new URL(link) : undefined
      if (url && (url.origin !== apiUrl.origin || url.username || url.password))
        throw new GithubApiError(502, 'GitHub pagination returned an unsafe API URL')
    }
    if (url)
      throw new GithubApiError(
        502,
        'GitHub pagination exceeded 100 pages; the result is incomplete',
      )
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
    (response.status === 403 &&
      (remaining === '0' || /rate limit|abuse detection|too many requests/i.test(detail)))
  if (limited) {
    const retry = retryAfter === null ? undefined : Number(retryAfter)
    const seconds = retry !== undefined && Number.isFinite(retry) ? Math.max(0, retry) : undefined
    const secondary =
      /secondary|abuse/i.test(detail) || (response.status === 429 && remaining !== '0')
    const resetAt =
      reset !== null && Number.isFinite(Number(reset)) ? Number(reset) * 1000 : undefined
    const effective =
      seconds ??
      (!secondary && resetAt !== undefined ? Math.max(0, (resetAt - Date.now()) / 1000) : undefined)
    return new GithubApiError(
      response.status,
      `GitHub ${secondary ? 'secondary rate limit' : 'rate limit'} (HTTP ${response.status})${effective !== undefined ? ` retry-after: ${effective}` : ''}`,
      effective,
      {
        resource: response.headers.get('x-ratelimit-resource') ?? undefined,
        secondary,
        resetAt: secondary ? undefined : resetAt,
        retryAfter: seconds,
      },
    )
  }
  return new GithubApiError(response.status, `GitHub API HTTP ${response.status}`)
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
  private key(host: string, cwd: string, env: NodeJS.ProcessEnv, executable = this.executable()) {
    // Config paths and custom wrappers can change the selected login without a
    // checkout change. Hash the effective context; never put its secrets in keys.
    return createHash('sha256')
      .update(
        JSON.stringify([
          executable,
          host,
          cwd,
          Object.entries(env).sort(([a], [b]) => a.localeCompare(b)),
        ]),
      )
      .digest('hex')
  }
  token(host: string, cwd: string, env: NodeJS.ProcessEnv): Promise<string> {
    return this.resolve(host, cwd, env).value
  }
  /** Bind rejection to the exact source and cache generation used by this request. */
  async capture(host: string, cwd: string, env: NodeJS.ProcessEnv) {
    const source = this.resolve(host, cwd, env)
    return { token: await source.value, onUnauthorized: source.onUnauthorized }
  }
  private resolve(host: string, cwd: string, env: NodeJS.ProcessEnv) {
    const fromEnvironment = GithubCredentials.environmentToken(host, env)
    if (fromEnvironment)
      return { value: Promise.resolve(fromEnvironment), onUnauthorized: () => {} }
    const executable = this.executable()
    const key = this.key(host, cwd, env, executable)
    const now = Date.now()
    const cached = this.tokens.get(key)
    if (cached && cached.expires > now) {
      this.tokens.delete(key)
      this.tokens.set(key, cached)
      return {
        value: cached.value,
        onUnauthorized: () => {
          if (this.tokens.get(key) === cached) this.tokens.delete(key)
        },
      }
    }
    const value = this.runner(executable, ['auth', 'token', '--hostname', host], {
      cwd,
      // Never let gh print the token into a debug log or wait for a prompt.
      env: { ...env, GH_DEBUG: '', GH_PROMPT_DISABLED: '1' },
      timeout: 20000,
      maxBuffer: 1024 * 1024,
    })
      .then(({ stdout }) => {
        const token = stdout.trim()
        if (!token || /\s/.test(token))
          throw new GithubApiError(
            401,
            `No GitHub login for ${host}. Run gh auth login --hostname ${host} on the runtime host.`,
          )
        return token
      })
      .catch((error: unknown) => {
        if (error instanceof ProcessError)
          throw new GithubApiError(
            401,
            `No GitHub login for ${host}. Run gh auth login --hostname ${host} on the runtime host.`,
          )
        throw error
      })
    const entry = { value, expires: now + TOKEN_TTL }
    this.tokens.set(key, entry)
    value.catch(() => {
      if (this.tokens.get(key) === entry) this.tokens.delete(key)
    })
    // Environment-aware sources can change frequently. Keep a hard bound even
    // when every entry is unexpired; evicting a pending lookup does not cancel it.
    while (this.tokens.size > 200) this.tokens.delete(this.tokens.keys().next().value!)
    return {
      value,
      onUnauthorized: () => {
        if (this.tokens.get(key) === entry) this.tokens.delete(key)
      },
    }
  }
  invalidate(host: string, cwd: string, env: NodeJS.ProcessEnv) {
    this.tokens.delete(this.key(host, cwd, env))
  }
}
