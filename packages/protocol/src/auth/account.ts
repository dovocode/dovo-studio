import { internetKeySchema } from './account-internet.js'
import { Schema } from 'effect'
import { mutableArray, mutableStruct } from '../shared/schema.js'

export const ACCOUNT_DIRECTORY_URL = 'https://connect.dovo.studio'
export const accountUserSchema = mutableStruct({ id: Schema.String, name: Schema.String })
export const accountServerSchema = mutableStruct({
  id: Schema.String,
  name: Schema.String,
  address: Schema.String,
  internet: Schema.optional(
    mutableStruct({ publicKey: internetKeySchema, online: Schema.Boolean }),
  ),
})
export const accountDirectorySchema = mutableStruct({
  user: accountUserSchema,
  servers: mutableArray(accountServerSchema),
})
export const accountLoginSchema = mutableStruct({
  token: Schema.String,
  code: Schema.String,
  url: Schema.String,
  expiresAt: Schema.Number,
})
export type AccountDirectory = typeof accountDirectorySchema.Type
export type AccountServer = typeof accountServerSchema.Type
export type AccountLogin = typeof accountLoginSchema.Type
export interface AccountStorage {
  read(): Promise<string | null>
  write(token: string | null): Promise<void>
}

/** Directory addresses must be usable by another device; HTTP LAN/VPN routes stay valid. */
export function accountServerAddress(value: string) {
  const url = new URL(value)
  const host = url.hostname.replace(/\.$/, '')
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    ['localhost', '0.0.0.0', '[::]', '[::1]'].includes(host) ||
    host.endsWith('.localhost') ||
    host.startsWith('127.') ||
    host.startsWith('[::ffff:7f')
  )
    throw new Error(
      'Choose a LAN or VPN address that another device can reach, without credentials.',
    )
  return url.origin
}
export function accountServerAddresses(
  connection: { address: string; alternateAddresses?: string[] },
  snapshot?: { runtimeAddresses?: string[] } | null,
) {
  return [
    ...new Set(
      [
        connection.address,
        ...(snapshot?.runtimeAddresses ?? []),
        ...(connection.alternateAddresses ?? []),
      ].flatMap((address) => {
        try {
          return [accountServerAddress(address)]
        } catch {
          return []
        }
      }),
    ),
  ]
}
