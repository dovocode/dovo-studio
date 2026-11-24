import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { browserAttemptLimit, runBrowserCheck } from './retry-browser.mjs'
import { browserChecks, browserShards, unregisteredBrowserChecks } from './ci/browser-shards.mjs'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const suites = Object.keys(manifest.scripts)
  .filter((name) => /^test:.+:browser$/.test(name))
  .sort()
const missing = unregisteredBrowserChecks(
  fileURLToPath(new URL('../', import.meta.url)),
  manifest.scripts,
)
if (missing.length)
  throw new Error(`Browser suites are not registered in package.json: ${missing.join(', ')}`)
const [shardText = '0', countText = '1', mode] = process.argv.slice(2)
const shard = Number(shardText),
  count = Number(countText)
if (
  !Number.isInteger(shard) ||
  !Number.isInteger(count) ||
  count < 1 ||
  shard < 0 ||
  shard >= count ||
  (mode !== undefined && mode !== '--list')
)
  throw new Error('Usage: node scripts/run-browser-suites.mjs [shard] [count] [--list]')
const durations = JSON.parse(
  readFileSync(new URL('./ci/browser-durations.json', import.meta.url), 'utf8'),
).seconds
const selected = browserShards(suites, count, durations)[shard]
if (mode !== '--list') {
  const result = spawnSync(process.execPath, ['scripts/ci/workspace-task.mjs', 'build'], {
    stdio: 'inherit',
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
  console.log(
    `Shard ${shard + 1}/${count}: ${selected.suites.length} suites, estimated ${Math.round(selected.seconds)} seconds.`,
  )
}
const timings = []
const attempts = browserAttemptLimit(process.env.DOVO_BROWSER_ATTEMPTS)
const windows = process.platform === 'win32'
const shell = windows ? (process.env.ComSpec ?? 'cmd.exe') : 'sh'
const shellArgs = (command) => (windows ? ['/d', '/s', '/c', `"${command}"`] : ['-c', command])
const summary = process.env.GITHUB_STEP_SUMMARY
for (const suite of selected.suites) {
  console.log(suite)
  if (mode === '--list') continue
  const started = performance.now()
  const prepared = browserChecks(manifest.scripts[suite])
  if (!prepared) throw new Error(`Browser suite has no checks: ${suite}`)
  const commands = prepared.split(' && ')
  const checks = []
  for (const command of commands) {
    const results = runBrowserCheck('pnpm', ['exec', shell, ...shellArgs(command)], { attempts })
    const last = results.at(-1)
    const status = last.exitCode !== 0 ? 'failure' : results.length > 1 ? 'flaky' : 'success'
    checks.push({ command, status, attempts: results })
    const report = {
      name: suite,
      seconds: Math.round((performance.now() - started) / 100) / 10,
      status:
        last.exitCode !== 0
          ? 'failure'
          : checks.length === commands.length
            ? 'success'
            : 'incomplete',
      checks,
    }
    if (process.env.DOVO_BROWSER_TIMINGS)
      writeFileSync(
        process.env.DOVO_BROWSER_TIMINGS,
        JSON.stringify({ shard, count, suites: [...timings, report] }, null, 2) + '\n',
      )
    if (summary && status !== 'success')
      appendFileSync(
        summary,
        `- ${suite}: \`${command}\` (${status}, ${results.length} attempts)\n`,
      )
    if (last.exitCode !== 0) process.exit(last.exitCode)
  }
  const seconds = Math.round((performance.now() - started) / 100) / 10
  timings.push({ name: suite, seconds, status: 'success', checks })
  if (summary) appendFileSync(summary, `- ${suite}: ${seconds}s (success)\n`)
}
