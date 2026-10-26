// Build @dovo/runtime and dependencies first. Synthetic scan costs, not end-to-end UI latency.
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { openDatabase } from '../packages/runtime/dist/storage/database.js'
import { UsageHistory } from '../packages/runtime/dist/storage/usage-history.js'
const db = openDatabase(':memory:')
try {
  const history = new UsageHistory(db)
  const count = 20000
  const records = Array.from({ length: count }, (_, index) => ({
    taskId: `task-${index}`,
    title: `Thread ${index} ${'context '.repeat(100)}`,
    sessionId: `session-${Math.floor(index / 8)}`,
    origin: index % 3 ? 'dovo' : 'cli',
    turn: {
      id: String(index).padStart(8, '0'),
      assistantId: `a-${index}`,
      agentId: 'a',
      provider: 'codex',
      model: 'gpt-6.1-sol',
      status: 'completed',
      startedAt: '2026-10-01T00:00:00Z',
      tokens: 5000,
      tokenUsage: { input: 4000, output: 1000, cacheRead: 0, cacheWrite: 0 },
    },
  }))
  history.recordExternal(records)
  const since = '2026-09-01T00:00:00Z'
  const baseline = async () =>
    new Set(
      (await history.read(since))
        .filter((row) => row.origin !== 'cli' && row.sessionId)
        .map((row) => `${row.turn.provider}:${row.sessionId}`),
    )
  const projected = () => history.ownedSessions(since)
  assert.deepEqual(await projected(), await baseline())
  async function median(run) {
    await run()
    const samples = []
    for (let i = 0; i < 9; i++) {
      const start = performance.now()
      await run()
      samples.push(performance.now() - start)
    }
    return +samples.sort((a, b) => a - b)[4].toFixed(2)
  }
  const fullDecodeMs = await median(baseline),
    identityProjectionMs = await median(projected)
  console.log(
    JSON.stringify(
      {
        records: count,
        uniqueOwnedSessions: (await projected()).size,
        fullDecodeMs,
        identityProjectionMs,
        scanReductionPercent: +(100 * (1 - identityProjectionMs / fullDecodeMs)).toFixed(1),
        note: 'Both scans yield every 256 rows. Costs/Tokens skip limit probes; Limits skips history entirely.',
      },
      null,
      2,
    ),
  )
} finally {
  db.close()
}
