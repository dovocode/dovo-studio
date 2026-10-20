import { Schema } from 'effect'
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import { mutableStruct, mutableArray, refine } from '../../shared/schema.js'

const hex = Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-f0-9]{64}$/)))
export const peerRelayIdentitySchema = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[A-Za-z0-9_-]{59}$/)),
)
export const peerRelayProofSchema = mutableStruct({
  type: Schema.Literal('relay-proof'),
  signature: Schema.String.pipe(Schema.check(Schema.isPattern(/^[A-Za-z0-9_-]{86}$/))),
})
export const peerRelayChallengeSchema = mutableStruct({
  type: Schema.Literal('relay-challenge'),
  challenge: hex,
})
export const peerRelayAdmissionPayload = (
  challenge: string,
  room: string,
  hostKey: string,
  clientKey: string,
  relayAllowed: boolean,
  origin: string,
) =>
  JSON.stringify([
    'dovo-relay-admission-v1',
    origin,
    challenge,
    room,
    hostKey,
    clientKey,
    relayAllowed,
  ])
// Retain the prototype value when decoding saved profiles; only Dovo is offered/issued.
export const peerRelayProviderSchema = Schema.Literals(['cloudflare', 'dovo'])
export type PeerRelayProvider = typeof peerRelayProviderSchema.Type
export const PEER_RELAY_CHOICES = [
  { id: 'direct', name: 'Direct only (default)' },
  { id: 'dovo', name: 'Dovo relay fallback' },
]
export const peerRelayDescription = (relay: PeerRelayProvider | undefined) =>
  relay === 'cloudflare'
    ? 'This saved relay is no longer available. Choose Direct only or Dovo relay fallback.'
    : relay === 'dovo'
      ? 'Try direct first. With operator approval, Dovo servers carry encrypted traffic when needed. Only your phone and computer can read it.'
      : 'Your content travels directly between devices. No relay is used. Some networks may not connect.'
export const peerConfigSchema = mutableStruct({
  origin: refine(
    Schema.String,
    (value) => {
      try {
        const url = new URL(value)
        return (
          url.origin === value &&
          !url.username &&
          !url.password &&
          (url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === '127.0.0.1'))
        )
      } catch {
        return false
      }
    },
    'Use an HTTPS Connect origin',
  ),
  secret: hex,
  relay: Schema.optional(peerRelayProviderSchema),
  // Pinned by the computer in its out-of-band QR and the phone's secure registry.
  // The signaling service cannot replace these with arbitrary or private destinations.
  relayHosts: Schema.optional(
    mutableArray(
      Schema.String.pipe(
        Schema.check(Schema.isPattern(/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/)),
      ),
    ).pipe(Schema.check(Schema.isMaxLength(8))),
  ),
})
export type PeerConfig = typeof peerConfigSchema.Type
export const peerSignalSchema = mutableStruct({
  session: hex,
  role: Schema.Literals(['offer', 'answer']),
  // An answer authenticates the complete offer, including its ICE credentials and fingerprint.
  offer: hex,
  sdp: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(65536)),
  ),
  mac: hex,
  relay: Schema.optional(peerRelayProviderSchema),
})
export type PeerSignal = typeof peerSignalSchema.Type
const credential = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(2048)),
)
export const peerRelaySchema = mutableStruct({
  provider: peerRelayProviderSchema,
  expiresAt: Schema.Number.pipe(
    Schema.check(Schema.isInt()),
    Schema.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })),
  ),
  iceServers: mutableArray(
    mutableStruct({
      urls: mutableArray(
        Schema.String.pipe(
          Schema.check(Schema.isPattern(/^turns?:[^\s/]+$/)),
          Schema.check(Schema.isMaxLength(256)),
        ),
      ).pipe(Schema.check(Schema.isMinLength(1)), Schema.check(Schema.isMaxLength(8))),
      username: credential,
      credential,
    }),
  ).pipe(Schema.check(Schema.isMinLength(1)), Schema.check(Schema.isMaxLength(4))),
})
export type PeerRelay = typeof peerRelaySchema.Type
export const PEER_RELAY_MAX_TTL_MS = 10 * 60 * 1000
export function validPeerRelay(
  relay: PeerRelay,
  provider: PeerRelayProvider | undefined,
  now = Date.now(),
  hosts: readonly string[] = ['turn.dovo.studio'],
) {
  return (
    relay.provider === provider &&
    relay.expiresAt > now + 60000 &&
    relay.expiresAt <= now + PEER_RELAY_MAX_TTL_MS &&
    relay.iceServers.length > 0 &&
    relay.iceServers.every(
      (server) =>
        server.urls.length > 0 &&
        server.urls.every((url) => {
          const match = /^(turns?):([a-z0-9.-]+):(\d{1,5})\?transport=(udp|tcp)$/.exec(url)
          return (
            match &&
            hosts.includes(match[2]!) &&
            Number(match[3]) > 0 &&
            Number(match[3]) <= 65535 &&
            (match[1] !== 'turns' || match[4] === 'tcp')
          )
        }),
    )
  )
}
export const peerReadySchema = mutableStruct({
  type: Schema.Literal('ready'),
  relay: Schema.optional(peerRelaySchema),
  relayUnavailable: Schema.optional(peerRelayProviderSchema),
})
export const peerOfferSchema = mutableStruct({
  type: Schema.Literal('offer'),
  signal: peerSignalSchema,
  relay: Schema.optional(peerRelaySchema),
})
export const peerDigest = (value: string) => bytesToHex(sha256(utf8ToBytes(value)))
export const peerRoom = (config: PeerConfig) => peerDigest(`dovo-peer-room-v1:${config.secret}`)
export const peerAddress = (config: PeerConfig) => `http://${peerRoom(config)}.p2p.invalid`
export const isPeerAddress = (address: string) => {
  try {
    return /^[a-f0-9]{64}\.p2p\.invalid$/.test(new URL(address).hostname)
  } catch {
    return false
  }
}
export const peerCapability = (config: PeerConfig, role: 'host' | 'client') =>
  bytesToHex(
    hmac(sha256, hexToBytes(config.secret), utf8ToBytes(`dovo-peer-capability-v1:${role}`)),
  )
export function signPeerSignal(config: PeerConfig, value: Omit<PeerSignal, 'mac'>): PeerSignal {
  return {
    ...value,
    mac: bytesToHex(
      hmac(
        sha256,
        hexToBytes(config.secret),
        utf8ToBytes(
          JSON.stringify([
            'dovo-peer-sdp-v1',
            value.session,
            value.role,
            value.offer,
            value.sdp,
            value.relay ?? 'direct',
          ]),
        ),
      ),
    ),
  }
}
export function verifyPeerSignal(config: PeerConfig, value: PeerSignal) {
  const expected = hexToBytes(signPeerSignal(config, value).mac)
  const actual = hexToBytes(value.mac)
  let difference = expected.length ^ actual.length
  for (let i = 0; i < expected.length; i++) difference |= expected[i]! ^ (actual[i] ?? 0)
  return difference === 0 && /(?:^|\r?\n)a=fingerprint:sha-256 /i.test(value.sdp)
}
export const peerSocketUrl = (config: PeerConfig) => {
  const url = new URL('/v1/peer', config.origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.href
}
export const PEER_STUN_URLS = ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302']
export const PEER_CONNECTION_ERROR =
  'Internet connection failed. Keep Dovo running on the computer. If this network blocks direct WebRTC, an encrypted relay must be available through Dovo Connect.'

// The native implementation owns a loopback tunnel. Never send credentials to a DNS
// address or an advertised LAN route when this connection explicitly selects WebRTC.
let transport:
  | {
      resolve: (
        address: string,
        config: PeerConfig | undefined,
        signal: AbortSignal,
      ) => Promise<string>
      address: (address: string) => string | undefined
    }
  | undefined
export function registerPeerTransport(value: NonNullable<typeof transport>) {
  transport = value
}
function loopbackPeerOrigin(address: string) {
  const url = new URL(address)
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.port === '0' ||
    url.username ||
    url.password ||
    url.origin !== address
  )
    throw new Error('Internet transport must use its private loopback listener')
  return address
}
export function peerTransportAddress(address: string) {
  const selected = transport?.address(address)
  return selected ? loopbackPeerOrigin(selected) : 'http://127.0.0.1:0'
}
export async function resolvePeerTransport(
  address: string,
  config: PeerConfig | undefined,
  signal: AbortSignal,
) {
  if (!transport)
    throw new Error('Internet pairing requires a native Dovo mobile build with WebRTC support.')
  if (config && peerAddress(config) !== new URL(address).origin)
    throw new Error('Invalid internet pairing identity')
  const selected = await transport.resolve(address, config, signal)
  if (signal.aborted) throw signal.reason
  return loopbackPeerOrigin(selected)
}
