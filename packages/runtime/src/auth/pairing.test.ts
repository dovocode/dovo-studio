import { expect, it, vi } from 'vite-plus/test'
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

it('auto-approves one device per single-use code and makes claims recoverable until expiry', () => {
  const db = openDatabase(':memory:')
  let now = 1000
  const devices = new Devices(db, 'owner')
  const pairing = new Pairing(devices, () => now)
  try {
    const code = pairing.createCode(true)
    for (let index = 0; index < 1; index++) {
      const request = pairing.request(code.code, `Device ${index}`, 'same-network')
      const claim = pairing.claim(request.id, request.secret)
      expect(claim.status).toBe('approved')
      expect(claim.token).toBeTruthy()
      expect(pairing.claim(request.id, request.secret)).toEqual(claim)
      expect(() => pairing.claim(request.id, 'wrong-secret')).toThrow('expired')
    }
    expect(() => pairing.request(code.code, 'Replay', 'other-address')).toThrow('expired')
    expect(devices.list()).toHaveLength(1)
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

it('does not persist unclaimed approvals and cancels claimed credentials', () => {
  const db = openDatabase(':memory:')
  let now = 1000
  const devices = new Devices(db, 'owner')
  const pairing = new Pairing(devices, () => now)
  try {
    const first = pairing.request(pairing.createCode(true).code, 'Abandoned', 'test')
    expect(devices.list()).toHaveLength(0)
    now += 120001
    expect(() => pairing.claim(first.id, first.secret)).toThrow('expired')
    expect(devices.list()).toHaveLength(0)
    const next = pairing.request(pairing.createCode(true).code, 'Phone', 'test')
    const claim = pairing.claim(next.id, next.secret)
    expect(() => pairing.cancel(next.id, 'incorrect')).toThrow('expired')
    pairing.cancel(next.id, next.secret)
    expect(() => devices.authenticate(claim.token ?? '')).toThrow('authentication required')
    expect(pairing.claim(next.id, next.secret).status).toBe('denied')
    expect(pairing.cancel(next.id, next.secret)).toEqual({ ok: true })
  } finally {
    db.close()
  }
})

it('expires unconfirmed claims but preserves confirmed devices after invitation expiry', () => {
  const db = openDatabase(':memory:')
  let now = 1000
  const devices = new Devices(db, 'owner')
  const pairing = new Pairing(devices, () => now)
  try {
    const abandoned = pairing.request(pairing.createCode(true).code, 'Abandoned', 'test')
    const first = pairing.claim(abandoned.id, abandoned.secret)
    const saved = pairing.request(pairing.createCode(true).code, 'Saved', 'test')
    const second = pairing.claim(saved.id, saved.secret)
    expect(() => pairing.confirm(saved.id, 'wrong-secret')).toThrow('expired')
    expect(pairing.confirm(saved.id, saved.secret)).toEqual({ ok: true })
    expect(pairing.confirm(saved.id, saved.secret)).toEqual({ ok: true })
    now += 120001
    pairing.pending()
    expect(() => devices.authenticate(first.token ?? '')).toThrow('authentication required')
    expect(devices.authenticate(second.token ?? '').owner).toBe(false)
  } finally {
    db.close()
  }
})

it('expires provisional trust after runtime restart', () => {
  const db = openDatabase(':memory:')
  try {
    const devices = new Devices(db, 'owner')
    const pairing = new Pairing(devices)
    const request = pairing.request(pairing.createCode(true).code, 'Phone', 'test')
    const claim = pairing.claim(request.id, request.secret)
    db.prepare('UPDATE provisional_devices SET expires_at=0').run()
    const restarted = new Devices(db, 'owner')
    expect(() => restarted.authenticate(claim.token ?? '')).toThrow('authentication required')
    expect(restarted.list()[0].revokedAt).not.toBeNull()
  } finally {
    db.close()
  }
})

it('keeps idle owner checks query-free and invalidates revisions at provisional expiry', () => {
  const db = openDatabase(':memory:')
  const devices = new Devices(db, 'owner')
  const clock = vi.spyOn(Date, 'now')
  let now = Date.now()
  clock.mockImplementation(() => now)
  try {
    const id = devices.add('Temporary', 'temporary-token', 1000)
    const current = devices.version()
    const prepare = vi.spyOn(db, 'prepare')
    for (let index = 0; index < 100; index++) {
      expect(devices.version()).toBe(current)
      devices.authenticate('owner')
    }
    expect(prepare).not.toHaveBeenCalled()
    now += 1000
    expect(devices.version()).not.toBe(current)
    expect(() => devices.authenticate('temporary-token')).toThrow('authentication required')
    expect(devices.list().find((device) => device.id === id)?.revokedAt).toBeTruthy()
    const next = devices.add('Confirmed', 'confirmed-token', 1000)
    devices.confirm(next)
    const confirmed = devices.version()
    now += 15000
    expect(devices.version()).toBe(confirmed)
    now += 1000
    expect(devices.authenticate('confirmed-token').id).toBe(next)
    devices.revoke(next)
    expect(devices.version()).not.toBe(confirmed)
    expect(() => devices.authenticate('confirmed-token')).toThrow('authentication required')
  } finally {
    vi.restoreAllMocks()
    db.close()
  }
})
it('invalidates an active code after failures across rotating addresses', () => {
  const db = openDatabase(':memory:')
  try {
    const pairing = new Pairing(new Devices(db, 'test-owner'))
    const { code } = pairing.createCode(true)
    for (let index = 0; index < 10; index++)
      expect(() => pairing.request('wrong', 'Phone', `2001:db8::${index}`)).toThrow(
        'invalid or expired',
      )
    expect(() => pairing.request(code, 'Phone', 'fresh')).toThrow('invalid or expired')
    const next = pairing.createCode(true)
    expect(pairing.request(next.code, 'Phone', 'fresh').id).toBeTruthy()
  } finally {
    db.close()
  }
})
