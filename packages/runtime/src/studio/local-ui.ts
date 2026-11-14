import { isIP } from 'node:net'
import { HttpError } from '../errors.js'

/** Do not trust forwarded headers: UI control stays on the runtime's own machine. */
export function localStudioConnection(remoteAddress: string | undefined) {
  const address = remoteAddress?.toLowerCase()
  const ipv4 = address?.replace(/^::ffff:/, '')
  return address === '::1' || !!(ipv4 && isIP(ipv4) === 4 && ipv4.startsWith('127.'))
}
export function requireLocalStudioUI(remoteAddress: string | undefined) {
  if (localStudioConnection(remoteAddress)) return
  throw new HttpError(
    403,
    'Studio UI debugging is available only on this machine through a loopback runtime connection',
  )
}

/** A saved pairing alone never grants control of other computers. */
export function requireStudioPeerRegistration(remoteAddress: string | undefined, enabled: boolean) {
  if (localStudioConnection(remoteAddress)) return 'local' as const
  if (enabled) return 'remote' as const
  throw new HttpError(
    403,
    'Enable "Access paired computers" in this computer’s Studio Tools settings. UI control stays available only on this machine.',
  )
}
