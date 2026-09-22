import { randomInt, randomUUID } from 'node:crypto'
import { Devices, equalSecret, newSecret } from './devices.js'
import { HttpError } from '../errors.js'
type Request = {
  id: string
  name: string
  secret: string
  expiresAt: number
  status: 'pending' | 'approved' | 'denied'
  token?: string
}
export class Pairing {
  private code?: { value: string; expiresAt: number; autoApprove: boolean }
  private requests = new Map<string, Request>()
  private attempts = new Map<string, { count: number; until: number }>()
  constructor(
    private readonly devices: Devices,
    private readonly now = () => Date.now(),
  ) {}
  createCode(autoApprove = false) {
    this.code = {
      value: String(randomInt(10000000, 100000000)),
      expiresAt: this.now() + 120000,
      autoApprove,
    }
    return { code: this.code.value, expiresAt: new Date(this.code.expiresAt).toISOString() }
  }
  request(code: string, name: string, address: string) {
    this.cleanup()
    const attempts = this.attempts.get(address) ?? { count: 0, until: this.now() + 60000 }
    attempts.count++
    this.attempts.set(address, attempts)
    if (attempts.count > 5) throw new HttpError(429, 'Too many pairing attempts. Wait one minute.')
    if (!this.code || this.code.expiresAt <= this.now() || !equalSecret(code, this.code.value))
      throw new HttpError(400, 'Pairing code is invalid or expired')
    this.attempts.delete(address)
    const autoApprove = this.code.autoApprove
    if (!autoApprove) this.code = undefined
    const request: Request = {
      id: randomUUID(),
      name,
      secret: newSecret(),
      expiresAt: this.now() + 120000,
      status: 'pending',
    }
    this.requests.set(request.id, request)
    if (autoApprove) this.approve(request.id, true)
    return {
      id: request.id,
      secret: request.secret,
      expiresAt: new Date(request.expiresAt).toISOString(),
    }
  }
  pending() {
    this.cleanup()
    return [...this.requests.values()]
      .filter((r) => r.status === 'pending')
      .map((r) => ({ id: r.id, name: r.name, expiresAt: new Date(r.expiresAt).toISOString() }))
  }
  approve(id: string, allow: boolean) {
    this.cleanup()
    const request = this.requests.get(id)
    if (!request || request.status !== 'pending')
      throw new HttpError(404, 'Pairing request expired')
    request.status = allow ? 'approved' : 'denied'
    if (allow) {
      request.token = newSecret()
      this.devices.add(request.name, request.token)
    }
  }
  claim(id: string, secret: string) {
    this.cleanup()
    const request = this.requests.get(id)
    if (!request || !equalSecret(secret, request.secret))
      throw new HttpError(404, 'Pairing request expired')
    if (request.status === 'pending') return { status: 'pending' as const }
    // Retry the same secret until expiry if the response was lost in transit.
    if (request.token) this.devices.authenticate(request.token)
    return { status: request.status, token: request.token }
  }
  private cleanup() {
    for (const [id, r] of this.requests) if (r.expiresAt <= this.now()) this.requests.delete(id)
    for (const [key, a] of this.attempts) if (a.until <= this.now()) this.attempts.delete(key)
  }
}
