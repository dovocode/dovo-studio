import { Schema } from 'effect'
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import { decode, mutableStruct } from '../../shared/schema.js'
import type { PeerConfig } from './peer.js'

export const PEER_ICE_LIMIT = 128
const hex = Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-f0-9]{64}$/)))
export const peerIceCandidateSchema = mutableStruct({
  candidate: Schema.String.pipe(
    Schema.check(Schema.isPattern(/^candidate:/)),
    Schema.check(Schema.isMaxLength(2048)),
  ),
  sdpMid: Schema.NullOr(Schema.String.pipe(Schema.check(Schema.isMaxLength(64)))),
  sdpMLineIndex: Schema.NullOr(
    Schema.Number.pipe(
      Schema.check(Schema.isInt()),
      Schema.check(Schema.isBetween({ minimum: 0, maximum: 65535 })),
    ),
  ),
})
export type PeerIceCandidate = typeof peerIceCandidateSchema.Type
export const peerIceSignalSchema = mutableStruct({
  type: Schema.Literal('ice'),
  session: hex,
  offer: hex,
  role: Schema.Literals(['offer', 'answer']),
  sequence: Schema.Number.pipe(
    Schema.check(Schema.isInt()),
    Schema.check(Schema.isBetween({ minimum: 0, maximum: PEER_ICE_LIMIT })),
  ),
  candidate: Schema.NullOr(peerIceCandidateSchema),
  mac: hex,
})
export type PeerIceSignal = typeof peerIceSignalSchema.Type
export function signPeerIce(config: PeerConfig, value: Omit<PeerIceSignal, 'mac'>): PeerIceSignal {
  return {
    ...value,
    mac: bytesToHex(
      hmac(
        sha256,
        hexToBytes(config.secret),
        utf8ToBytes(
          JSON.stringify([
            'dovo-peer-ice-v1',
            value.session,
            value.offer,
            value.role,
            value.sequence,
            value.candidate
              ? [value.candidate.candidate, value.candidate.sdpMid, value.candidate.sdpMLineIndex]
              : null,
          ]),
        ),
      ),
    ),
  }
}
export function verifyPeerIce(config: PeerConfig, value: PeerIceSignal) {
  const expected = hexToBytes(signPeerIce(config, value).mac)
  const actual = hexToBytes(value.mac)
  let difference = expected.length ^ actual.length
  for (let i = 0; i < expected.length; i++) difference |= expected[i]! ^ (actual[i] ?? 0)
  return difference === 0
}

/** Candidates are authenticated against the exact offer and queued until its remote
 * description is installed. Ordering and finite queues prevent replay and unbounded work. */
export function createPeerIce(options: {
  config: PeerConfig
  session: string
  offer: string
  role: 'offer' | 'answer'
  send: (signal: PeerIceSignal) => void
  add: (candidate: PeerIceCandidate | null) => Promise<void>
  onError: (error: unknown) => void
}) {
  let started = false,
    ready = false,
    stopped = false,
    draining = false
  let sent = 0,
    received = 0,
    localEnded = false,
    remoteEnded = false
  const local: Array<PeerIceCandidate | null> = []
  const remote: Array<PeerIceCandidate | null> = []
  const stop = () => {
    stopped = true
    local.length = 0
    remote.length = 0
  }
  const fail = (error: unknown) => {
    if (stopped) return
    stop()
    options.onError(error)
  }
  const drain = async () => {
    if (draining || !ready || stopped) return
    draining = true
    try {
      while (!stopped && remote.length) await options.add(remote.shift()!)
    } catch (error) {
      fail(error)
    } finally {
      draining = false
    }
  }
  const flush = () => {
    if (!started || stopped) return
    try {
      while (local.length && !stopped)
        options.send(
          signPeerIce(options.config, {
            type: 'ice',
            session: options.session,
            offer: options.offer,
            role: options.role,
            sequence: sent++,
            candidate: local.shift()!,
          }),
        )
    } catch (error) {
      fail(error)
    }
  }
  return {
    candidate(value: PeerIceCandidate | null) {
      if (stopped || localEnded) return
      // Leave room for the authenticated end marker on interfaces with many addresses.
      if (value && sent + local.length >= PEER_ICE_LIMIT) return
      localEnded = value === null
      local.push(value)
      flush()
    },
    start() {
      started = true
      flush()
    },
    ready() {
      ready = true
      void drain()
    },
    receive(raw: unknown) {
      if (stopped) return
      try {
        const value = decode(peerIceSignalSchema, raw)
        if (
          value.session !== options.session ||
          value.offer !== options.offer ||
          value.role === options.role ||
          value.sequence !== received ||
          remoteEnded ||
          (value.candidate !== null && received >= PEER_ICE_LIMIT) ||
          !verifyPeerIce(options.config, value)
        )
          throw new Error('Invalid authenticated ICE candidate')
        received++
        remoteEnded = value.candidate === null
        remote.push(value.candidate)
        void drain()
      } catch (error) {
        fail(error)
      }
    },
    stop,
  }
}
