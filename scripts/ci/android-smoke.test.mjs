import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { runAndroidSmoke } from './android-smoke.mjs'

const offline = 'Command failed (host:transport:emulator-5554): device offline'
const launch = { launchAppCommand: { appId: 'com.dovo.studio', clearState: true } }

async function report(directory, command, message) {
  const flow = join(directory, '.maestro', 'tests', 'capture', 'android-recovery')
  await mkdir(flow, { recursive: true })
  await writeFile(
    join(flow, 'commands.json'),
    JSON.stringify([
      { command: { applyConfigurationCommand: {} }, metadata: { status: 'COMPLETED' } },
      { command, metadata: { status: 'FAILED', error: { message } } },
    ]),
  )
}

async function fixture(context) {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-android-smoke-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

void test('restarts Maestro after ADB reports device offline during the clean launch', async (context) => {
  const diagnostics = await fixture(context)
  const attempts = []
  const events = []
  const result = await runAndroidSmoke(
    diagnostics,
    async (directory) => {
      attempts.push(directory)
      events.push('launch')
      if (attempts.length === 2) return 0
      await report(directory, launch, offline)
      return 1
    },
    async () => events.push('reconnect'),
  )
  assert.equal(result, 0)
  assert.deepEqual(events, ['launch', 'reconnect', 'launch'])
  assert.notEqual(attempts[0], attempts[1])
})

void test('returns a later assertion failure and never retries it', async (context) => {
  const diagnostics = await fixture(context)
  const result = await runAndroidSmoke(
    diagnostics,
    async (directory) => {
      await report(directory, { assertConditionCommand: {} }, offline)
      return 1
    },
    async () => assert.fail('the flow already passed launch'),
  )
  assert.equal(result, 1)
})

void test('reports failure when the replacement driver also loses ADB at launch', async (context) => {
  const diagnostics = await fixture(context)
  let attempts = 0
  let retries = 0
  const result = await runAndroidSmoke(
    diagnostics,
    async (directory) => {
      attempts++
      await report(directory, launch, offline)
      return 1
    },
    async () => retries++,
  )
  assert.equal(result, 1)
  assert.equal(attempts, 2)
  assert.equal(retries, 1)
})
