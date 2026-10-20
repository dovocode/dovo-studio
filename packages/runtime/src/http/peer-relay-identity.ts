import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto'
import type Database from 'better-sqlite3'
import { decode, peerRelayAdmissionPayload, peerRelayIdentitySchema } from '@dovo/protocol'
import { Schema } from 'effect'

/** One operator-approved installation identity; its private key never leaves this runtime. */
export function peerRelayIdentity(db: Database.Database) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS peer_relay_identity (id INTEGER PRIMARY KEY CHECK(id=1), private_key TEXT NOT NULL)',
  )
  const load = db.transaction(() => {
    const saved = db.prepare('SELECT private_key FROM peer_relay_identity WHERE id=1').get()
    if (saved) return decode(Schema.Struct({ private_key: Schema.String }), saved).private_key
    const generated = generateKeyPairSync('ed25519')
      .privateKey.export({ format: 'der', type: 'pkcs8' })
      .toString('base64')
    db.prepare('INSERT INTO peer_relay_identity VALUES (1, ?)').run(generated)
    return generated
  })
  const privateKey = createPrivateKey({
    key: Buffer.from(load(), 'base64'),
    format: 'der',
    type: 'pkcs8',
  })
  if (privateKey.asymmetricKeyType !== 'ed25519')
    throw new Error('Invalid relay installation identity')
  const publicKey = decode(
    peerRelayIdentitySchema,
    createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).toString('base64url'),
  )
  return {
    publicKey,
    prove(
      challenge: string,
      room: string,
      hostKey: string,
      clientKey: string,
      relayAllowed: boolean,
      origin: string,
    ) {
      return {
        type: 'relay-proof' as const,
        signature: sign(
          null,
          Buffer.from(
            peerRelayAdmissionPayload(challenge, room, hostKey, clientKey, relayAllowed, origin),
          ),
          privateKey,
        ).toString('base64url'),
      }
    },
  }
}
