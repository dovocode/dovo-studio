import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { reviewSnapshot } from './fixture.js'

export const secret = () => randomBytes(32).toString('base64url')
const hash = (value: string) => createHash('sha256').update(value).digest()
export const sameSecret = (a: string, b: string) => timingSafeEqual(hash(a), hash(b))
export class DemoError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}
/** Independent, bounded, in-memory reviewer sessions. Restarting wipes every demo device and edit. */
export class DemoSessions {
  private codes = new Map<string, number>()
  private requests = new Map<
    string,
    { secret: string; token: string; expires: number; confirmed: boolean }
  >()
  private devices = new Map<
    string,
    { expires: number; snapshot: ReturnType<typeof reviewSnapshot> }
  >()
  constructor(readonly now = Date.now) {}
  private cleanup() {
    for (const [key, expires] of this.codes) if (expires <= this.now()) this.codes.delete(key)
    for (const [key, item] of this.requests)
      if (item.expires <= this.now()) {
        if (!item.confirmed) this.devices.delete(item.token)
        this.requests.delete(key)
      }
    for (const [key, item] of this.devices) if (item.expires <= this.now()) this.devices.delete(key)
  }
  code() {
    this.cleanup()
    if (this.codes.size + this.requests.size + this.devices.size >= 500)
      throw new DemoError(429, 'The demo is busy. Try again later.')
    let code: string
    do {
      code = String(randomInt(10000000, 100000000))
    } while (this.codes.has(code))
    this.codes.set(code, this.now() + 120_000)
    return code
  }
  pair(code: string) {
    this.cleanup()
    if (!this.codes.delete(code)) throw new DemoError(400, 'Pairing code is invalid or expired')
    const id = randomUUID(),
      value = { secret: secret(), token: secret(), expires: this.now() + 120_000, confirmed: false }
    this.requests.set(id, value)
    this.devices.set(value.token, { expires: value.expires, snapshot: reviewSnapshot() })
    return {
      protocolVersion: 2,
      id,
      secret: value.secret,
      expiresAt: new Date(value.expires).toISOString(),
    }
  }
  claim(id: string, proof: string, action: 'claim' | 'confirm' | 'cancel') {
    this.cleanup()
    const item = this.requests.get(id)
    if (!item || !sameSecret(item.secret, proof))
      throw new DemoError(404, 'Pairing request expired')
    if (action === 'cancel') {
      this.devices.delete(item.token)
      this.requests.delete(id)
      return { ok: true }
    }
    if (action === 'confirm') {
      const device = this.devices.get(item.token)
      if (!device) throw new DemoError(404, 'Pairing request expired')
      item.confirmed = true
      device.expires = this.now() + 24 * 60 * 60_000
      return { ok: true }
    }
    return { status: 'approved', token: item.token }
  }
  device(token: string) {
    this.cleanup()
    const item = this.devices.get(token)
    if (!item) throw new DemoError(401, 'Pair with the review demo again')
    return item.snapshot
  }
}
