import { expect, it } from 'vite-plus/test'
import { pairingAddress, pairingInvitationUrl, parsePairingInvitation } from './pairing-invitation'
const invitation = {
  address: 'http://100.90.80.70:8787',
  code: '00112233',
  expiresAt: new Date(Date.now() + 120000).toISOString(),
}
it('roundtrips HTTP VPN invitations without changing scheme or losing leading zeroes', () => {
  expect(parsePairingInvitation(pairingInvitationUrl(invitation))).toEqual(invitation)
})
it('rejects expired, credential-bearing and local-only invitations', () => {
  expect(() =>
    parsePairingInvitation(pairingInvitationUrl(invitation), Date.now() + 180000),
  ).toThrow('expired')
  for (const address of [
    'http://user:secret@host',
    'http://localhost:8787',
    'http://0.0.0.0:8787',
    'file:///tmp/a',
    'http://host/path',
  ])
    expect(() => pairingInvitationUrl({ ...invitation, address })).toThrow(/address|HTTP/)
})
it('rejects unrelated QR codes and missing or malformed pairing fields', () => {
  for (const url of [
    'https://example.com',
    'dovo://other',
    'dovo://pair?address=http://100.90.80.70:8787',
    'not a URL',
  ])
    expect(() => parsePairingInvitation(url)).toThrow(/pairing|HTTP|Invalid URL|digit/)
})

it('normalizes manual LAN and VPN addresses while preserving optional HTTPS', () => {
  expect(pairingAddress(' 100.90.80.70:8787/ ')).toBe('http://100.90.80.70:8787')
  expect(pairingAddress('https://work.example:8787/')).toBe('https://work.example:8787')
})
it('rejects loopback variants and wildcard addresses before requesting pairing', () => {
  for (const address of [
    '127.0.0.2:8787',
    '[::1]:8787',
    '[::ffff:127.0.0.1]:8787',
    'machine.localhost:8787',
    '0.0.0.0:8787',
    '[::]:8787',
    'user:secret@host:8787',
    'host:8787/path',
  ]) {
    expect(() => pairingAddress(address)).toThrow(/address|HTTP/)
  }
})
