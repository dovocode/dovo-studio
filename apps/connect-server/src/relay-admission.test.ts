import { expect, it } from 'vite-plus/test'
import { generateKeyPairSync, sign } from 'node:crypto'
import { approvedRelayInstallations } from './relay-admission.js'
import { ValidationError } from '@dovo/protocol'

it('requires the approved Ed25519 private key and a signature for this exact challenge', () => {
  const identity = generateKeyPairSync('ed25519')
  const publicKey = identity.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url')
  const payload = 'unique-challenge-and-room-capabilities'
  const signature = sign(null, Buffer.from(payload), identity.privateKey).toString('base64url')
  const verify = approvedRelayInstallations([publicKey])
  expect(verify(publicKey, payload, signature)).toBe(true)
  expect(verify(publicKey, payload + '-tampered', signature)).toBe(false)
  expect(verify(publicKey, payload, 'a'.repeat(86))).toBe(false)
  expect(approvedRelayInstallations([])(publicKey, payload, signature)).toBe(false)
  expect(() => approvedRelayInstallations(['invalid'])).toThrow(ValidationError)
  const other = generateKeyPairSync('ed25519')
  expect(
    verify(
      publicKey,
      payload,
      sign(null, Buffer.from(payload), other.privateKey).toString('base64url'),
    ),
  ).toBe(false)
})
