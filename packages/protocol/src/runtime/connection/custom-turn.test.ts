import { expect, it } from 'vite-plus/test'
import { normalizeTurnUrl, sealCustomRelay, openCustomRelay } from './custom-turn.js'
import { validPeerRelay, type PeerRelay } from './peer.js'

it('accepts standard UDP, TCP and TLS TURN URLs, default ports and IPv6', () => {
  expect(normalizeTurnUrl('turn:relay.example.com')).toBe(
    'turn:relay.example.com:3478?transport=udp',
  )
  expect(normalizeTurnUrl('turns:relay.example.com')).toBe(
    'turns:relay.example.com:5349?transport=tcp',
  )
  expect(normalizeTurnUrl('turn:[2001:db8::1]:80?transport=tcp')).toBe(
    'turn:[2001:db8::1]:80?transport=tcp',
  )
  for (const url of [
    'https://relay.example.com',
    'turn:user:password@host:3478',
    'turn:host/path',
    'turn:host:0',
    'turn:host:65536',
    'turns:host?transport=udp',
    'turn:host#secret',
    'turn:host?transport=udp&x=1',
    'turn:host\\evil',
  ])
    expect(() => normalizeTurnUrl(url)).toThrow(/TURN|URL|port/i)
})

it('authenticates fresh server policy without exposing TURN credentials to signaling', () => {
  const config = { origin: 'https://connect.test', secret: 'a'.repeat(64), relay: 'dovo' as const }
  const now = Date.now()
  const relay: PeerRelay = {
    provider: 'custom',
    expiresAt: now + 300_000,
    iceServers: [
      {
        urls: ['turn:10.0.0.1:3478?transport=udp'],
        username: 'private-user',
        credential: 'private-password',
      },
    ],
  }
  const box = sealCustomRelay(config, 'session-a', relay, new Uint8Array(24).fill(7))
  expect(JSON.stringify(box)).not.toContain('private')
  expect(openCustomRelay(config, 'session-a', box, now)).toEqual(relay)
  expect(() => openCustomRelay(config, 'session-b', box, now)).toThrow(
    'Relay settings expired or did not match this connection',
  )
  expect(() =>
    openCustomRelay({ ...config, secret: 'b'.repeat(64) }, 'session-a', box, now),
  ).toThrow('Relay settings could not be authenticated')
  expect(() => openCustomRelay({ ...config, relay: undefined }, 'session-a', box, now)).toThrow(
    'Relay fallback is disabled',
  )
  expect(() => openCustomRelay(config, 'session-a', box, now + 240_000)).toThrow(
    'Relay settings expired or did not match this connection',
  )
  expect(() =>
    openCustomRelay(
      config,
      'session-a',
      { ...box, ciphertext: box.ciphertext.slice(0, -2) + '00' },
      now,
    ),
  ).toThrow('Relay settings could not be authenticated')
  // Custom destinations require the runtime's authenticated envelope, never broker plaintext.
  expect(validPeerRelay(relay, 'custom', now, ['10.0.0.1'])).toBe(false)
})
