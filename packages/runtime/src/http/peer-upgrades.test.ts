import type { PeerConfig, PeerRelayProvider } from '@dovo/protocol'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { openDatabase } from '../storage/database.js'
import { Devices } from '../auth/devices.js'
import { PeerUpgrades } from './peer-upgrades.js'

const cleanup: Array<() => void> = []
afterEach(() => {
  for (const close of cleanup.splice(0)) close()
})
function setup() {
  const db = openDatabase(':memory:')
  cleanup.push(() => db.close())
  const devices = new Devices(db, 'owner')
  const phone = devices.add('Phone', 'phone-token')
  const other = devices.add('Other', 'other-token')
  let now = 1000
  const upgrades = new PeerUpgrades(devices, () => now)
  return {
    devices,
    phone,
    other,
    upgrades,
    advance: () => {
      now += 120001
    },
  }
}
const peer = { origin: 'https://connect.example', secret: 'a'.repeat(64) }
it('requires explicit consent, isolates devices and fixes the relay choice at request time', async () => {
  const { upgrades, phone, other } = setup()
  const request = upgrades.request(phone, 'dovo')
  request.status = 'approved' // Callers cannot mutate the authoritative decision.
  const enable = vi.fn<(relay?: PeerRelayProvider) => Promise<PeerConfig>>(async () => peer)
  const disable = vi.fn<() => void>()
  expect(upgrades.request(phone, 'dovo').status).toBe('pending')
  expect(() => upgrades.request(phone)).toThrow('Cancel the current request')
  expect(() => upgrades.request('owner')).toThrow('paired phone')
  expect(() => upgrades.request('unknown')).toThrow('paired phone')
  await expect(upgrades.claim(other, request.id, enable, disable)).rejects.toThrow('expired')
  expect((await upgrades.claim(phone, request.id, enable, disable)).status).toBe('pending')
  expect(enable).not.toHaveBeenCalled()
  upgrades.approve(request.id, true)
  expect(await upgrades.claim(phone, request.id, enable, disable)).toMatchObject({
    status: 'approved',
    peer,
  })
  expect(enable).toHaveBeenCalledWith('dovo')
  expect(disable).not.toHaveBeenCalled()
  expect(upgrades.pending()).toEqual([])
})
it('keeps denial, cancellation and expiry from creating an internet room', async () => {
  const { upgrades, phone, advance } = setup()
  const enable = vi.fn<(relay?: PeerRelayProvider) => Promise<PeerConfig>>(async () => peer)
  const disable = vi.fn<() => void>()
  const request = upgrades.request(phone)
  upgrades.approve(request.id, false)
  expect((await upgrades.claim(phone, request.id, enable, disable)).status).toBe('denied')
  const retry = upgrades.request(phone)
  expect(retry.id).not.toBe(request.id)
  expect(upgrades.cancel(phone, retry.id)).toBe(false)
  expect(() => upgrades.approve(retry.id, true)).toThrow('expired')
  const last = upgrades.request(phone)
  advance()
  expect(upgrades.pending()).toEqual([])
  await expect(upgrades.claim(phone, last.id, enable, disable)).rejects.toThrow('expired')
  expect(enable).not.toHaveBeenCalled()
})
it.each(['cancel', 'revoke', 'expire'] as const)(
  'fails closed when %s happens while signaling connects',
  async (action) => {
    const { upgrades, phone, devices, advance } = setup()
    const request = upgrades.request(phone)
    upgrades.approve(request.id, true)
    let finish!: (value: typeof peer) => void
    const enable = vi.fn<() => Promise<PeerConfig>>(
      () =>
        new Promise<typeof peer>((resolve) => {
          finish = resolve
        }),
    )
    const disable = vi.fn<() => void>()
    const claim = upgrades.claim(phone, request.id, enable, disable)
    if (action === 'cancel') upgrades.cancel(phone, request.id)
    if (action === 'revoke') devices.revoke(phone)
    if (action === 'expire') advance()
    finish(peer)
    await expect(claim).rejects.toThrow(/cancelled|expired/)
    expect(disable).toHaveBeenCalledOnce()
  },
)
