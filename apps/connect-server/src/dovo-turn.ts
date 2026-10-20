import { createHash, createHmac, randomBytes } from 'node:crypto'
import { decode, peerRelaySchema } from '@dovo/protocol'
import { managedRelayCredentials, TURN_CREDENTIAL_TTL } from './relay-credentials.js'

/** coturn's TURN REST API authentication: expiring username + HMAC-SHA1 password.
 * The long-lived secret is shared only by Connect and the separately deployed TURN server. */
export function dovoTurn(options: {
  urls: string[]
  secret: string
  hourlyLimit?: number
  now?: () => number
}) {
  if (
    options.secret.length < 32 ||
    /[\r\n\0]/.test(options.secret) ||
    !options.urls.length ||
    options.urls.some((url) => !/^turns?:[A-Za-z0-9.-]+:\d{1,5}\?transport=(?:udp|tcp)$/.test(url))
  )
    throw new Error('Configure Dovo TURN URLs and a shared secret of at least 32 characters')
  const now = options.now ?? Date.now
  return managedRelayCredentials(async (installation) => {
    const expires = Math.floor(now() / 1000) + TURN_CREDENTIAL_TTL
    const attribution = installation
      ? `${createHash('sha256').update(installation).digest('hex').slice(0, 16)}-`
      : ''
    const username = `${expires}:dovo-${attribution}${randomBytes(16).toString('hex')}`
    const credential = createHmac('sha1', options.secret).update(username).digest('base64')
    return decode(peerRelaySchema, {
      provider: 'dovo',
      expiresAt: expires * 1000,
      iceServers: [{ urls: options.urls, username, credential }],
    })
  }, options)
}
