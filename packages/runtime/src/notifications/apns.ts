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
  constructor(readonly config: ApnsConfig) {}
  async send(token: string, payload: object): Promise<number> {
    if (!this.jwt || this.jwt.expires < Date.now()) {
      const key = await importPKCS8(await readFile(this.config.keyPath, 'utf8'), 'ES256')
      const value = await new SignJWT({})
        .setProtectedHeader({ alg: 'ES256', kid: this.config.keyId })
        .setIssuer(this.config.teamId)
        .setIssuedAt()
        .sign(key)
      this.jwt = { value, expires: Date.now() + 45 * 60_000 }
    }
    const authorization = this.jwt.value
    return new Promise((resolve, reject) => {
      const client = connect(
        this.config.production
          ? 'https://api.push.apple.com'
          : 'https://api.sandbox.push.apple.com',
      )
      let settled = false
      const finish = (error?: Error, status = 0) => {
        if (settled) return
        settled = true
        client.destroy()
        if (error) reject(error)
        else resolve(status)
      }
      client.once('error', (error) => finish(error))
      client.setTimeout(10_000, () => finish(new Error('APNs connection timed out')))
      const request = client.request({
        ':method': 'POST',
        ':path': `/3/device/${token}`,
        authorization: `bearer ${authorization}`,
        'apns-topic': `${this.config.bundleId}.push-type.liveactivity`,
        'apns-push-type': 'liveactivity',
        'apns-priority': '10',
        'apns-expiration': '0',
        'content-type': 'application/json',
      })
      let status = 0
      request.on('response', (headers) => {
        status = Number(headers[':status'])
      })
      // Do not log response bodies or device tokens.
      request.on('data', () => {})
      request.once('error', (error) => finish(error))
      request.once('end', () => finish(undefined, status))
      request.end(JSON.stringify(payload))
    })
  }
}
