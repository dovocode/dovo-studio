import { generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// Methods a live preview needs. The emulator's default allowlist grants these to the
// `gradle-utp-emulator-control` issuer only when listed in the token's `aud` claim.
const methods = ['streamScreenshot', 'sendTouch', 'setClipboard'].map(
  (method) => `/android.emulation.control.EmulatorController/${method}`,
)
const base64url = (value: string | object) =>
  Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url')

/** Emulators started by Android Studio (or with -grpc-use-jwt) accept signed tokens from any
 * public key placed in their `grpc.jwks` directory, the way Android Studio itself connects. The
 * key only lives while the preview is open and is removed on dispose. */
export async function emulatorKey(directory: string, active: string) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const kid = randomUUID()
  const file = join(directory, `dovo-${kid}.jwk`)
  await writeFile(
    file,
    JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid, alg: 'ES256' }] }),
    { mode: 0o600 },
  )
  const started = Date.now()
  // The emulator watches the directory and republishes the keys it accepted.
  while (!(await readFile(active, 'utf8').catch(() => '')).includes(kid)) {
    if (Date.now() - started > 5000) {
      await rm(file, { force: true })
      throw new Error('The emulator did not accept Dovo’s preview key.')
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  let cached: { token: string; expires: number } | undefined
  return {
    /** A short-lived token, renewed well before it expires. */
    token() {
      const now = Math.floor(Date.now() / 1000)
      if (cached && cached.expires - now > 600) return cached.token
      // The emulator's validator rejects a `typ` header.
      const header = base64url({ alg: 'ES256', kid })
      const payload = base64url({
        iss: 'gradle-utp-emulator-control',
        aud: methods,
        iat: now,
        exp: now + 3600,
      })
      const signature = sign('sha256', Buffer.from(`${header}.${payload}`), {
        key: privateKey,
        dsaEncoding: 'ieee-p1363',
      }).toString('base64url')
      cached = { token: `${header}.${payload}.${signature}`, expires: now + 3600 }
      return cached.token
    },
    dispose: () => rm(file, { force: true }),
  }
}
