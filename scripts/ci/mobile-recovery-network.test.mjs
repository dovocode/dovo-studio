import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { Schema } from 'effect'
import { createRuntimeClient, learnRuntimeRoutes } from '../../packages/protocol/dist/index.js'
import { startPairingControl } from './mobile-pairing.mjs'
import { startMobileRecoveryNetwork } from './mobile-recovery-network.mjs'

void test('mobile recovery disconnects existing streams and restores the same address', async () => {
  const services = { runtimeAddresses: () => [upstreamAddress] }
  const runtimeId = 'mobile-recovery-fixture'
  const runtime = createServer((request, response) => {
    if (request.url === '/health')
      return response.end(JSON.stringify({ service: 'dovo-runtime', runtimeId }))
    if (request.url === '/api/snapshot')
      return response.end(
        JSON.stringify({ runtimeId, runtimeAddresses: services.runtimeAddresses() }),
      )
    if (request.url === '/ready') return response.end(JSON.stringify('ready'))
    if (request.url !== '/stream') return response.end('ready')
    response.write('connected')
  })
  runtime.listen(0, '127.0.0.1')
  await once(runtime, 'listening')
  const upstreamAddress = `http://127.0.0.1:${runtime.address().port}`
  const recovery = await startMobileRecoveryNetwork(runtime.address().port, '127.0.0.1', services)
  const control = await startPairingControl({}, recovery)
  const address = `http://127.0.0.1:${recovery.port}`
  try {
    const snapshot = await (await fetch(address + '/api/snapshot')).json()
    const client = createRuntimeClient(learnRuntimeRoutes({ address, token: 'fixture' }, snapshot))
    const readReady = () =>
      client.request('/ready', undefined, Schema.String, { method: 'GET', timeoutMs: 5000 })
    assert.equal(await readReady(), 'ready')
    const stream = await fetch(address + '/stream')
    const reader = stream.body.getReader()
    assert.equal(new TextDecoder().decode((await reader.read()).value), 'connected')
    assert.equal((await fetch(control.address + '/offline')).status, 404)
    assert.equal((await fetch(control.address + '/offline', { method: 'POST' })).status, 200)
    await assert.rejects(reader.read())
    await assert.rejects(fetch(address))
    assert.equal(await (await fetch(`${upstreamAddress}/ready`)).json(), 'ready')
    await assert.rejects(readReady(), 'the paired client cannot bypass the offline proxy')
    assert.equal((await fetch(control.address + '/online', { method: 'POST' })).status, 200)
    assert.equal(await readReady(), 'ready')
  } finally {
    await control.close()
    await recovery.close()
    runtime.closeAllConnections()
    await new Promise((resolve) => runtime.close(resolve))
  }
  assert.deepEqual(services.runtimeAddresses(), [upstreamAddress])
})
