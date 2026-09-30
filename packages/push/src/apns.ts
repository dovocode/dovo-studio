import { connect } from 'node:http2'
import { readFile } from 'node:fs/promises'
import { importPKCS8, SignJWT } from 'jose'

export type ApnsConfig = {
  keyPath: string
  keyId: string
  teamId: string
  bundleId: string
  production: boolean
}
export function apnsConfig(env = process.env): ApnsConfig | undefined {
  if (!env.DOVO_APNS_KEY_PATH || !env.DOVO_APNS_KEY_ID || !env.DOVO_APNS_TEAM_ID) return undefined
  return {
    keyPath: env.DOVO_APNS_KEY_PATH,
    keyId: env.DOVO_APNS_KEY_ID,
    teamId: env.DOVO_APNS_TEAM_ID,
    bundleId: env.DOVO_APNS_BUNDLE_ID || 'com.dovo.studio',
    production: env.DOVO_APNS_ENVIRONMENT === 'production',
  }
}
export class Apns {
  private jwt?: { value: string; expires: number }
  private signing?: Promise<{ value: string; expires: number }>
  constructor(readonly config: ApnsConfig) {}
  async send(
    token: string,
    payload: object,
    options: { type?: 'alert' | 'liveactivity'; id?: string } = {},
  ): Promise<number> {
    return (await this.deliver(token, payload, options)).status
  }
  sendAlert(token: string, payload: object, id: string) {
    return this.deliver(token, payload, { type: 'alert', id })
  }
  private async deliver(
    token: string,
    payload: object,
    options: { type?: 'alert' | 'liveactivity'; id?: string } = {},
  ): Promise<{ status: number; reason?: string }> {
    if (!this.jwt || this.jwt.expires < Date.now()) {
      const pending = (this.signing ??= (async () => {
        const key = await importPKCS8(await readFile(this.config.keyPath, 'utf8'), 'ES256')
        const value = await new SignJWT({})
          .setProtectedHeader({ alg: 'ES256', kid: this.config.keyId })
          .setIssuer(this.config.teamId)
          .setIssuedAt()
          .sign(key)
        return { value, expires: Date.now() + 45 * 60_000 }
      })())
      try {
        this.jwt = await pending
      } finally {
        if (this.signing === pending) this.signing = undefined
      }
    }
    const authorization = this.jwt.value
    return new Promise((resolve, reject) => {
      const client = connect(
        this.config.production
          ? 'https://api.push.apple.com'
          : 'https://api.sandbox.push.apple.com',
      )
      let reason: string | undefined
      const chunks: Buffer[] = []
      let received = 0
      let settled = false
      const finish = (error?: Error, status = 0) => {
        if (settled) return
        settled = true
        client.destroy()
        if (error) reject(error)
        else resolve({ status, reason })
      }
      client.once('error', (error) => finish(error))
      client.setTimeout(10_000, () => finish(new Error('APNs connection timed out')))
      const request = client.request({
        ':method': 'POST',
        ':path': `/3/device/${token}`,
        authorization: `bearer ${authorization}`,
        'apns-topic':
          options.type === 'alert'
            ? this.config.bundleId
            : `${this.config.bundleId}.push-type.liveactivity`,
        'apns-push-type': options.type ?? 'liveactivity',
        ...(options.id ? { 'apns-collapse-id': options.id } : {}),
        'apns-priority': '10',
        'apns-expiration':
          options.type === 'alert' ? String(Math.floor(Date.now() / 1000) + 3600) : '0',
        'content-type': 'application/json',
      })
      let status = 0
      request.on('response', (headers) => {
        status = Number(headers[':status'])
      })
      // Do not log response bodies or device tokens.
      request.on('data', (chunk: Buffer) => {
        received += chunk.length
        if (received <= 4096) chunks.push(chunk)
      })
      request.once('error', (error) => finish(error))
      request.once('end', () => {
        if (chunks.length && received <= 4096) {
          try {
            const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            if (
              data &&
              typeof data === 'object' &&
              'reason' in data &&
              typeof data.reason === 'string'
            )
              reason = data.reason
          } catch {
            /* An invalid error body leaves the status authoritative. */
          }
        }
        finish(undefined, status)
      })
      request.end(JSON.stringify(payload))
    })
  }
}
