import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reviewedToolCases, reviewedToolRounds } from './reviewed-tool-instruction-rounds.mjs'

await test('five-round plan retains a matched core and covers all 53 tools', () => {
  assert.deepEqual(Object.keys(reviewedToolRounds), ['37', '38', '39', '40', '41'])
  assert.deepEqual(reviewedToolRounds[37], reviewedToolRounds[38])
  const unique = Object.values(reviewedToolRounds).slice(1).flat()
  assert.equal(new Set(unique).size, unique.length)
  assert.equal(unique.length, reviewedToolCases.length)
  const tools = new Set(reviewedToolCases.flatMap((test) => test.steps.map((step) => step.tool)))
  assert.equal(tools.size, 53)
  for (const id of unique) assert.ok(reviewedToolCases.find((test) => test.id === id))
  assert.equal(Object.values(reviewedToolRounds).flat().length * 3, 159)
})
