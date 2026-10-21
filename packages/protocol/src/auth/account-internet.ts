import nacl from 'tweetnacl'
import { Schema } from 'effect'
import { mutableStruct, decode } from '../shared/schema.js'

export const internetKeySchema = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
)
export const internetBoxSchema = mutableStruct({
  nonce: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-f0-9]{48}$/))),
  ciphertext: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-f0-9]{32,32768}$/))),
})
export const internetRegistrationSchema = mutableStruct({
  id: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(200)),
  ),
  name: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(200)),
  ),
  identity: Schema.String,
  publicKey: internetKeySchema,
  timestamp: Schema.Number,
  signature: Schema.String,
})
export type InternetRegistration = typeof internetRegistrationSchema.Type
export const internetSetupSchema = mutableStruct({
  id: Schema.String,
  registration: internetRegistrationSchema,
})
export const internetHostSchema = mutableStruct({
  id: Schema.String,
  identity: Schema.String,
  publicKey: internetKeySchema,
  session: Schema.String,
})
export const internetRegistrationPayload = (
  origin: string,
  sessionHash: string,
  registration: Omit<InternetRegistration, 'signature'>,
) =>
  JSON.stringify([
    'dovo-account-internet-v1',
    origin,
    sessionHash,
    registration.id,
    registration.name,
    registration.identity,
    registration.publicKey,
    registration.timestamp,
  ])
export const internetHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
export function internetBytes(hex: string) {
  if (!/^(?:[a-f0-9]{2})+$/.test(hex)) throw new Error('Invalid encrypted connection data')
  return Uint8Array.from(hex.match(/../g)!, (byte) => parseInt(byte, 16))
}
export function internetPublicKey(secret: Uint8Array) {
  return internetHex(nacl.box.keyPair.fromSecretKey(secret).publicKey)
}
/** The account directory authenticates public keys. Connect never receives the box key. */
export function sealInternet(
  value: unknown,
  recipient: string,
  secret: Uint8Array,
  nonce: Uint8Array,
) {
  return decode(internetBoxSchema, {
    nonce: internetHex(nonce),
    ciphertext: internetHex(
      nacl.box(
        new TextEncoder().encode(JSON.stringify(value)),
        nonce,
        internetBytes(recipient),
        secret,
      ),
    ),
  })
}
export function openInternet(
  box: typeof internetBoxSchema.Type,
  sender: string,
  secret: Uint8Array,
): unknown {
  const plaintext = nacl.box.open(
    internetBytes(box.ciphertext),
    internetBytes(box.nonce),
    internetBytes(sender),
    secret,
  )
  if (!plaintext) throw new Error('Encrypted connection could not be authenticated')
  return JSON.parse(new TextDecoder().decode(plaintext))
}
