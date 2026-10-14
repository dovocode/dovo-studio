import { afterEach, expect, it } from 'vite-plus/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { publishConnection } from './connection'
import { setupServer } from './server-config'
import { serverStatus } from './server-manager'

const directories: string[] = []
const servers: Server[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

it.each([
  { status: 200, owner: true, running: true },
  { status: 200, owner: false, running: false },
  { status: 401, owner: true, running: false },
])('checks overview with owner authentication: $status / $owner', async (fixture) => {
  const token = 'owner-credential-for-status-fixture'
  const server = createServer((request, response) => {
    // Full history is intentionally unavailable: status must not depend on it.
    if (request.url !== '/api/snapshot?scope=overview') {
      response.writeHead(503).end()
      return
    }
    expect(request.headers.authorization).toBe(`Bearer ${token}`)
    response.writeHead(fixture.status, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ owner: fixture.owner }))
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No fixture port')
  const directory = mkdtempSync(join(tmpdir(), 'dovo-server-status-'))
  directories.push(directory)
  setupServer(directory, { host: '127.0.0.1', port: String(address.port) })
  publishConnection(directory, {
    address: `http://127.0.0.1:${address.port}`,
    token,
    pid: process.pid,
  })
  const result = await serverStatus(directory)
  expect(result.running).toBe(fixture.running)
  expect(JSON.stringify(result)).not.toContain(token)
  expect(Boolean(result.error)).toBe(!fixture.running)
})
