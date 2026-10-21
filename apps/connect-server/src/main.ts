import { mkdirSync, chmodSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AccountStore } from './store.js'
import { pushRelay } from './push-relay.js'
import { remoteIdentity } from './remote-identity.js'
import { createConnectServer } from './server.js'
import { dovoTurn } from './dovo-turn.js'
import { approvedRelayInstallations } from './relay-admission.js'
import { organizations } from './organizations.js'
import { artifactService } from './artifact-api.js'
import { RequestError } from './http.js'
const root = process.env.DOVO_CONNECT_DATA ?? '/data'
mkdirSync(root, { recursive: true, mode: 0o700 })
chmodSync(root, 0o700)
const origin = new URL(process.env.DOVO_CONNECT_ORIGIN ?? 'https://connect.dovo.studio').origin
const store = new AccountStore(join(root, 'accounts.sqlite'))
const identity = process.env.DOVO_AUTH_ISSUER
  ? remoteIdentity({
      issuer: process.env.DOVO_AUTH_ISSUER,
      origin,
      clientId: process.env.DOVO_AUTH_CONNECT_CLIENT_ID ?? 'dovo-connect',
      clientSecret: process.env.DOVO_AUTH_CONNECT_CLIENT_SECRET ?? '',
      serviceKey: process.env.DOVO_AUTH_SERVICE_KEY ?? '',
    })
  : undefined
const unconfiguredSignIn = async () => {
  throw new RequestError(503, 'Hosted sign-in is not configured on this broker')
}
const server = createConnectServer({
  store,
  origin,
  artifacts: artifactService(
    process.env.DOVO_ARTIFACTS_ORIGIN,
    process.env.DOVO_ARTIFACTS_SERVICE_KEY,
  ),
  organizations: process.env.DOVO_ORGANIZATIONS_FILE
    ? organizations(JSON.parse(readFileSync(process.env.DOVO_ORGANIZATIONS_FILE, 'utf8')), origin)
    : [],
  push: pushRelay(),
  deleteIdentity: identity?.deleteIdentity,
  peerRelays: {
    dovo:
      process.env.DOVO_RELAY_TURN_URLS || process.env.DOVO_RELAY_TURN_SECRET
        ? dovoTurn({
            urls: (process.env.DOVO_RELAY_TURN_URLS ?? '')
              .split(',')
              .map((url) => url.trim())
              .filter(Boolean),
            secret: process.env.DOVO_RELAY_TURN_SECRET ?? '',
            hourlyLimit: process.env.DOVO_TURN_HOURLY_LIMIT
              ? Number(process.env.DOVO_TURN_HOURLY_LIMIT)
              : undefined,
          })
        : undefined,
  },
  peerRelayAdmission: approvedRelayInstallations(
    (process.env.DOVO_RELAY_APPROVED_KEYS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  ),
  authorizationOrigin: identity?.authorizationOrigin ?? origin,
  authorize: identity?.authorize ?? unconfiguredSignIn,
  exchange: identity?.exchange ?? unconfiguredSignIn,
  trustedProxies: (process.env.DOVO_CONNECT_TRUSTED_PROXIES ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
})
server.listen(Number(process.env.PORT ?? 8080), '0.0.0.0')
const cleanup = setInterval(() => store.cleanup(), 60_000)
cleanup.unref()
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => {
    clearInterval(cleanup)
    server.close(() => {
      store.db.close()
      process.exit(0)
    })
  })
