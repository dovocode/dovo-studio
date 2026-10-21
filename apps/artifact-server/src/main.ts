import { mkdirSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { ArtifactStore } from './store.js'
import { createArtifactServer } from './server.js'

const root = process.env.DOVO_ARTIFACTS_DATA ?? '/data'
mkdirSync(root, { recursive: true, mode: 0o700 })
chmodSync(root, 0o700)
const quota = (name: string, fallback: number) => {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid ${name}`)
  return value
}
const store = new ArtifactStore(
  join(root, 'artifacts.sqlite'),
  Date.now,
  quota('DOVO_ARTIFACTS_ACCOUNT_BYTES', 100 * 1024 * 1024),
  quota('DOVO_ARTIFACTS_TOTAL_BYTES', 5 * 1024 * 1024 * 1024),
)
const { server, pruneOwners } = createArtifactServer({
  store,
  origin: process.env.DOVO_ARTIFACTS_ORIGIN ?? '',
  connectOrigin: process.env.DOVO_CONNECT_ORIGIN ?? 'https://connect.dovo.studio',
  serviceKey: process.env.DOVO_ARTIFACTS_SERVICE_KEY ?? '',
})
server.listen(Number(process.env.PORT ?? 8080), '0.0.0.0')
let pruning = false
const cleanup = setInterval(() => {
  if (pruning) return
  pruning = true
  void pruneOwners()
    .catch(() => {
      console.error('Artifact account cleanup unavailable; access continues to fail closed')
    })
    .finally(() => {
      pruning = false
    })
}, 60_000)
cleanup.unref()
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => {
    clearInterval(cleanup)
    server.close(() => {
      store.db.close()
      process.exit(0)
    })
  })
