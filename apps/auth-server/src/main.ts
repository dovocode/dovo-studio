import { mkdirSync, chmodSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createAuth } from './auth.js'
import { createAuthServer } from './server.js'
import { ownerMappings } from './owners.js'
const root = process.env.DOVO_AUTH_DATA ?? '/data'
mkdirSync(root, { recursive: true, mode: 0o700 })
chmodSync(root, 0o700)
const origin = new URL(process.env.DOVO_AUTH_ORIGIN ?? 'https://auth.dovo.studio').origin
const identity = await createAuth({
  path: join(root, 'identity.sqlite'),
  origin,
  secret: process.env.DOVO_AUTH_SECRET ?? '',
  github: {
    clientId: process.env.DOVO_AUTH_GITHUB_CLIENT_ID ?? '',
    clientSecret: process.env.DOVO_AUTH_GITHUB_CLIENT_SECRET ?? '',
  },
  connectOrigin: process.env.DOVO_CONNECT_ORIGIN ?? 'https://connect.dovo.studio',
  clientId: process.env.DOVO_AUTH_CONNECT_CLIENT_ID ?? 'dovo-connect',
  clientSecret: process.env.DOVO_AUTH_CONNECT_CLIENT_SECRET ?? '',
  owners: process.env.DOVO_AUTH_OWNERS_FILE
    ? ownerMappings(JSON.parse(readFileSync(process.env.DOVO_AUTH_OWNERS_FILE, 'utf8')))
    : {},
})
const server = createAuthServer(identity, {
  origin,
  serviceKey: process.env.DOVO_AUTH_SERVICE_KEY ?? '',
})
server.listen(Number(process.env.PORT ?? 8080), '0.0.0.0')
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () =>
    server.close(() => {
      identity.close()
      process.exit(0)
    }),
  )
