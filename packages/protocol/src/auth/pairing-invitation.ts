import { decodeResult } from '../shared/schema.js'
import { normalizeRuntimeAddress } from '../runtime/connection/runtime-fleet.js'
import { connectionSchema } from '../runtime/connection/runtime.js'
import {
  peerConfigSchema,
  peerAddress,
  isPeerAddress,
  type PeerConfig,
} from '../runtime/connection/peer.js'
import { decode } from '../shared/schema.js'
export type PairingInvitation = {
  address: string
  code: string
  expiresAt: string
  peer?: PeerConfig
}
export function pairingAddress(address: string) {
  const parsed = decodeResult(connectionSchema, {
    address: normalizeRuntimeAddress(address),
    token: 'invitation-validation-only',
  })
  if (!parsed.success)
    throw new Error('Enter a full HTTP or HTTPS computer address without embedded credentials.')
  const url = new URL(parsed.data.address)
  if (
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    ['localhost', '[::1]', '0.0.0.0', '[::]'].includes(url.hostname) ||
    /^127\./.test(url.hostname) ||
    url.hostname.endsWith('.localhost') ||
    /^\[::ffff:7f[0-9a-f]{2}:/i.test(url.hostname)
  )
    throw new Error('Use the computer’s Wi-Fi or VPN address, including its port.')
  return url.origin
}
export function pairingInvitation(value: PairingInvitation, now = Date.now()): PairingInvitation {
  const address = pairingAddress(value.address)
  const peer = value.peer ? decode(peerConfigSchema, value.peer) : undefined
  if (isPeerAddress(address) && (!peer || peerAddress(peer) !== address))
    throw new Error('Invalid internet pairing invitation')
  if (peer && peerAddress(peer) !== address)
    throw new Error('Internet pairing address does not match its key')
  if (!/^\d{8}$/.test(value.code))
    throw new Error('Enter the eight-digit pairing code from your computer.')
  const expires = Date.parse(value.expiresAt)
  if (!Number.isFinite(expires) || expires <= now)
    throw new Error('This pairing code expired. Generate a new code on your computer.')
  return { ...value, address, ...(peer ? { peer } : {}) }
}
export function pairingInvitationUrl(value: PairingInvitation) {
  const checked = pairingInvitation(value)
  return `dovo://pair?${new URLSearchParams({ address: checked.address, code: checked.code, expiresAt: checked.expiresAt, ...(checked.peer ? { peer: JSON.stringify(checked.peer) } : {}) })}`
}
export function parsePairingInvitation(url: string, now = Date.now()) {
  const link = new URL(url)
  if (link.protocol !== 'dovo:' || link.hostname !== 'pair')
    throw new Error('This is not a Dovo pairing link.')
  return pairingInvitation(
    {
      address: link.searchParams.get('address') ?? '',
      code: link.searchParams.get('code') ?? '',
      expiresAt: link.searchParams.get('expiresAt') ?? '',
      ...(link.searchParams.has('peer')
        ? { peer: decode(peerConfigSchema, JSON.parse(link.searchParams.get('peer')!)) }
        : {}),
    },
    now,
  )
}
