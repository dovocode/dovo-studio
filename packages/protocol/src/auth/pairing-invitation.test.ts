import { expect, it } from 'vitest'
import { pairingInvitationUrl, parsePairingInvitation } from './pairing-invitation'
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
