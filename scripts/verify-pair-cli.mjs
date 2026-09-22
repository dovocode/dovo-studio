import assert from 'node:assert/strict'
import { resolveBindHost, networkUrls } from '../apps/api/dist/network.js'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
const directory = await mkdtemp(join(tmpdir(), 'dovo-pair-cli-'))
const file = join(directory, 'runtime-connection.json')
const runtime = spawn(process.execPath, [resolve('apps/api/dist/index.js')], {
  env: {
    ...process.env,
    DOVO_DATABASE_PATH: join(directory, 'runtime.sqlite'),
    DOVO_HOST: '0.0.0.0',
    PORT: '0',
  },
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
})
const exit = new Promise((resolve) => runtime.once('exit', resolve))
const cli = (args, success = true) =>
  new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [
      resolve('apps/api/dist/cli.js'),
      '--connection',
      file,
      '--json',
      ...args,
    ])
    let output = '',
      error = ''
    child.stdout.on('data', (data) => {
      output += data
    })
    child.stderr.on('data', (data) => {
      error += data
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      try {
        assert.equal(code === 0, success, error || output)
        resolvePromise(success ? JSON.parse(output) : error)
      } catch (error) {
        reject(error)
      }
    })
  })
try {
  await new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => reject(new Error('Runtime startup timed out')), 15000)
    runtime.once('message', () => {
      clearTimeout(timeout)
      resolvePromise()
    })
    runtime.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    runtime.once('exit', () => {
      clearTimeout(timeout)
      reject(new Error('Runtime exited before ready'))
    })
  })
  if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600)
  const connection = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(connection.bindHost, '0.0.0.0')
  const networks = [
    { network: 'local', host: '192.168.1.2', name: 'en0' },
    { network: 'tailscale', host: '100.64.1.2', name: 'Tailscale' },
    { network: 'netbird', host: '100.65.1.2', name: 'NetBird' },
  ]
  for (const entry of networks) assert.equal(resolveBindHost(entry.network, networks), entry.host)
  assert.equal(resolveBindHost('0.0.0.0', networks), '0.0.0.0')
  assert.equal(networkUrls('0.0.0.0', '8787', networks).length, 3)
  assert.equal(networkUrls('127.0.0.1', '8787', networks).length, 0)
  assert.equal(networkUrls('100.65.1.2', '8787', networks)[0].network, 'netbird')
  assert.throws(() => resolveBindHost('tailscale', []), /No tailscale/)
  assert.throws(
    () =>
      resolveBindHost('local', [
        ...networks,
        { network: 'local', host: '192.168.2.2', name: 'en1' },
      ]),
    /Multiple local/,
  )
  const post = async (path, body) => {
    const response = await fetch(connection.address + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { status: response.status, body: await response.json() }
  }
  for (const decision of ['approve', 'deny']) {
    const code = await cli([
      '--manual',
      'code',
      '--public-address',
      'http://example.internal.dovo.network:8787',
    ])
    assert.equal(code.address, 'http://example.internal.dovo.network:8787')
    assert.match(code.code, /^\d{8}$/)
    assert.ok(!JSON.stringify(code).includes(connection.token))
    const pending = await post('/api/pair/request', { code: code.code, name: `Phone ${decision}` })
    assert.equal(pending.status, 200)
    assert.equal((await post('/api/pair/request', { code: code.code, name: 'Replay' })).status, 400)
    assert.ok((await cli(['devices'])).pending.some((device) => device.id === pending.body.id))
    await cli([decision, pending.body.id])
    const claim = await post('/api/pair/claim', pending.body)
    assert.equal(claim.body.status, decision === 'approve' ? 'approved' : 'denied')
    assert.equal(!!claim.body.token, decision === 'approve')
    await cli([decision, pending.body.id], false)
  }
  const automatic = await cli(['code'])
  assert.equal(automatic.autoApprove, true)
  for (const name of ['Automatic phone', 'Automatic web']) {
    const request = await post('/api/pair/request', { code: automatic.code, name })
    assert.equal(request.status, 200)
    const claimed = await post('/api/pair/claim', request.body)
    assert.equal(claimed.body.status, 'approved')
    assert.ok(claimed.body.token)
  }
  assert.equal((await cli(['devices'])).paired.length, 3)
  await cli(['approve'], false)
  await cli(['code', '--public-address', 'file:///tmp/example'], false)
  await cli(['code', '--public-address', 'http://0.0.0.0:8787'], false)
  runtime.kill('SIGTERM')
  await exit
  await assert.rejects(stat(file), { code: 'ENOENT' })
  await cli(['devices'], false)
  console.log(
    'CLI code creation, private address, device listing, approval, denial, one-time claims, credential permissions, cleanup and errors verified.',
  )
} finally {
  if (runtime.exitCode === null) runtime.kill('SIGTERM')
  await exit
  await rm(directory, { recursive: true, force: true })
}
