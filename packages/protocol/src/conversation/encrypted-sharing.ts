import nacl from 'tweetnacl'
import { v4 as uuid } from 'uuid'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import { Schema } from 'effect'
import {
  decode,
  maxValue,
  minValue,
  mutableArray,
  mutableStruct,
  uuidSchema,
} from '../shared/schema.js'
import { artifactPublicationInputSchema } from './artifact-sharing.js'

export const SHARE_MAX_BYTES = 28 * 1024 * 1024
const hex = (length: number) =>
  Schema.String.check(Schema.isPattern(new RegExp(`^[a-f0-9]{${length}}$`)))
export const sharingKeySchema = hex(64)
export const sharingBoxSchema = mutableStruct({
  nonce: hex(48),
  ciphertext: maxValue(
    minValue(Schema.String.check(Schema.isPattern(/^(?:[a-f0-9]{2})+$/)), 32),
    SHARE_MAX_BYTES,
  ),
})
export type SharingBox = typeof sharingBoxSchema.Type
export const sharedMessageSchema = mutableStruct({
  id: maxValue(Schema.String, 200),
  role: Schema.Literals(['user', 'assistant']),
  text: maxValue(Schema.String, 20 * 1024 * 1024),
  createdAt: Schema.optional(Schema.String),
})
export const sharedContentSchema = Schema.Union([
  mutableStruct({
    kind: Schema.Literal('artifact'),
    artifact: artifactPublicationInputSchema,
    feed: Schema.optional(
      mutableStruct({ data: Schema.Unknown, updatedAt: Schema.Number, seconds: Schema.Number }),
    ),
  }),
  mutableStruct({
    kind: Schema.Literal('thread'),
    title: maxValue(Schema.String, 1000),
    messages: maxValue(mutableArray(sharedMessageSchema), 100000),
  }),
])
export type SharedContent = typeof sharedContentSchema.Type
export const sharePacketSchema = mutableStruct({
  generation: uuidSchema,
  revision: uuidSchema,
  box: sharingBoxSchema,
  signature: hex(128),
})
export type SharePacket = typeof sharePacketSchema.Type
export const shareGrantSchema = mutableStruct({
  id: uuidSchema,
  userId: Schema.optional(maxValue(minValue(Schema.String, 1), 500)),
  tokenHash: Schema.optional(hex(64)),
  expiresAt: Schema.optional(Schema.Number),
  box: sharingBoxSchema,
})
export const shareRecordSchema = mutableStruct({
  id: uuidSchema,
  source: hex(64),
  kind: Schema.Literals(['artifact', 'thread']),
  version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  updatedAt: Schema.Number,
  signingKey: sharingKeySchema,
  packet: sharePacketSchema,
  ownerBox: sharingBoxSchema,
  grants: maxValue(mutableArray(shareGrantSchema), 110),
  writerHash: Schema.optional(hex(64)),
  paused: Schema.Boolean,
})
export type ShareRecord = typeof shareRecordSchema.Type
export const shareIndexSchema = mutableStruct({
  id: shareRecordSchema.fields.id,
  source: shareRecordSchema.fields.source,
  kind: shareRecordSchema.fields.kind,
  version: shareRecordSchema.fields.version,
  updatedAt: shareRecordSchema.fields.updatedAt,
  ownerBox: shareRecordSchema.fields.ownerBox,
})
export const shareWriteSchema = mutableStruct({
  expectedVersion: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  record: shareRecordSchema,
})
export const shareReaderSchema = mutableStruct({
  id: uuidSchema,
  kind: shareRecordSchema.fields.kind,
  version: shareRecordSchema.fields.version,
  updatedAt: Schema.Number,
  paused: Schema.Boolean,
  packet: sharePacketSchema,
  box: sharingBoxSchema,
})
export const sharingVaultSchema = mutableStruct({
  contentKey: sharingKeySchema,
  signingSeed: sharingKeySchema,
  suggestionSecret: sharingKeySchema,
  grants: mutableArray(
    mutableStruct({
      id: uuidSchema,
      key: sharingKeySchema,
      token: Schema.optional(sharingKeySchema),
    }),
  ),
})
export type SharingVault = typeof sharingVaultSchema.Type
export const sharingReaderKeysSchema = mutableStruct({
  contentKey: sharingKeySchema,
  signingKey: sharingKeySchema,
  suggestionKey: sharingKeySchema,
})
export const encryptedSuggestionSchema = mutableStruct({
  id: uuidSchema,
  revision: uuidSchema,
  publicKey: sharingKeySchema,
  box: sharingBoxSchema,
})
export type EncryptedSuggestion = typeof encryptedSuggestionSchema.Type
export const sharedSuggestionSchema = mutableStruct({
  shareId: uuidSchema,
  revision: uuidSchema,
  name: maxValue(Schema.String, 100),
  text: maxValue(minValue(Schema.String, 1), 12000),
})

/** TweetNaCl is already used by the runtime; all keys/nonces come from the platform CSPRNG. */
export const newSharingKey = () => bytesToHex(nacl.randomBytes(32))
export const sharingUUID = () => uuid({ random: nacl.randomBytes(16) })
export const configureSharingRandom = (fill: (array: Uint8Array) => void) =>
  nacl.setPRNG((array) => fill(array))
export const sharingHash = (value: string) => bytesToHex(sha256(utf8ToBytes(value)))
export const sharingPublicKey = (secret: string) =>
  bytesToHex(nacl.box.keyPair.fromSecretKey(hexToBytes(secret)).publicKey)
export const sharingSigningKey = (seed: string) =>
  bytesToHex(nacl.sign.keyPair.fromSeed(hexToBytes(seed)).publicKey)
export function encryptSharing(value: unknown, key: string): SharingBox {
  const nonce = nacl.randomBytes(24)
  return {
    nonce: bytesToHex(nonce),
    ciphertext: bytesToHex(
      nacl.secretbox(
        utf8ToBytes(JSON.stringify(value)),
        nonce,
        hexToBytes(decode(sharingKeySchema, key)),
      ),
    ),
  }
}
export function decryptSharing(box: SharingBox, key: string): unknown {
  const checked = decode(sharingBoxSchema, box)
  const plain = nacl.secretbox.open(
    hexToBytes(checked.ciphertext),
    hexToBytes(checked.nonce),
    hexToBytes(decode(sharingKeySchema, key)),
  )
  if (!plain) throw new Error('Could not decrypt sharing data. Check your key.')
  return JSON.parse(new TextDecoder().decode(plain)) as unknown
}
const signatureInput = (id: string, packet: Omit<SharePacket, 'signature'>) =>
  utf8ToBytes(
    JSON.stringify([
      'dovo-share-v1',
      id,
      packet.generation,
      packet.revision,
      packet.box.nonce,
      packet.box.ciphertext,
    ]),
  )
export function encryptSharedContent(
  id: string,
  generation: string,
  content: SharedContent,
  vault: Pick<SharingVault, 'contentKey' | 'signingSeed'>,
): SharePacket {
  const packet = {
    generation,
    revision: sharingUUID(),
    box: encryptSharing(decode(sharedContentSchema, content), vault.contentKey),
  }
  return {
    ...packet,
    signature: bytesToHex(
      nacl.sign.detached(
        signatureInput(id, packet),
        nacl.sign.keyPair.fromSeed(hexToBytes(vault.signingSeed)).secretKey,
      ),
    ),
  }
}
export const sharingWriterConfigSchema = mutableStruct({
  taskId: maxValue(minValue(Schema.String, 1), 200),
  id: uuidSchema,
  origin: maxValue(Schema.String, 2048),
  writerSecret: sharingKeySchema,
  contentKey: sharingKeySchema,
  signingSeed: sharingKeySchema,
  generation: uuidSchema,
})
export type SharingWriterConfig = typeof sharingWriterConfigSchema.Type
/** Explicit allowlist: never copy runtime metadata, tools, attachments or unsent drafts. */
export function sharedThreadContent(task: {
  title: string
  messages: readonly {
    id: string
    role: 'user' | 'assistant'
    text: string
    createdAt?: string
    subagentResultId?: string
  }[]
}): Extract<SharedContent, { kind: 'thread' }> {
  return {
    kind: 'thread',
    title: task.title,
    messages: task.messages
      .filter((message) => !message.subagentResultId && !!message.text.trim())
      .map(({ id, role, text, createdAt }) => ({ id, role, text, createdAt })),
  }
}
export function verifySharePacket(id: string, packet: SharePacket, signingKey: string) {
  return nacl.sign.detached.verify(
    signatureInput(id, packet),
    hexToBytes(packet.signature),
    hexToBytes(signingKey),
  )
}
export function decryptSharedContent(
  id: string,
  packet: SharePacket,
  keys: typeof sharingReaderKeysSchema.Type,
) {
  if (!verifySharePacket(id, packet, keys.signingKey))
    throw new Error('The shared content signature is invalid.')
  return decode(sharedContentSchema, decryptSharing(packet.box, keys.contentKey))
}
export function sharingReaderKeys(vault: SharingVault) {
  return {
    contentKey: vault.contentKey,
    signingKey: sharingSigningKey(vault.signingSeed),
    suggestionKey: sharingPublicKey(vault.suggestionSecret),
  }
}
export function encryptSuggestion(
  value: typeof sharedSuggestionSchema.Type,
  recipient: string,
): EncryptedSuggestion {
  const input = decode(sharedSuggestionSchema, value),
    pair = nacl.box.keyPair(),
    nonce = nacl.randomBytes(24)
  return {
    id: sharingUUID(),
    revision: input.revision,
    publicKey: bytesToHex(pair.publicKey),
    box: {
      nonce: bytesToHex(nonce),
      ciphertext: bytesToHex(
        nacl.box(utf8ToBytes(JSON.stringify(input)), nonce, hexToBytes(recipient), pair.secretKey),
      ),
    },
  }
}
export function decryptSuggestion(id: string, suggestion: EncryptedSuggestion, secret: string) {
  const plain = nacl.box.open(
    hexToBytes(suggestion.box.ciphertext),
    hexToBytes(suggestion.box.nonce),
    hexToBytes(suggestion.publicKey),
    hexToBytes(secret),
  )
  if (!plain) throw new Error('Could not decrypt this suggestion')
  const value = decode(sharedSuggestionSchema, JSON.parse(new TextDecoder().decode(plain)))
  if (value.shareId !== id || value.revision !== suggestion.revision)
    throw new Error('Suggestion belongs to another shared conversation')
  return value
}
