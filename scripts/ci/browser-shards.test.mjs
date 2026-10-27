import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { browserChecks, browserShards } from './browser-shards.mjs'
import { updateDurations } from './update-browser-durations.mjs'

await test('balances slow suites without losing or repeating registered checks', () => {
  const suites = ['a', 'b', 'c', 'd', 'e', 'f', 'new']
  const durations = { a: 120, b: 50, c: 40, d: 20, e: 10, f: 5, old: 15 }
  const shards = browserShards(suites, 3, durations)
  assert.deepEqual(
    shards.flatMap((shard) => shard.suites).sort((a, b) => a.localeCompare(b)),
    [...suites].sort((a, b) => a.localeCompare(b)),
  )
  assert.deepEqual(browserShards([...suites].reverse(), 3, durations), shards)
  assert.deepEqual(
    shards.map((shard) => shard.seconds),
    [120, 75, 70],
  )
  assert.throws(() => browserShards(suites, 0, durations), /positive/)
  assert.throws(() => browserShards(['a', 'a'], 2, durations), /Duplicate/)
  assert.deepEqual(browserShards(['new'], 1, {}), [{ suites: ['new'], seconds: 10 }])
})

await test('measured shard plan covers the complete current browser registry exactly once', () => {
  const { scripts } = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  )
  const durations = JSON.parse(
    readFileSync(new URL('./browser-durations.json', import.meta.url), 'utf8'),
  ).seconds
  const suites = Object.keys(scripts)
    .filter((name) => /^test:.+:browser$/.test(name))
    .sort((a, b) => a.localeCompare(b))
  const shards = browserShards(suites, 4, durations)
  assert.deepEqual(
    shards.flatMap((shard) => shard.suites).sort((a, b) => a.localeCompare(b)),
    suites,
  )
  const alphabetical = Array.from({ length: 4 }, (_, shard) =>
    suites
      .filter((_, i) => i % 4 === shard)
      .reduce((sum, name) => sum + (durations[name] ?? 10), 0),
  )
  assert.ok(Math.max(...shards.map((shard) => shard.seconds)) < Math.max(...alphabetical))
  for (const suite of suites) {
    const commands = scripts[suite].split(' && ')
    const checks = commands.filter((command) => /\bnode\s/.test(command))
    assert.ok(checks.length, `${suite} must still run checks`)
    const prepared = browserChecks(scripts[suite])
    for (const check of checks) assert.ok(prepared.includes(check), `${suite}: ${check}`)
  }
})

await test('prepared suites keep checks, generators and unfamiliar commands intact', () => {
  assert.equal(
    browserChecks(
      'pnpm --filter @dovo/runtime... --filter @dovo/connect-server... -r build && node scripts/check.mjs',
    ),
    'node scripts/check.mjs',
  )
  assert.equal(
    browserChecks(
      'pnpm --filter @dovo/desktop build && node scripts/build-mobile-terminal.mjs && node scripts/check.mjs',
    ),
    'node scripts/build-mobile-terminal.mjs && node scripts/check.mjs',
  )
  assert.equal(
    browserChecks('pnpm design:build && node scripts/check-design-system-browser.mjs'),
    'node scripts/check-design-system-browser.mjs',
  )
  assert.equal(
    browserChecks('pnpm test && node scripts/check.mjs'),
    'pnpm test && node scripts/check.mjs',
  )
})

await test('timing refresh uses successful measurements and preserves suites missing from a partial run', () => {
  const previous = { 'test:old:browser': 15, 'test:changed:browser': 5 }
  const report = (seconds, status = 'success') => ({
    suites: [{ name: 'test:changed:browser', seconds, status }],
  })
  assert.deepEqual(
    updateDurations(previous, [report(20), report(40), report(30), report(900, 'failure')]),
    { 'test:changed:browser': 30, 'test:old:browser': 15 },
  )
  assert.throws(() => updateDurations(previous, [report(-1)]), /Invalid/)
})
