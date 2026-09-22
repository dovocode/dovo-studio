import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { discoverNetworks, resolveBindHost } from './network.js'
import { publishConnection } from './connection.js'
import { startRuntime } from '@dovo/runtime'
import { acquireProcessLock } from './process-lock.js'
import { runtimeOwnerToken } from './owner-token.js'
const databasePath = process.env.DOVO_DATABASE_PATH ?? join(homedir(), '.dovo', 'runtime.sqlite')
mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 })
const releaseLock = acquireProcessLock(join(dirname(databasePath), 'runtime-process.lock'))
process.once('exit', releaseLock)
const ownerToken = runtimeOwnerToken(dirname(databasePath), process.env.DOVO_OWNER_TOKEN)
const requestedHost = process.env.DOVO_HOST ?? '127.0.0.1'
const bindHost = resolveBindHost(
  requestedHost,
  ['local', 'tailscale', 'netbird'].includes(requestedHost) ? await discoverNetworks() : [],
)
const runtime = await startRuntime({
  databasePath,
  ownerToken,
  host: bindHost,
  port: Number(process.env.PORT ?? 8787),
})
const clientHost = ['0.0.0.0', '::'].includes(bindHost) ? '127.0.0.1' : bindHost
const removeConnection = publishConnection(dirname(databasePath), {
  address: `http://${clientHost.includes(':') ? `[${clientHost}]` : clientHost}:${runtime.port}`,
  token: ownerToken,
  pid: process.pid,
  bindHost,
})
console.log(`Dovo runtime listening on ${bindHost}:${runtime.port}`)
process.send?.({
  type: 'ready',
  port: runtime.port,
  address: `http://${clientHost.includes(':') ? `[${clientHost}]` : clientHost}:${runtime.port}`,
})
let stopping = false
async function shutdown() {
  if (stopping) return
  stopping = true
  try {
    await runtime.close()
    removeConnection()
    process.exitCode = 0
  } catch (error) {
    console.error('Runtime shutdown failed', error)
    process.exitCode = 1
  } finally {
    if (process.connected) process.disconnect?.()
  }
}
process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())
process.once('disconnect', () => void shutdown())
