import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allToolRounds } from './all-tool-instruction-cases.mjs'
import { allToolFollowups } from './all-tool-instruction-followups.mjs'
import { instructionFixture, scoreInstructions } from './model-instruction-cases.mjs'

const base = Object.entries(allToolRounds)
  .filter(([round]) => Number(round) <= 21)
  .flatMap(([, cases]) => cases)
await test('the full-catalog matrix covers all 54 tools without missing case definitions', () => {
  const expected =
    `studio_discover studio_threads studio_automations studio_browsers studio_ui studio_diagnostics conversation_read dovo_help skill_read ask_question thread_prepare response_prepare automation_list automation_prepare todos secure_input linked_projects browser workflow subagent_spawn subagent_list subagent_answer subagent_send subagent_read subagent_wait subagent_cancel bot_history propose_skill memory_list memory_read memory_write memory_delete artifact_list artifact_read devices device device_install device_deploy device_forward pipeline_watch pull_request_watch artifact_create artifact_update simulator_tap simulator_swipe simulator_key simulator_button simulator_gesture simulator_text terminal_run terminal_rename terminal_close terminal_read terminal_input`.split(
      ' ',
    )
  assert.deepEqual(
    [...new Set(base.flatMap((test) => test.steps.map((step) => step.tool)))].sort((a, b) =>
      a.localeCompare(b),
    ),
    expected.sort((a, b) => a.localeCompare(b)),
  )
  assert.equal(new Set(base.map((test) => test.id)).size, base.length)
  assert.ok(base.every((test) => test.prompt && test.responses))
})
await test('Memory delete uses the UUID returned by the read and rejects a stale revision', () => {
  const test = base.find((test) => test.id === 'delete-memory-revision')
  const revision = test.responses.memory_read.revision
  assert.match(revision, /^[a-f0-9-]{36}$/)
  const calls = [
    { tool: 'memory_read', input: test.steps[0].fields, valid: true },
    { tool: 'memory_delete', input: { ...test.steps[1].fields }, valid: true },
  ]
  assert.equal(scoreInstructions(test, calls).correct, true)
  calls[1].input.expectedRevision = '00000000-0000-4000-8000-000000000099'
  assert.equal(scoreInstructions(test, calls).correct, false)
})
await test('read fixtures expose production field names for search, children and tabs', () => {
  assert.ok(
    base.find((test) => test.id === 'installed-help-search-read').responses.dovo_help.actions.search
      .results,
  )
  assert.ok(base.find((test) => test.id === 'memory-find-read').responses.memory_list.entries)
  assert.ok(
    base.find((test) => test.id === 'bot-history-recall').responses.bot_history.hits[0].snippet,
  )
  assert.equal(
    base.find((test) => test.id === 'authorized-child-result').responses.subagent_spawn.id,
    'child-42',
  )
  assert.ok(base.find((test) => test.id === 'child-discovery-wait').responses.subagent_list.agents)
  assert.ok(
    base.find((test) => test.id === 'signed-in-tab-snapshot').responses.studio_browsers.actions.list
      .sessions,
  )
})
await test('the browser fixture changes only after a valid current-reference click', () => {
  const test = base.find((test) => test.id === 'isolated-browser-current-ref')
  const state = {}
  for (const action of ['navigate', 'snapshot'])
    instructionFixture(test, 'browser', { action }, true, state)
  const unknown = instructionFixture(
    test,
    'browser',
    { action: 'click', selector: 'ref=unknown' },
    true,
    state,
  )
  assert.equal(unknown.isError, true)
  assert.doesNotMatch(
    instructionFixture(test, 'browser', { action: 'snapshot' }, true, state).text,
    /Saved/,
  )
  instructionFixture(test, 'browser', { action: 'click', selector: 'ref=save-42' }, true, state)
  assert.equal(
    instructionFixture(test, 'browser', { action: 'snapshot' }, true, state).text,
    'Saved',
  )
})

await test('terminal cases require an actual carriage return, not literal escape text', () => {
  for (const cases of [allToolRounds[21], allToolFollowups[25]]) {
    const terminal = cases.find((test) => test.steps.some((step) => step.tool === 'terminal_input'))
    assert.equal(terminal.steps.find((step) => step.tool === 'terminal_input').fields.data, 'q\r')
  }
})

await test('unsupported-device wording accepts a clear refusal and still rejects tool calls', () => {
  const test = allToolFollowups[25].find((test) => test.id === 'unsupported-native-control')
  const reply = 'Pinch is not available. This device has no multi-touch runner.'
  assert.equal(scoreInstructions(test, [], undefined, reply).correct, true)
  assert.equal(
    scoreInstructions(
      test,
      [{ tool: 'simulator_gesture', input: {}, valid: true }],
      undefined,
      reply,
    ).correct,
    false,
  )
})
