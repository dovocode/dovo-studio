import { afterEach, expect, it } from 'vite-plus/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startRuntime } from '../index'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})
async function freePort() {
  const socket = createServer()
  await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve))
  const address = socket.address()
  if (!address || typeof address === 'string') throw new Error('No test port')
  await new Promise<void>((resolve) => socket.close(() => resolve()))
  return address.port
}

it('keeps the internal runtime serving while external ports change or fail', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-dual-listener-'))
  directories.push(directory)
  const token = 'dual-listener-owner-token-at-least-32-characters'
  const externalPort = await freePort()
  const runtime = await startRuntime({
    databasePath: join(directory, 'runtime.sqlite'),
    ownerToken: token,
    host: '127.0.0.1',
    port: 0,
    external: { host: '127.0.0.1', port: externalPort, enabled: false },
  })
  const internal = `http://127.0.0.1:${runtime.port}`
  const owner = async (address: string) =>
    fetch(`${address}/api/snapshot`, { headers: { Authorization: `Bearer ${token}` } })
  try {
    expect((await owner(internal)).status).toBe(200)
    const network = runtime.services.network
    if (!network) throw new Error('External listener was not created')
    const save = (address: string, enabled: boolean, port: number, authorized = true) =>
      fetch(`${address}/api/runtime/network/save`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authorized ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ host: '0.0.0.0', port, enabled }),
      })
    expect((await save(internal, true, externalPort, false)).status).toBe(401)
    expect((await save(internal, true, externalPort)).status).toBe(200)
    expect((await owner(`http://127.0.0.1:${externalPort}`)).status).toBe(200)
    expect((await save(`http://127.0.0.1:${externalPort}`, true, externalPort)).status).toBe(403)
    const occupied = createServer()
    await new Promise<void>((resolve) => occupied.listen(0, '0.0.0.0', resolve))
    const address = occupied.address()
    if (!address || typeof address === 'string') throw new Error('No occupied port')
    try {
      expect((await save(internal, true, address.port)).status).toBe(500)
      expect((await owner(internal)).status).toBe(200)
      expect((await owner(`http://127.0.0.1:${externalPort}`)).status).toBe(200)
    } finally {
      await new Promise<void>((resolve) => occupied.close(() => resolve()))
    }
    expect((await save(internal, false, externalPort)).status).toBe(200)
    expect((await owner(internal)).status).toBe(200)
  } finally {
    await runtime.close()
  }
}, 30000)
