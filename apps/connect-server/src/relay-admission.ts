import { createPublicKey, verify, type KeyObject } from 'node:crypto'
import { decode, peerRelayIdentitySchema } from '@dovo/protocol'

export type PeerRelayAdmission = (publicKey: string, payload: string, signature: string) => boolean

/** Only explicitly approved public keys may obtain TURN credentials. No accounts or client secrets. */
export function approvedRelayInstallations(keys: readonly string[]): PeerRelayAdmission {
  const approved = new Map<string, KeyObject>()
  for (const value of keys) {
    const encoded = decode(peerRelayIdentitySchema, value)
    const bytes = Buffer.from(encoded, 'base64url')
    if (bytes.toString('base64url') !== encoded)
      throw new Error('Invalid relay approval key encoding')
    const key = createPublicKey({ key: bytes, type: 'spki', format: 'der' })
    if (key.asymmetricKeyType !== 'ed25519')
      throw new Error('Relay approvals require Ed25519 public keys')
    approved.set(encoded, key)
  }
  return (publicKey, payload, signature) => {
    const key = approved.get(publicKey)
    if (!key) return false
    const bytes = Buffer.from(signature, 'base64url')
    return (
      bytes.length === 64 &&
      bytes.toString('base64url') === signature &&
      verify(null, Buffer.from(payload), key, bytes)
    )
  }
}
