import { Schema } from 'effect'

/** Web origin scopes only. Chrome ignores paths when comparing host permissions. */
const webScope = (pattern: string) => {
  if (pattern === '<all_urls>') return { schemes: ['http', 'https'], host: '*' }
  const match = /^(\*|https?):\/\/(\*|(?:\*\.)?[^/*:\s]+)(?::\d{1,5})?\/.*$/.exec(pattern)
  if (!match) return undefined
  return {
    schemes: match[1] === '*' ? ['http', 'https'] : [match[1]],
    host: match[2]!.toLowerCase(),
  }
}
/** A narrow request is covered by an existing grant, never the other way around. */
export function webOriginCovered(granted: string, requested: string) {
  const grant = webScope(granted),
    request = webScope(requested)
  if (!grant || !request) return false
  if (!request.schemes.every((scheme) => grant.schemes.includes(scheme))) return false
  if (grant.host === '*') return true
  if (grant.host === request.host) return true
  if (!grant.host.startsWith('*.')) return false
  const suffix = grant.host.slice(2)
  const host = request.host.replace(/^\*\./, '')
  return host === suffix || host.endsWith('.' + suffix)
}

type Permissions = { permissions?: string[]; origins?: string[] }
type Event = { extension: { id: string } }
type Handler = (event: Event, request: unknown) => boolean
type Register = (name: string, handler: Handler) => void
const internals = Schema.Struct({
  ctx: Schema.Struct({
    router: Schema.Struct({
      apiHandler: Schema.declare(
        (value: unknown): value is () => Register => typeof value === 'function',
      ),
    }),
  }),
  api: Schema.Struct({
    permissions: Schema.Struct({
      getAll: Schema.declare(
        (value: unknown): value is (event: Event) => Permissions | undefined =>
          typeof value === 'function',
      ),
    }),
  }),
})
const requestSchema = Schema.Struct({
  permissions: Schema.optional(Schema.Array(Schema.String)),
  origins: Schema.optional(Schema.Array(Schema.String)),
})

/** Version-checked alongside the action/native-messaging adapters for library 4.10.0. */
export function attachExtensionPermissionChecks(library: unknown) {
  if (!Schema.is(internals)(library))
    throw new Error('Extension permission checks are unavailable in this build.')
  const permissions = library.api.permissions
  library.ctx.router.apiHandler()('permissions.contains', (event, raw) => {
    if (!Schema.is(requestSchema)(raw)) return false
    const granted = permissions.getAll(event)
    if (!granted) return false
    return (
      (raw.permissions ?? []).every((permission) => granted.permissions?.includes(permission)) &&
      (raw.origins ?? []).every((origin) =>
        granted.origins?.some((scope) => webOriginCovered(scope, origin)),
      )
    )
  })
}
