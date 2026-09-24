/// <reference types="node" />
import { afterEach, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  authenticateAcp,
  acpControl,
  deleteAcpSession,
  inspectAcp,
  listAcpSessions,
  logoutAcp,
  openAcpConnection,
} from './acp-connection.js'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function fixture(version = 1, sessionCapabilities: Record<string, object> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'dovo-acp-'))
  dirs.push(dir)
  const script = join(dir, 'agent.cjs')
  await writeFile(
    script,
    `const { createInterface } = require('node:readline')
const { writeFileSync } = require('node:fs')
createInterface({ input: process.stdin }).on('line', (line) => {
  const input = JSON.parse(line)
  if (input.method === 'initialize') {
    writeFileSync(process.env.TEST_INIT_RECORD, JSON.stringify(input.params))
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: input.id, result: {
      protocolVersion: ${version}, agentInfo: { name: 'fixture', version: '1.0.0' },
      agentCapabilities: { sessionCapabilities: ${JSON.stringify(sessionCapabilities)} },
      authMethods: [{ id: 'browser', name: 'Browser' }, { id: 'login', name: 'Terminal', type: 'terminal', args: ['--login'] }]
    } }) + '\\n')
  } else if (input.method === 'authenticate') {
    writeFileSync(process.env.TEST_AUTH_RECORD, JSON.stringify(input.params))
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: input.id, result: {} }) + '\\n')
  } else if (input.method === 'session/list') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: input.id, result: { sessions: [{ sessionId: 's', cwd: '/repo' }] } }) + '\\n')
  } else if (input.method === 'session/delete') {
    writeFileSync(process.env.TEST_AUTH_RECORD, JSON.stringify(input.params))
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: input.id, result: {} }) + '\\n')
  }
})`,
  )
  return {
    command: process.execPath,
    args: [script],
    env: { TEST_AUTH_RECORD: join(dir, 'auth.json'), TEST_INIT_RECORD: join(dir, 'init.json') },
  }
}

it('inspects advertised authentication and authenticates only agent methods', async () => {
  const launch = await fixture()
  const inspected = await inspectAcp(launch)
  expect(inspected.agentInfo?.name).toBe('fixture')
  expect(inspected.authMethods.map((method) => method.id)).toEqual(['browser', 'login'])
  const { readFile } = await import('node:fs/promises')
  expect(
    JSON.parse(await readFile(launch.env.TEST_INIT_RECORD, 'utf8')).clientCapabilities.auth,
  ).toEqual({ terminal: true })
  await expect(authenticateAcp(launch, 'login')).rejects.toThrow('interactive terminal')
  await expect(logoutAcp(launch)).rejects.toThrow('does not support logout')
  await authenticateAcp(launch, 'browser')
  expect(JSON.parse(await readFile(launch.env.TEST_AUTH_RECORD, 'utf8'))).toEqual({
    methodId: 'browser',
  })
})

it('rejects a negotiated protocol version the client does not support', async () => {
  await expect(inspectAcp(await fixture(2))).rejects.toThrow('protocol version 2 is unsupported')
})

it('gates session listing and deletion on advertised capabilities', async () => {
  const unsupported = await fixture()
  await expect(listAcpSessions(unsupported)).rejects.toThrow('does not support listing')
  await expect(deleteAcpSession(unsupported, 's')).rejects.toThrow('does not support deleting')
  const supported = await fixture(1, { list: {}, delete: {} })
  expect((await listAcpSessions(supported, { cwd: '/repo' })).sessions).toEqual([
    { sessionId: 's', cwd: '/repo' },
  ])
  await deleteAcpSession(supported, 's')
  const { readFile } = await import('node:fs/promises')
  expect(JSON.parse(await readFile(supported.env.TEST_AUTH_RECORD, 'utf8'))).toEqual({
    sessionId: 's',
  })
})

it.skipIf(process.platform === 'win32')('closes descendants of an ACP launcher', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dovo-acp-descendant-'))
  dirs.push(dir)
  const script = join(dir, 'launcher.cjs')
  const ready = join(dir, 'ready')
  const stopped = join(dir, 'stopped')
  const grandchild = `const fs=require('node:fs');process.on('SIGTERM',()=>{fs.writeFileSync(${JSON.stringify(stopped)},'yes');process.exit(0)});fs.writeFileSync(${JSON.stringify(ready)},'yes');setInterval(()=>{},1000)`
  await writeFile(
    script,
    `
const { spawn } = require('node:child_process')
spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'ignore' })
setInterval(() => {}, 1000)
`,
  )
  const connection = openAcpConnection(
    { command: process.execPath, args: [script], env: {} },
    { requestPermission: () => ({ outcome: { outcome: 'cancelled' } }), sessionUpdate: () => {} },
  )
  try {
    for (let tries = 0; tries < 100; tries++) {
      if (
        await readFile(ready, 'utf8')
          .then(() => true)
          .catch(() => false)
      )
        break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(await readFile(ready, 'utf8')).toBe('yes')
  } finally {
    await connection.close()
  }
  for (let tries = 0; tries < 100; tries++) {
    if (
      await readFile(stopped, 'utf8')
        .then(() => true)
        .catch(() => false)
    )
      break
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  expect(await readFile(stopped, 'utf8')).toBe('yes')
})

it('keeps ACP server details when control requests fail', async () => {
  const launch = await fixture()
  const connection = openAcpConnection(launch, {
    requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
    sessionUpdate: async () => {},
  })
  try {
    const error = Object.assign(new Error('Internal error'), {
      data: { details: 'Permission denied: helper' },
    })
    await expect(acpControl(connection, Promise.reject(error), 'session setup')).rejects.toThrow(
      'ACP session setup: Internal error: Permission denied: helper',
    )
  } finally {
    await connection.close()
  }
})
