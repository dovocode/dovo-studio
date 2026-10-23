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
/** Compose the split settings fields using the same validation as saved SSH URLs. */
export function formatSshAddress({
  sshHost,
  sshUser,
  sshPort,
}: {
  sshHost: string
  sshUser: string
  sshPort: string
}) {
  const host = sshHost.trim()
  const user = sshUser.trim()
  if (!host && !user) return ''
  if (!/^[0-9]+$/.test(sshPort.trim()))
    throw new Error('SSH port must be a number between 1 and 65535')
  const port = decode(deviceHostSchema.fields.sshPort, Number(sshPort.trim()))
  const address = `ssh://${user}@${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}:${port}`
  parseSshAddress(address)
  return address
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
