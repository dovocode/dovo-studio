import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { openDatabase } from '../../packages/runtime/dist/storage/database.js'
import { Devices } from '../../packages/runtime/dist/auth/devices.js'
import { Pairing } from '../../packages/runtime/dist/auth/pairing.js'
import { preparePairingFlow, startPairingControl } from './mobile-pairing.mjs'

const { parseAllDocuments } = createRequire(
  new URL('../../packages/runtime/package.json', import.meta.url),
)('yaml')

void test('slow driver startup gets a fresh single-use code with normal expiry and approval', async () => {
  const db = openDatabase(':memory:')
  let now = Date.now()
  const pairing = new Pairing(new Devices(db, 'owner'), () => now)
  const control = await startPairingControl(pairing)
  try {
    const beforeStartup = pairing.createCode()
    now += 180000
    assert.throws(
      () => pairing.request(beforeStartup.code, 'Dovo simulator test', 'test'),
      /invalid or expired/,
    )
    assert.equal((await fetch(control.address + '/pairing-code')).status, 404)
    assert.equal((await fetch(control.address + '/other', { method: 'POST' })).status, 404)
    const response = await fetch(control.address + '/pairing-code', { method: 'POST', body: '{}' })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    const fresh = await response.json()
    assert.equal(Date.parse(fresh.expiresAt), now + 120000)
    const request = pairing.request(fresh.code, 'Dovo simulator test', 'test')
    assert.equal(pairing.claim(request.id, request.secret).status, 'pending')
    pairing.approve(request.id, true)
    assert.equal(pairing.claim(request.id, request.secret).status, 'approved')
    assert.throws(() => pairing.request(fresh.code, 'Replay', 'other-address'), /expired/)
    const next = await (
      await fetch(control.address + '/pairing-code', { method: 'POST', body: '{}' })
    ).json()
    now += 120001
    assert.throws(() => pairing.request(next.code, 'Too late', 'test'), /invalid or expired/)
  } finally {
    await control.close()
    db.close()
  }
})

void test('the native release flow mints its code at input, after driver startup and navigation', async () => {
  const flow = await readFile(
    new URL('../../apps/mobile/maestro/release-smoke.yaml', import.meta.url),
    'utf8',
  )
  const prepared = preparePairingFlow(flow)
  assert.ok(!prepared.includes('${PAIRING_CODE}'))
  const documents = parseAllDocuments(prepared)
  assert.ok(documents.every((document) => document.errors.length === 0))
  const commands = documents[1].toJS()
  const addressInput = commands.findIndex(
    (command) => command.repeat?.times === '${RUNTIME_ADDRESS.length}',
  )
  assert.ok(addressInput > 0)
  assert.deepEqual(commands[addressInput + 1], {
    assertVisible: { id: 'Computer address', text: '${RUNTIME_ADDRESS}' },
  })
  const codeInput = commands.findIndex((command) => command.inputText === '${output.pairing.code}')
  assert.deepEqual(commands[codeInput + 1], {
    assertVisible: { id: 'Pairing code', text: '${output.pairing.code}' },
  })
  const mint = prepared.indexOf('- evalScript: ${output.pairing')
  assert.ok(mint > prepared.indexOf('id: Pairing code'))
  assert.ok(mint < prepared.indexOf('- inputText: ${output.pairing.code}'))
  assert.ok(mint < prepared.indexOf('- tapOn: Dismiss keyboard'))
})

void test('native address entry restores focus and observes each prefix before more input', () => {
  const prepared = preparePairingFlow('- inputText: ${RUNTIME_ADDRESS}')
  const commands = parseAllDocuments(prepared)[0].toJS()
  for (const [address, loseFocus] of [
    ['http://192.168.64.12:63424', false],
    ['http://100.98.12.3:51464', true],
  ]) {
    const context = { RUNTIME_ADDRESS: address, output: {} }
    const entered = []
    let observed = ''
    let focused = false
    const evaluate = (expression) => runInNewContext(expression.slice(2, -1), context)
    const execute = (commands) => {
      for (const command of commands) {
        if (command.evalScript) evaluate(command.evalScript)
        if (command.runFlow) {
          assert.deepEqual(command.runFlow.when, { notVisible: { id: 'Dismiss keyboard' } })
          if (!focused) execute(command.runFlow.commands)
        }
        if (command.tapOn) {
          assert.equal(focused, false, 'Do not select text by retapping a focused input')
          assert.equal(command.tapOn.id, 'Computer address')
          assert.equal(command.tapOn.point, '95%, 50%')
          focused = true
        }
        if (command.inputText) {
          assert.equal(focused, true, 'Target the input even after a snapshot loses focus')
          assert.equal(observed, entered.join(''), 'Wait for UIKit before the next input')
          entered.push(evaluate(command.inputText))
        }
        if (command.assertVisible) {
          assert.equal(command.assertVisible.id, 'Computer address')
          observed = evaluate(command.assertVisible.text)
          assert.equal(observed, entered.join(''))
          if (loseFocus) focused = false
        }
        if (command.repeat)
          for (let index = 0; index < evaluate(command.repeat.times); index++)
            execute(command.repeat.commands)
      }
    }
    execute(commands)
    assert.deepEqual(entered, address.split(''))
    assert.equal(entered.join(''), address)
    assert.deepEqual(commands.at(-1), {
      assertVisible: { id: 'Computer address', text: '${RUNTIME_ADDRESS}' },
    })
  }
})
