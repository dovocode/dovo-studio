import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { startPairingControl } from './mobile-pairing.mjs'
import { startMobileRecoveryNetwork } from './mobile-recovery-network.mjs'

void test('mobile recovery disconnects existing streams and restores the same address', async () => {
  const runtime = createServer((request, response) => {
    if (request.url !== '/stream') return response.end('ready')
    response.write('connected')
  })
  runtime.listen(0, '127.0.0.1')
  await once(runtime, 'listening')
  const recovery = await startMobileRecoveryNetwork(runtime.address().port)
  const control = await startPairingControl({}, recovery)
  const address = `http://127.0.0.1:${recovery.port}`
  try {
    const stream = await fetch(address + '/stream')
    const reader = stream.body.getReader()
    assert.equal(new TextDecoder().decode((await reader.read()).value), 'connected')
    assert.equal((await fetch(control.address + '/offline')).status, 404)
    assert.equal((await fetch(control.address + '/offline', { method: 'POST' })).status, 200)
    await assert.rejects(reader.read())
    await assert.rejects(fetch(address))
    assert.equal((await fetch(control.address + '/online', { method: 'POST' })).status, 200)
    assert.equal(await (await fetch(address)).text(), 'ready')
  } finally {
    await control.close()
    await recovery.close()
    runtime.closeAllConnections()
    await new Promise((resolve) => runtime.close(resolve))
  }
})
