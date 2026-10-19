import { mkdirSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { AccountStore } from './store.js'
import { identityDeletion } from './delete-identity.js'
import { pushRelay } from './push-relay.js'
import { casdoor } from './oidc.js'
import { createConnectServer } from './server.js'
const root = process.env.DOVO_CONNECT_DATA ?? '/data'
mkdirSync(root, { recursive: true, mode: 0o700 })
chmodSync(root, 0o700)
const origin = new URL(process.env.DOVO_CONNECT_ORIGIN ?? 'https://connect.dovo.studio').origin
const store = new AccountStore(join(root, 'accounts.sqlite'))
const oidc = casdoor({
  issuer: process.env.DOVO_ACCOUNT_ISSUER ?? 'https://auth.dovo.studio',
  clientId: process.env.DOVO_ACCOUNT_CLIENT_ID ?? '30793ba9efd8e96893a9',
  origin,
})
const deleteIdentity = process.env.DOVO_ACCOUNT_DELETE_CLIENT_SECRET
  ? identityDeletion({
      issuer: process.env.DOVO_ACCOUNT_ISSUER ?? 'https://auth.dovo.studio',
      organization: process.env.DOVO_ACCOUNT_ORGANIZATION ?? '',
      clientId: process.env.DOVO_ACCOUNT_DELETE_CLIENT_ID ?? '',
      clientSecret: process.env.DOVO_ACCOUNT_DELETE_CLIENT_SECRET,
    })
  : undefined
const server = createConnectServer({ store, origin, push: pushRelay(), deleteIdentity, ...oidc })
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
