import { randomUUID } from 'node:crypto'
import type { PeerConfig, PeerRelayProvider } from '@dovo/protocol'
import type { Devices } from '../auth/devices.js'
import { HttpError } from '../errors.js'

type Upgrade = {
  id: string
  deviceId: string
  name: string
  expiresAt: string
  relay?: PeerRelayProvider
  status: 'pending' | 'approved' | 'denied'
}

/** An existing device credential proves trust, but internet exposure still needs owner consent.
 * One expiring request per device bounds memory and binds approval to the exact relay choice. */
export class PeerUpgrades {
  private requests = new Map<string, Upgrade>()
  private deviceVersion = -1
  private active = new Set<string>()
  constructor(
    private readonly devices: Devices,
    private readonly now = () => Date.now(),
  ) {}
  private cleanup() {
    if (!this.requests.size) return
    const version = this.devices.version()
    if (version !== this.deviceVersion) {
      this.active = new Set(
        this.devices
          .list()
          .filter((d) => !d.revokedAt)
          .map((d) => d.id),
      )
      this.deviceVersion = version
    }
    for (const [deviceId, request] of this.requests)
      if (Date.parse(request.expiresAt) <= this.now() || !this.active.has(deviceId))
        this.requests.delete(deviceId)
  }
  request(deviceId: string, relay?: PeerRelayProvider) {
    this.cleanup()
    const device = this.devices.list().find((d) => d.id === deviceId && !d.revokedAt)
    if (!device || deviceId === 'owner') throw new HttpError(403, 'A paired phone is required')
    const previous = this.requests.get(deviceId)
    if (previous && previous.status !== 'denied') {
      if (previous.relay !== relay)
        throw new HttpError(409, 'Cancel the current request before changing relay fallback')
      return { ...previous }
    }
    const request: Upgrade = {
      id: randomUUID(),
      deviceId,
      name: device.name,
      expiresAt: new Date(this.now() + 120000).toISOString(),
      ...(relay ? { relay } : {}),
      status: 'pending',
    }
    this.requests.set(deviceId, request)
    return { ...request }
  }
  pending() {
    this.cleanup()
    return [...this.requests.values()].filter((r) => r.status === 'pending').map((r) => ({ ...r }))
  }
  approve(id: string, allow: boolean) {
    this.cleanup()
    const request = [...this.requests.values()].find((r) => r.id === id)
    if (!request || request.status !== 'pending')
      throw new HttpError(404, 'Internet connection request expired')
    request.status = allow ? 'approved' : 'denied'
  }
  private find(deviceId: string, id: string) {
    this.cleanup()
    const request = this.requests.get(deviceId)
    if (!request || request.id !== id)
      throw new HttpError(404, 'Internet connection request expired')
    return request
  }
  cancel(deviceId: string, id: string) {
    const request = this.find(deviceId, id)
    const approved = request.status === 'approved'
    request.status = 'denied'
    return approved
  }
  async claim(
    deviceId: string,
    id: string,
    enable: (relay?: PeerRelayProvider) => Promise<PeerConfig>,
    disable: () => void,
  ) {
    const request = this.find(deviceId, id)
    if (request.status !== 'approved') return { ...request }
    try {
      const peer = await enable(request.relay)
      // Consent may expire, be cancelled, or be revoked while signaling connects.
      const current = this.find(deviceId, id)
      if (current.status !== 'approved')
        throw new HttpError(403, 'Internet connection request cancelled')
      return { ...current, peer }
    } catch (error) {
      disable()
      throw error
    }
  }
}
