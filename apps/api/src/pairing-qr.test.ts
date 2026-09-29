import { expect, it } from 'vite-plus/test'
import { parsePairingInvitation } from '@dovo/protocol'
import { pairingQr } from './pairing-qr'

it('renders a terminal QR with a validated HTTP pairing invitation and leading zeroes', async () => {
  const invitation = {
    address: 'http://100.90.80.70:51464',
    code: '00112233',
    expiresAt: new Date(Date.now() + 120000).toISOString(),
  }
  const qr = await pairingQr(invitation)
  expect(parsePairingInvitation(qr.url)).toEqual(invitation)
  expect(qr.terminal).toContain('▄')
  expect(qr.terminal.split('\n').length).toBeGreaterThan(15)
})
it('rejects expired invitations and addresses the phone cannot reach', async () => {
  const invitation = {
    address: 'http://192.168.1.10:51464',
    code: '12345678',
    expiresAt: new Date(Date.now() + 120000).toISOString(),
  }
  await expect(
    pairingQr({ ...invitation, expiresAt: new Date(Date.now() - 1000).toISOString() }),
  ).rejects.toThrow('expired')
  await expect(pairingQr({ ...invitation, address: 'http://127.0.0.1:51464' })).rejects.toThrow(
    'Wi-Fi or VPN',
  )
})
