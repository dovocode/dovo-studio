import { afterEach, expect, it } from 'vite-plus/test'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { setupServer } from './server-config'
import { serverStatus, startServer, stopServer } from './server-manager'
import { readConnection } from './connection'

const execute = promisify(execFile)
const directories: string[] = []
const entrypoint = fileURLToPath(new URL('../dist/index.js', import.meta.url))
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-server-lifecycle-'))
  directories.push(directory)
  const socket = createServer()
  await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve))
  const address = socket.address()
  if (!address || typeof address === 'string') throw new Error('No fixture port')
  await new Promise<void>((resolve) => socket.close(() => resolve()))
  setupServer(directory, { host: '127.0.0.1', port: String(address.port) })
  return directory
}
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await stopServer(directory)
    rmSync(directory, { recursive: true, force: true })
  }
})

it('starts independently, reuses a healthy runtime, and preserves pairing through restart without printing credentials', async () => {
  const directory = await fixture()
  const initial = await startServer(directory, entrypoint)
  expect(initial.running).toBe(true)
  expect(initial.managed).toBe(true)
  expect((await startServer(directory, entrypoint)).pid).toBe(initial.pid)
  const connection = readConnection(join(directory, 'runtime-connection.json'))
  expect(JSON.stringify(initial)).not.toContain(connection.token)
  const response = await fetch(connection.address + '/api/pair/code', {
    method: 'POST',
    headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ autoApprove: true }),
  })
  const code = await response.json()
  const pending = await fetch(connection.address + '/api/pair/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: code.code, name: 'Lifecycle phone' }),
  }).then((value) => value.json())
  const paired = await fetch(connection.address + '/api/pair/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: pending.id, secret: pending.secret }),
  }).then((value) => value.json())
  expect(paired.status).toBe('approved')
  await stopServer(directory)
  expect((await serverStatus(directory)).running).toBe(false)
  const next = await startServer(directory, entrypoint)
  expect(next.pid).not.toBe(initial.pid)
  expect(readConnection(join(directory, 'runtime-connection.json')).token).toBe(connection.token)
  const authenticated = await fetch(connection.address + '/api/snapshot', {
    headers: { Authorization: `Bearer ${paired.token}` },
  })
  expect(authenticated.status).toBe(200)
}, 30000)

it('rejects stopping a runtime owned by another launcher', async () => {
  const directory = await fixture()
  const initial = await startServer(directory, entrypoint)
  const statePath = join(directory, 'server-process.json')
  const original = readFileSync(statePath, 'utf8')
  writeFileSync(
    statePath,
    JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
  )
  try {
    await expect(stopServer(directory)).rejects.toThrow('Cannot verify managed process')
  } finally {
    writeFileSync(statePath, original)
  }
  expect((await serverStatus(directory)).pid).toBe(initial.pid)
}, 30000)

it('leaves the running server untouched when staged dependency installation fails', async () => {
  const directory = await fixture()
  const initial = await startServer(directory, entrypoint)
  const fakePnpm = join(directory, 'pnpm')
  writeFileSync(fakePnpm, '#!/bin/sh\nexit 12\n', { mode: 0o700 })
  await expect(
    execute(
      process.execPath,
      [
        fileURLToPath(new URL('../dist/server-cli.js', import.meta.url)),
        'update',
        '--data-dir',
        directory,
        '--json',
      ],
      { env: { ...process.env, PATH: `${directory}:${process.env.PATH}` }, timeout: 30000 },
    ),
  ).rejects.toThrow('pnpm exited with 12')
  expect((await serverStatus(directory)).pid).toBe(initial.pid)
  expect((await serverStatus(directory)).running).toBe(true)
}, 30000)
