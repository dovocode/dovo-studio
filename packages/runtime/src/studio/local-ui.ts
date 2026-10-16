import { isIP } from 'node:net'
import { HttpError } from '../errors.js'

/** Do not trust forwarded headers: UI control stays on the runtime's own machine. */
export function requireLocalStudioUI(remoteAddress: string | undefined) {
  const address = remoteAddress?.toLowerCase()
  const ipv4 = address?.replace(/^::ffff:/, '')
  if (address === '::1' || (ipv4 && isIP(ipv4) === 4 && ipv4.startsWith('127.'))) return
  throw new HttpError(
    403,
    'Studio UI debugging is available only on this machine through a loopback runtime connection',
  )
}
