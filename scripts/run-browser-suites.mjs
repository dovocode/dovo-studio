import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { browserAttemptLimit, runBrowserCheck } from './retry-browser.mjs'
import { browserChecks, browserShards, unregisteredBrowserChecks } from './ci/browser-shards.mjs'
import { runCheck } from './ci/run-check.mjs'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    jobs: { type: 'string' },
    list: { type: 'boolean' },
    prepared: { type: 'boolean' },
  },
})
const defaultJobs = Math.max(1, Math.min(4, Math.floor(availableParallelism() / 4)))
const [shardText = '0', countText = '1'] = positionals
const shard = Number(shardText)
const runAll = positionals.length === 0 && !values.list
const count = Number(runAll ? (values.jobs ?? defaultJobs) : countText)
if (
  positionals.length > 2 ||
  (values.jobs !== undefined && !runAll) ||
  !Number.isSafeInteger(shard) ||
  !Number.isSafeInteger(count) ||
  count < 1 ||
  (runAll && count > 4) ||
  shard < 0 ||
  shard >= count
)
  throw new Error(
    'Usage: node scripts/run-browser-suites.mjs [--jobs 1–4 | [shard] [count] [--list]] [--prepared]',
  )
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
const timingsPath = process.env.DOVO_BROWSER_TIMINGS
if (!values.list && !values.prepared) {
  const code = await runCheck(process.execPath, ['scripts/ci/workspace-task.mjs', 'build'])
  if (code !== 0) process.exit(code)
}
if (runAll && count > 1) {
  const extension = timingsPath ? extname(timingsPath) : ''
  const results = await Promise.all(
    Array.from({ length: count }, (_, index) => {
      const args = [process.argv[1], String(index), String(count), '--prepared']
      const env = timingsPath
        ? {
            ...process.env,
            DOVO_BROWSER_TIMINGS: `${timingsPath.slice(0, timingsPath.length - extension.length)}-${index}${extension}`,
          }
        : process.env
      return runCheck(process.execPath, args, env)
    }),
  )
  process.exit(results.find((code) => code !== 0) ?? 0)
}
const durations = JSON.parse(
  readFileSync(new URL('./ci/browser-durations.json', import.meta.url), 'utf8'),
).seconds
const selected = browserShards(suites, count, durations)[shard]
if (!values.list) {
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
  console.log(values.list || count === 1 ? suite : `Shard ${shard + 1}/${count}: ${suite}`)
  if (values.list) continue
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
    if (timingsPath)
      writeFileSync(
        timingsPath,
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
