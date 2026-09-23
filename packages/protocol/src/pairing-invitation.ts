import { decodeResult } from './schema.js'
import { connectionSchema } from './runtime.js'
export type PairingInvitation = { address: string; code: string; expiresAt: string }
export function pairingInvitation(value: PairingInvitation, now = Date.now()): PairingInvitation {
  const parsed = decodeResult(connectionSchema, {
    address: value.address,
    token: 'invitation-validation-only',
  })
  if (!parsed.success)
    throw new Error('Enter a full HTTP or HTTPS computer address without embedded credentials.')
  const url = new URL(parsed.data.address)
  if (
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    ['localhost', '127.0.0.1', '[::1]', '0.0.0.0', '[::]'].includes(url.hostname)
  )
    throw new Error('Use the computer’s Wi-Fi or VPN address, including its port.')
  if (!/^\d{8}$/.test(value.code))
    throw new Error('Enter the eight-digit pairing code from your computer.')
  const expires = Date.parse(value.expiresAt)
  if (!Number.isFinite(expires) || expires <= now)
    throw new Error('This pairing code expired. Generate a new code on your computer.')
  return { ...value, address: url.origin }
}
export function pairingInvitationUrl(value: PairingInvitation) {
  const checked = pairingInvitation(value)
  return `dovo://pair?${new URLSearchParams(checked)}`
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
    },
    now,
  )
}
