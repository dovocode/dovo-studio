import { test } from 'node:test'
import assert from 'node:assert/strict'
import { finalToolRounds } from './final-tool-instruction-cases.mjs'
import { allToolRounds } from './all-tool-instruction-cases.mjs'

await test('the ten final rounds cover all 53 tools and preserve unique cases in each round', () => {
  const expected = new Set(
    Object.values(allToolRounds).flatMap((cases) =>
      cases.flatMap((test) => test.steps.map((step) => step.tool)),
    ),
  )
  const covered = new Set(
    Object.values(finalToolRounds).flatMap((cases) =>
      cases.flatMap((test) => test.steps.map((step) => step.tool)),
    ),
  )
  assert.equal(Object.keys(finalToolRounds).length, 10)
  assert.equal(covered.size, 53)
  assert.deepEqual(covered, expected)
  for (const cases of Object.values(finalToolRounds)) {
    assert.equal(new Set(cases.map((test) => test.id)).size, cases.length)
    assert.ok(cases.every((test) => test.prompt && test.responses))
  }
})

await test('final cases keep corrected child evidence, scope and literal content expectations', () => {
  const child = finalToolRounds[28].find((test) => test.id === 'authorized-child-result')
  assert.match(child.responses.subagent_read.result, /src\/api\/routes\.ts/)
  const artifact = finalToolRounds[31].find((test) => test.id === 'create-requested-artifact')
  assert.match(artifact.prompt, /no trailing newline/)
  for (const round of [32, 35]) {
    const terminal = finalToolRounds[round].find((test) => test.id === 'known-terminal-lifecycle')
    assert.equal(terminal.steps.find((step) => step.tool === 'terminal_input').fields.data, 'q\r')
    assert.match(
      finalToolRounds[round].find((test) => test.id === 'run-authorized-workflow').prompt,
      /Do not wait for completion/,
    )
  }
})
