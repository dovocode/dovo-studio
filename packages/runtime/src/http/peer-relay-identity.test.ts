import { expect, it } from 'vite-plus/test'
import { createPublicKey, verify } from 'node:crypto'
import Database from 'better-sqlite3'
import { peerRelayIdentity } from './peer-relay-identity.js'
import { approvedRelayInstallations } from '../../../../apps/connect-server/src/relay-admission.js'
import { peerRelayAdmissionPayload } from '@dovo/protocol'

it('keeps an installation identity across restarts and proves possession without exposing its private key', () => {
  const db = new Database(':memory:')
  try {
    const first = peerRelayIdentity(db)
    const restored = peerRelayIdentity(db)
    expect(first.publicKey).toBe(restored.publicKey)
    const challenge = '1'.repeat(64),
      room = '2'.repeat(64),
      host = '3'.repeat(64),
      client = '4'.repeat(64)
    const proof = restored.prove(challenge, room, host, client, true, 'https://connect.dovo.studio')
    expect(proof).toEqual(
      first.prove(challenge, room, host, client, true, 'https://connect.dovo.studio'),
    )
    expect(
      approvedRelayInstallations([first.publicKey])(
        first.publicKey,
        peerRelayAdmissionPayload(
          challenge,
          room,
          host,
          client,
          true,
          'https://connect.dovo.studio',
        ),
        proof.signature,
      ),
    ).toBe(true)
    expect(
      approvedRelayInstallations([first.publicKey])(
        first.publicKey,
        peerRelayAdmissionPayload(
          challenge,
          room,
          host,
          client,
          true,
          'https://another-broker.example',
        ),
        proof.signature,
      ),
    ).toBe(false)
    expect(Object.keys(proof).sort()).toEqual(['signature', 'type'])
    const registration = 'account-bound registration'
    const signature = restored.signRegistration(registration)
    const publicKey = createPublicKey({
      key: Buffer.from(first.publicKey, 'base64url'),
      format: 'der',
      type: 'spki',
    })
    expect(
      verify(null, Buffer.from(registration), publicKey, Buffer.from(signature, 'base64url')),
    ).toBe(true)
    expect(
      verify(
        null,
        Buffer.from('another registration'),
        publicKey,
        Buffer.from(signature, 'base64url'),
      ),
    ).toBe(false)
    expect(Object.keys(first).sort()).toEqual(['prove', 'publicKey', 'signRegistration'])
  } finally {
    db.close()
  }
})
