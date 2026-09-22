import { expect, it } from 'vitest'
import { openDatabase } from '../storage/database'
import { Devices } from './devices'
import { Pairing } from './pairing'
it('expires pairing requests and rate limits guesses', () => {
  const db = openDatabase(':memory:')
  let now = 1000
  const pairing = new Pairing(new Devices(db, 'owner'), () => now)
  const code = pairing.createCode()
  now += 120001
  expect(() => pairing.request(code.code, 'Phone', 'test')).toThrow('invalid or expired')
  for (let i = 0; i < 4; i++)
    expect(() => pairing.request('00000000', 'Phone', 'test')).toThrow('invalid or expired')
  expect(() => pairing.request('00000000', 'Phone', 'test')).toThrow('Too many pairing attempts')
  now += 60001
  const fresh = pairing.createCode(),
    request = pairing.request(fresh.code, 'Phone', 'test')
  now += 120001
  expect(() => pairing.approve(request.id, true)).toThrow('expired')
  db.close()
})

it('auto-approves devices only within the issued code lifetime and makes claims recoverable until expiry', () => {
  const db = openDatabase(':memory:')
  let now = 1000
  const devices = new Devices(db, 'owner')
  const pairing = new Pairing(devices, () => now)
  try {
    const code = pairing.createCode(true)
    for (let index = 0; index < 6; index++) {
      const request = pairing.request(code.code, `Device ${index}`, 'same-network')
      const claim = pairing.claim(request.id, request.secret)
      expect(claim.status).toBe('approved')
      expect(claim.token).toBeTruthy()
      expect(pairing.claim(request.id, request.secret)).toEqual(claim)
      expect(() => pairing.claim(request.id, 'wrong-secret')).toThrow('expired')
    }
    expect(devices.list()).toHaveLength(6)
    expect(pairing.pending()).toEqual([])
    now += 120001
    expect(() => pairing.request(code.code, 'Too late', 'same-network')).toThrow('expired')
    const manual = pairing.createCode()
    const request = pairing.request(manual.code, 'Manual device', 'same-network')
    expect(pairing.claim(request.id, request.secret).status).toBe('pending')
    expect(() => pairing.request(manual.code, 'Replay', 'same-network')).toThrow('expired')
  } finally {
    db.close()
  }
})

it('does not recover revoked or expired credentials', () => {
  const db = openDatabase(':memory:')
  let now = 1000
  const devices = new Devices(db, 'owner')
  const pairing = new Pairing(devices, () => now)
  try {
    const code = pairing.createCode(true)
    const request = pairing.request(code.code, 'Phone', 'test')
    pairing.claim(request.id, request.secret)
    devices.revoke(devices.list()[0].id)
    expect(() => pairing.claim(request.id, request.secret)).toThrow('authentication required')
    now += 120001
    expect(() => pairing.claim(request.id, request.secret)).toThrow('expired')
  } finally {
    db.close()
  }
})
