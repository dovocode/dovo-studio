import { isIP, type AddressInfo } from 'node:net'
import { createRuntimeServer } from './server.js'
import type { Services } from '../services.js'

export interface ExternalNetworkStatus {
  enabled: boolean
  host: string
  port: number
  error?: string
}

/** A second listener shares the same services and database with the loopback listener. Binding
 * the replacement first keeps existing clients connected if the requested port is unavailable. */
export class ExternalListener {
  private active: ReturnType<typeof createRuntimeServer> | null = null
  private current: ExternalNetworkStatus
  private changing: Promise<void> = Promise.resolve()

  constructor(
    private readonly services: Services,
    host: string,
    port: number,
  ) {
    this.current = { enabled: false, host, port }
  }

  status(): ExternalNetworkStatus {
    return this.current
  }

  pairingAddress(): AddressInfo | null {
    const address = this.active?.server.address()
    return address && typeof address !== 'string' ? address : null
  }

  set(host: string, port: number, enabled: boolean): Promise<ExternalNetworkStatus> {
    const change = this.changing.then(() => this.apply(host, port, enabled))
    this.changing = change.then(
      () => {},
      () => {},
    )
    return change
  }

  private async apply(
    host: string,
    port: number,
    enabled: boolean,
  ): Promise<ExternalNetworkStatus> {
    if (
      (enabled && (isIP(host) !== 4 || host.startsWith('127.'))) ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535
    )
      throw new Error('Choose a LAN/VPN IPv4 bind address and a port between 1 and 65535')
    if (enabled && this.active && this.current.host === host && this.current.port === port)
      return this.current
    if (!enabled) {
      const old = this.active
      this.active = null
      this.current = { enabled: false, host, port }
      if (old) await old.close()
      return this.current
    }
    const next = createRuntimeServer(this.services)
    try {
      await new Promise<void>((resolve, reject) => {
        const error = (cause: Error) => {
          next.server.removeListener('listening', listening)
          reject(cause)
        }
        const listening = () => {
          next.server.removeListener('error', error)
          resolve()
        }
        next.server.once('error', error)
        next.server.once('listening', listening)
        next.server.listen(port, host)
      })
    } catch (cause) {
      next.closeSockets()
      const message = cause instanceof Error ? cause.message : String(cause)
      this.current = { ...this.current, error: message }
      throw cause
    }
    const old = this.active
    this.active = next
    this.current = { enabled: true, host, port }
    if (old) await old.close()
    return this.current
  }

  async close() {
    await this.changing
    const old = this.active
    this.active = null
    if (old) await old.close()
  }
}
