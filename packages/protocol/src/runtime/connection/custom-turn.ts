import nacl from 'tweetnacl'
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import { Schema } from 'effect'
import { decode, mutableArray, mutableStruct, refine } from '../../shared/schema.js'
import { internetBoxSchema, internetBytes, internetHex } from '../../auth/account-internet.js'
import {
  peerRelaySchema,
  peerRoom,
  PEER_RELAY_MAX_TTL_MS,
  type PeerConfig,
  type PeerRelay,
} from './peer.js'

import { normalizeTurnUrl } from './turn-url.js'
export { normalizeTurnUrl } from './turn-url.js'

const text = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(2048)),
)
export const customTurnSchema = mutableStruct({
  urls: mutableArray(
    refine(
      Schema.String,
      (value) => {
        try {
          normalizeTurnUrl(value)
          return true
        } catch {
          return false
        }
      },
      'Use a standard TURN URL',
    ),
  ).pipe(Schema.check(Schema.isMinLength(1)), Schema.check(Schema.isMaxLength(8))),
  username: text,
  credential: text,
})
export type CustomTurn = typeof customTurnSchema.Type
export const runtimeConnectionModeSchema = Schema.Literals(['automatic', 'webrtc', 'lan'])
export type RuntimeConnectionMode = typeof runtimeConnectionModeSchema.Type
export const RUNTIME_CONNECTION_MODES: { id: RuntimeConnectionMode; name: string }[] = [
  { id: 'automatic', name: 'Automatic · WebRTC/STUN + TURN' },
  { id: 'webrtc', name: 'WebRTC/STUN · no TURN' },
  { id: 'lan', name: 'LAN / VPN only' },
]
export const runtimeConnectionModeDescription = (mode: RuntimeConnectionMode) =>
  mode === 'lan'
    ? 'New connections use a LAN or VPN address. WebRTC, STUN and TURN are disabled.'
    : mode === 'webrtc'
      ? 'Connect directly using WebRTC and STUN. TURN relays are disabled; some networks may not connect.'
      : 'Try direct WebRTC/STUN first, with an authorized TURN relay as fallback.'
export const relaySettingsSchema = mutableStruct({
  mode: Schema.Literals(['default', 'custom', 'organization']),
  connectionMode: Schema.optional(runtimeConnectionModeSchema),
  configured: Schema.Boolean,
  urls: mutableArray(Schema.String),
  organization: Schema.optional(Schema.String),
})
export type RelaySettings = typeof relaySettingsSchema.Type
const boxKey = (config: PeerConfig) =>
  hmac(sha256, hexToBytes(config.secret), utf8ToBytes('dovo-custom-turn-v1'))

/** Broker-visible ciphertext is bound to this paired room and this fresh negotiation. */
export function sealCustomRelay(
  config: PeerConfig,
  session: string,
  relay: PeerRelay,
  nonce: Uint8Array,
) {
  return decode(internetBoxSchema, {
    nonce: internetHex(nonce),
    ciphertext: internetHex(
      nacl.secretbox(
        utf8ToBytes(JSON.stringify({ room: peerRoom(config), session, relay })),
        nonce,
        boxKey(config),
      ),
    ),
  })
}
export function openCustomRelay(
  config: PeerConfig,
  session: string,
  box: typeof internetBoxSchema.Type,
  now = Date.now(),
): PeerRelay {
  if (!config.relay || config.relay === 'cloudflare') throw new Error('Relay fallback is disabled')
  const bytes = nacl.secretbox.open(
    internetBytes(box.ciphertext),
    internetBytes(box.nonce),
    boxKey(config),
  )
  if (!bytes) throw new Error('Relay settings could not be authenticated')
  const value = decode(
    mutableStruct({ room: Schema.String, session: Schema.String, relay: peerRelaySchema }),
    JSON.parse(new TextDecoder().decode(bytes)),
  )
  if (
    value.room !== peerRoom(config) ||
    value.session !== session ||
    value.relay.provider !== 'custom' ||
    value.relay.expiresAt <= now + 60_000 ||
    value.relay.expiresAt > now + PEER_RELAY_MAX_TTL_MS
  )
    throw new Error('Relay settings expired or did not match this connection')
  return value.relay
}
