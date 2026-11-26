import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  const mobile = JSON.parse(
    readFileSync(new URL('../../apps/mobile/package.json', import.meta.url), 'utf8'),
  )
  const generatedByBuild = mobile.scripts['prepare:assets'].replaceAll('../../', '').split(' && ')
  assert.match(mobile.scripts.build, /(?:^| && )pnpm run prepare:assets(?:$| && )/)
  for (const suite of suites) {
    const commands = scripts[suite].split(' && ')
    const prepared = browserChecks(scripts[suite]).split(' && ')
    assert.ok(
      prepared.some((command) => /^node /.test(command)),
      `${suite} must still run checks`,
    )
    for (const command of commands.filter((command) => /^node /.test(command))) {
      if (!prepared.includes(command))
        assert.ok(generatedByBuild.includes(command), `${suite} lost ${command}`)
    }
  }
})

await test('prepared suites keep checks and skip only known workspace builds and generators', () => {
  assert.equal(
    browserChecks(
      'pnpm --filter @dovo/runtime... --filter @dovo/connect-server... -r build && node scripts/check.mjs',
    ),
    'node scripts/check.mjs',
  )
  assert.equal(
    browserChecks(
      'pnpm --filter @dovo/desktop build && node scripts/build-mobile-terminal.mjs && node scripts/build-image-editor.mjs --check && node scripts/check.mjs',
    ),
    'node scripts/build-image-editor.mjs --check && node scripts/check.mjs',
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

await test('detects package-local browser regressions missing from scheduled suites', async () => {
  const { unregisteredBrowserChecks } = await import('./browser-shards.mjs')
  const { fileURLToPath } = await import('node:url')
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const { scripts } = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  )
  assert.deepEqual(unregisteredBrowserChecks(root, scripts), [])
  delete scripts['test:file-drafts:browser']
  assert.deepEqual(unregisteredBrowserChecks(root, scripts), [
    'packages/extension-tasks/src/detail/task-files-drafts.browser.mjs',
  ])
})

await test(
  'browser runner retries failed checks and propagates a shard failure after one workspace build',
  { skip: process.platform === 'win32' },
  () => {
    const root = mkdtempSync(join(tmpdir(), 'dovo-browser-shard-'))
    try {
      for (const name of ['apps', 'packages', 'scripts/ci'])
        mkdirSync(join(root, name), { recursive: true })
      for (const name of [
        'run-browser-suites.mjs',
        'retry-browser.mjs',
        'ci/browser-shards.mjs',
        'ci/run-check.mjs',
      ])
        copyFileSync(new URL(`../${name}`, import.meta.url), join(root, 'scripts', name))
      writeFileSync(join(root, 'scripts/ci/browser-durations.json'), '{"seconds":{}}')
      writeFileSync(
        join(root, 'scripts/ci/workspace-task.mjs'),
        "import { appendFileSync } from 'node:fs'; appendFileSync('builds', 'build\\n')",
      )
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({
          scripts: {
            'test:fixture:browser': 'node first.mjs && node second.mjs && node third.mjs',
          },
        }),
      )
      writeFileSync(
        join(root, 'pnpm'),
        `#!/bin/sh
printf '%s\n' "$4" >> "$CALLS"
if [ "$4" = "node second.mjs" ]; then
  if [ "$FAIL_EVERY_TIME" = yes ] || [ ! -e "$CALLS.second" ]; then
    touch "$CALLS.second"
    exit 7
  fi
fi
`,
        { mode: 0o700 },
      )
      const calls = join(root, 'calls')
      const timings = join(root, 'timings.json')
      const run = (alwaysFail) => {
        writeFileSync(calls, '')
        const result = spawnSync(process.execPath, ['scripts/run-browser-suites.mjs', '0', '1'], {
          cwd: root,
          encoding: 'utf8',
          env: {
            PATH: `${root}:${process.env.PATH}`,
            DOVO_BROWSER_TIMINGS: timings,
            DOVO_BROWSER_ATTEMPTS: '2',
            CALLS: calls,
            FAIL_EVERY_TIME: alwaysFail ? 'yes' : 'no',
          },
        })
        return {
          result,
          invocations: readFileSync(calls, 'utf8').trim().split('\n'),
          suite: JSON.parse(readFileSync(timings, 'utf8')).suites[0],
        }
      }
      const flaky = run(false)
      assert.equal(flaky.result.status, 0, flaky.result.stderr)
      assert.deepEqual(flaky.invocations, [
        'node first.mjs',
        'node second.mjs',
        'node second.mjs',
        'node third.mjs',
      ])
      assert.equal(flaky.suite.status, 'success')
      assert.deepEqual(
        flaky.suite.checks.map(({ status, attempts }) => [
          status,
          attempts.map(({ exitCode }) => exitCode),
        ]),
        [
          ['success', [0]],
          ['flaky', [7, 0]],
          ['success', [0]],
        ],
      )
      const failed = run(true)
      assert.equal(failed.result.status, 7)
      assert.deepEqual(failed.invocations, ['node first.mjs', 'node second.mjs', 'node second.mjs'])
      assert.equal(failed.suite.status, 'failure')
      assert.equal(failed.suite.checks[1].status, 'failure')

      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({
          scripts: {
            'test:alpha:browser': 'node first.mjs',
            'test:beta:browser': 'node second.mjs && node third.mjs',
          },
        }),
      )
      writeFileSync(calls, '')
      writeFileSync(join(root, 'builds'), '')
      const runParallel = (prepared) =>
        spawnSync(
          process.execPath,
          ['scripts/run-browser-suites.mjs', '--jobs', '2', ...(prepared ? ['--prepared'] : [])],
          {
            cwd: root,
            encoding: 'utf8',
            env: {
              PATH: `${root}:${process.env.PATH}`,
              DOVO_BROWSER_TIMINGS: timings,
              DOVO_BROWSER_ATTEMPTS: '1',
              CALLS: calls,
              FAIL_EVERY_TIME: prepared ? 'no' : 'yes',
            },
          },
        )
      const parallel = runParallel(false)
      assert.equal(parallel.status, 7, parallel.stderr)
      assert.equal(readFileSync(join(root, 'builds'), 'utf8'), 'build\n')
      assert.deepEqual(readFileSync(calls, 'utf8').trim().split('\n').sort(), [
        'node first.mjs',
        'node second.mjs',
      ])
      for (const [shard, name, status] of [
        [0, 'test:alpha:browser', 'success'],
        [1, 'test:beta:browser', 'failure'],
      ]) {
        const report = JSON.parse(readFileSync(join(root, `timings-${shard}.json`), 'utf8'))
        assert.equal(report.shard, shard)
        assert.equal(report.count, 2)
        assert.deepEqual(
          report.suites.map((suite) => [suite.name, suite.status]),
          [[name, status]],
        )
      }

      writeFileSync(calls, '')
      const reused = runParallel(true)
      assert.equal(reused.status, 0, reused.stderr)
      assert.equal(readFileSync(join(root, 'builds'), 'utf8'), 'build\n')
      assert.deepEqual(readFileSync(calls, 'utf8').trim().split('\n').sort(), [
        'node first.mjs',
        'node second.mjs',
        'node third.mjs',
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  },
)
