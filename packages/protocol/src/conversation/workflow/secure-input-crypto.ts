import nacl from 'tweetnacl'
import { internetBytes, internetHex } from '../../auth/account-internet.js'
import type { PendingSecureInput, SecureInputReply } from './secure-input.js'

// Derive only the public key, without allocating a second private key copy.
export const secureInputPublicKey = (secret: Uint8Array) =>
  internetHex(nacl.scalarMult.base(secret))

/** Encrypt before calling any transport, outbox, diagnostics or request middleware. */
export function sealSecureInput(request: PendingSecureInput, value: string): SecureInputReply {
  if (!value.length || value.length > 8192)
    throw new Error('Enter a value of at most 8192 UTF-8 bytes.')
  const valueBytes = new TextEncoder().encode(value)
  const tooLarge = valueBytes.length > 8192
  valueBytes.fill(0)
  if (tooLarge) throw new Error('Enter a value of at most 8192 UTF-8 bytes.')
  const secret = nacl.randomBytes(32)
  const plaintext = new TextEncoder().encode(
    JSON.stringify({ id: request.id, taskId: request.taskId, value }),
  )
  try {
    const nonce = nacl.randomBytes(24)
    return {
      id: request.id,
      sender: secureInputPublicKey(secret),
      box: {
        nonce: internetHex(nonce),
        ciphertext: internetHex(
          nacl.box(plaintext, nonce, internetBytes(request.publicKey), secret),
        ),
      },
    }
  } finally {
    secret.fill(0)
    plaintext.fill(0)
  }
}
export function openSecureInput(input: SecureInputReply, secret: Uint8Array): unknown {
  const plaintext = nacl.box.open(
    internetBytes(input.box.ciphertext),
    internetBytes(input.box.nonce),
    internetBytes(input.sender),
    secret,
  )
  if (!plaintext) throw new Error('Invalid secure input')
  try {
    return JSON.parse(new TextDecoder().decode(plaintext))
  } finally {
    plaintext.fill(0)
  }
}
