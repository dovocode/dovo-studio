import { Schema } from 'effect'
import { decode } from '../../shared/schema.js'
import { deviceHostSchema } from '../previews/device-hosts.js'

/** Share connection coordinates only; credentials and key paths belong to the source host. */
export function parseSshAddress(value: string) {
  if (/\s/.test(value)) throw new Error('SSH addresses cannot contain whitespace')
  const url = new URL(value)
  if (
    url.protocol !== 'ssh:' ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname && url.pathname !== '/')
  )
    throw new Error('Use ssh://user@host:port without passwords, paths or query parameters')
  return {
    sshHost: decode(deviceHostSchema.fields.sshHost, url.hostname.replace(/^\[|\]$/g, '')),
    sshUser: decode(deviceHostSchema.fields.sshUser, url.username),
    sshPort: decode(deviceHostSchema.fields.sshPort, Number(url.port || 22)),
  }
}
export const sshAddressSchema = Schema.String.pipe(
  Schema.check(Schema.isMaxLength(512)),
  Schema.check(
    Schema.makeFilter(
      (value) => {
        if (!value) return true
        try {
          parseSshAddress(value)
          return true
        } catch {
          return false
        }
      },
      { message: 'Use ssh://user@host:port without passwords, paths or query parameters' },
    ),
  ),
)
