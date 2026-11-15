import { test } from 'node:test'
import assert from 'node:assert/strict'
import { qualityCases, qualityCoreIds, scoreToolQuality } from './tool-quality-round.mjs'
const call = (tool, input) => ({ tool, input, valid: true })
await test('freezes a distinct comparison core and covers every advertised tool', () => {
  assert.equal(qualityCoreIds.length, 12)
  assert.equal(new Set(qualityCases.map((t) => t.id)).size, qualityCases.length)
  assert.equal(new Set(qualityCases.flatMap((t) => t.steps.map((s) => s.tool))).size, 53)
  assert.ok(qualityCases.every((t) => t))
})
await test('permits bounded verification but retains the historical strict failure', () => {
  const test = {
    id: 'verify',
    steps: [{ tool: 'terminal_input', fields: { id: 't', data: 'q\r' } }],
    verificationSteps: [{ tool: 'terminal_read', fields: { id: 't' } }],
  }
  const data = [
    call('terminal_input', { id: 't', data: 'q\r' }),
    call('terminal_read', { id: 't' }),
  ]
  const scored = scoreToolQuality(test, data)
  assert.equal(scored.correct, false)
  assert.equal(scored.taskComplete, true)
  assert.equal(scored.extraReads, 1)
  assert.equal(scoreToolQuality(test, [...data, data[1], data[1]]).taskComplete, false)
  assert.equal(
    scoreToolQuality(test, [...data, call('terminal_close', { id: 'other' })]).taskComplete,
    false,
  )
  assert.equal(scoreToolQuality(test, [{ ...data[0], fixtureError: true }]).taskComplete, false)
  assert.equal(scoreToolQuality(test, [{ ...data[0], valid: false }]).taskComplete, false)
  assert.equal(scoreToolQuality(test, data, 'stream failed').taskComplete, false)
})
await test('keeps exact writes and pending dependencies strict', () => {
  const pending = qualityCases.find((t) => t.id === 'pending-question-is-not-an-answer')
  assert.equal(scoreToolQuality(pending, [call('ask_question', {})]).taskComplete, true)
  assert.equal(
    scoreToolQuality(pending, [call('ask_question', {}), call('automation_list', {})]).taskComplete,
    false,
  )
  const edit = {
    id: 'edit',
    steps: [{ tool: 'artifact_update', fields: { id: 'a', content: 'Keep\n' } }],
  }
  assert.equal(
    scoreToolQuality(edit, [call('artifact_update', { id: 'a', content: 'Keep' })]).taskComplete,
    false,
  )
  assert.equal(
    scoreToolQuality(edit, [call('artifact_update', { id: 'a', content: 'Keep\n' })]).taskComplete,
    true,
  )
})
await test('accepts only the same remote target and only the benchmark working path', () => {
  const reference = qualityCases.find((t) => t.id === 'remote-thread-reference')
  const input = { runtimeId: 'runtime-42', command: { action: 'read', id: 'thread-7' } }
  assert.equal(scoreToolQuality(reference, [call('studio_threads', input)]).taskComplete, true)
  assert.equal(
    scoreToolQuality(reference, [call('studio_threads', { ...input, runtimeId: 'other' })])
      .taskComplete,
    false,
  )
  const native = {
    id: 'native-discovery-install',
    steps: [
      { tool: 'device_install', fields: { artifactPath: 'output/Release-iphoneos/Dovo.app' } },
    ],
  }
  const invoke = (p) =>
    scoreToolQuality(
      native,
      [call('device_install', { artifactPath: p })],
      undefined,
      '',
      [],
      [],
      '/tmp/work',
    ).taskComplete
  assert.equal(invoke('/tmp/work/output/Release-iphoneos/Dovo.app'), true)
  assert.equal(invoke('/other/output/Release-iphoneos/Dovo.app'), false)
})
await test('uses navigation state and permits independent task order', () => {
  const test = qualityCases.find((t) => t.id === 'isolated-browser-current-ref')
  const calls = [
    call('browser', { action: 'navigate', url: 'https://example.test' }),
    call('browser', { action: 'click', selector: 'ref=save-42' }),
    call('browser', { action: 'snapshot' }),
  ]
  assert.equal(scoreToolQuality(test, calls).taskComplete, true)
  assert.equal(
    scoreToolQuality(test, [
      ...calls.slice(0, 1),
      call('browser', { action: 'click', selector: 'ref=stale' }),
      calls[2],
    ]).taskComplete,
    false,
  )
  const independent = { id: 'independent', unordered: true, steps: [{ tool: 'a' }, { tool: 'b' }] }
  assert.equal(scoreToolQuality(independent, [call('b', {}), call('a', {})]).taskComplete, true)
})
