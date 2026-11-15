import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareQuality, requestEvidence } from './summarize-tool-quality-round.mjs'

await test('reports paired gains and regressions without replacing strict scores', () => {
  const baseline = [
    { id: 'a', taskComplete: false, correct: false },
    { id: 'b', taskComplete: true, correct: false },
    { id: 'c', taskComplete: true, correct: true },
  ]
  const candidate = [
    { id: 'a', taskComplete: true, correct: false },
    { id: 'b', taskComplete: false, correct: false },
    { id: 'c', taskComplete: true, correct: true },
    { id: 'transfer', taskComplete: true, correct: true },
  ]
  const result = compareQuality(baseline, candidate, ['a', 'b', 'c'])
  assert.deepEqual(result.gains, ['a'])
  assert.deepEqual(result.regressions, ['b'])
  assert.equal(result.cases, 3)
  assert.equal(result.baseline, 2)
  assert.equal(result.candidate, 2)
  assert.equal(result.baselineStrict, 1)
  assert.equal(result.candidateStrict, 1)
  assert.throws(() => compareQuality([...baseline, baseline[0]], candidate, ['a']), /Repeated/)
  assert.throws(() => compareQuality(baseline, candidate, ['missing']), /Missing/)
})

await test('checks combined rolling windows and retains provider errors', () => {
  const records = Array.from({ length: 40 }, (_, i) => ({
    startedAt: i * 3500,
    method: 'POST',
    path: '/v1/chat/completions',
    status: i === 20 ? 429 : 200,
    failed: i === 10,
  }))
  const dispatches = records.map(({ startedAt, method, path }) => ({ startedAt, method, path }))
  const result = requestEvidence(records, dispatches)
  assert.equal(result.requests, 40)
  assert.equal(result.observedMaximumPerRollingMinute, 18)
  assert.equal(result.rateLimitResponses, 1)
  assert.equal(result.httpErrorResponses, 1)
  assert.equal(result.connectionErrorFlags, 1)
  assert.equal(result.missingHttpStatuses, 0)
  assert.throws(() => requestEvidence(records, dispatches.slice(1)), /ledger mismatch/)
  assert.throws(
    () =>
      requestEvidence(
        records,
        dispatches.map((r) => ({ ...r, path: '/wrong' })),
      ),
    /ledger mismatch/,
  )
  const burst = records.map((r, i) => ({ ...r, startedAt: i * 2000 }))
  assert.throws(() => requestEvidence(burst, burst), /budget exceeded/)
  const reverse = [...records].reverse()
  assert.throws(() => requestEvidence(reverse, reverse), /Non-monotonic/)
})
