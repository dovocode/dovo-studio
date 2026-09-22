import type { ForgeConnection } from '@dovo/protocol'
import { HttpError } from '../errors.js'
import { withinForgeServer } from './forge-url.js'

export type ForgeHttpOptions = { method?: string; body?: unknown; contentType?: string }
const LIMIT = 16 * 1024 * 1024
export class ForgeHttp {
  constructor(
    public readonly connection: ForgeConnection,
    private authorization: () => string | Promise<string>,
    private fetcher: typeof fetch = fetch,
  ) {}
  private url(path: string) {
    const base = new URL(`${this.connection.baseUrl.replace(/\/$/, '')}/`)
    const url = /^https?:\/\//.test(path) ? new URL(path) : new URL(path.replace(/^\//, ''), base)
    if (!withinForgeServer(url, base) || url.hash)
      throw new HttpError(400, 'The source control server returned an unsafe API URL')
    return url
  }
  private async request(path: string, options: ForgeHttpOptions = {}) {
    let url = this.url(path)
    const authorization = await this.authorization()
    const method = options.method ?? 'GET'
    for (let redirect = 0; redirect < 4; redirect++) {
      let response: Response
      try {
        response = await this.fetcher(url, {
          method,
          redirect: 'manual',
          signal: AbortSignal.timeout(30000),
          headers: {
            Authorization: authorization,
            Accept: 'application/json',
            ...(options.body === undefined
              ? {}
              : { 'Content-Type': options.contentType ?? 'application/json' }),
          },
          ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        })
      } catch (error) {
        if (error instanceof HttpError) throw error
        throw new HttpError(
          502,
          method === 'GET'
            ? 'Could not reach the source control server. Check its address and the runtime network connection.'
            : 'The server response was lost. Refresh before submitting again; the action may already have completed.',
        )
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel()
        if (method !== 'GET' || !response.headers.get('location'))
          throw new HttpError(
            502,
            'The source control server redirected a write; verify the configured API address',
          )
        url = this.url(new URL(response.headers.get('location')!, url).toString())
        continue
      }
      const reader = response.body?.getReader(),
        chunks: Uint8Array[] = []
      let size = 0
      if (reader) {
        try {
          for (;;) {
            const next = await reader.read()
            if (next.done) break
            size += next.value.byteLength
            if (size > LIMIT) {
              await reader.cancel()
              throw new HttpError(
                502,
                'The source control response exceeds 16 MB. Open this item on its server.',
              )
            }
            chunks.push(next.value)
          }
        } catch (error) {
          if (error instanceof HttpError) throw error
          throw new HttpError(
            502,
            method === 'GET'
              ? 'The source control response was interrupted. Try refreshing.'
              : 'The server response was interrupted. Refresh before retrying; this action may already have completed.',
          )
        } finally {
          reader.releaseLock()
        }
      }
      const text = Buffer.concat(chunks).toString('utf8')
      if (!response.ok) {
        // Do not echo upstream bodies: they may contain credentials or private response payloads.
        const reason =
          response.status === 401
            ? 'Authentication failed. Update the token on this runtime.'
            : response.status === 403
              ? 'This account does not have permission for this operation. Check token scopes and repository access.'
              : response.status === 404
                ? 'Repository, item or operation not found. Check the connection, repository name and server version.'
                : response.status === 409 || response.status === 412
                  ? 'The item changed or the operation conflicts with its current state. Refresh before continuing.'
                  : response.status === 422 || response.status === 400
                    ? 'The server rejected this action. Check the submitted fields, identities and project policies.'
                    : response.status === 429
                      ? 'The source control server rate limit was reached. Try again after it resets.'
                      : 'The source control server could not complete the request.'
        throw new HttpError(
          response.status >= 500 ? 502 : response.status,
          `${reason} (HTTP ${response.status})`,
        )
      }
      return { text, status: response.status, headers: response.headers }
    }
    throw new HttpError(502, 'Too many source control redirects')
  }
  async text(path: string, options?: ForgeHttpOptions) {
    return (await this.request(path, options)).text
  }
  async jsonResponse(path: string, options?: ForgeHttpOptions) {
    const response = await this.request(path, options)
    let data: unknown
    try {
      data = response.text ? JSON.parse(response.text) : null
    } catch {
      throw new HttpError(502, 'The source control server returned invalid JSON')
    }
    return { data, status: response.status, headers: response.headers }
  }
  async json(path: string, options?: ForgeHttpOptions): Promise<unknown> {
    return (await this.jsonResponse(path, options)).data
  }
}
