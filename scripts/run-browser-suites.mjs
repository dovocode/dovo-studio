import { appendFileSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { browserChecks, browserShards } from './ci/browser-shards.mjs'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const suites = Object.keys(manifest.scripts)
  .filter((name) => /^test:.+:browser$/.test(name))
  .sort()
const referenced = Object.values(manifest.scripts).join('\n')
for (const file of readdirSync(new URL('./', import.meta.url))) {
  if (/^check-.*-browser\.mjs$/.test(file) && !referenced.includes(file))
    throw new Error(`Browser suite is not registered in package.json: ${file}`)
}
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
for (const suite of selected.suites) {
  console.log(suite)
  if (mode === '--list') continue
  const started = performance.now()
  const command = browserChecks(manifest.scripts[suite])
  if (!command) throw new Error(`Browser suite has no checks: ${suite}`)
  const shell = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'sh'
  const shellArgs = process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-c', command]
  const result = spawnSync(
    process.execPath,
    ['scripts/retry-browser.mjs', 'pnpm', 'exec', shell, ...shellArgs],
    {
      stdio: 'inherit',
    },
  )
  timings.push({
    name: suite,
    seconds: Math.round((performance.now() - started) / 100) / 10,
    status: result.status === 0 ? 'success' : 'failure',
  })
  if (process.env.DOVO_BROWSER_TIMINGS)
    writeFileSync(
      process.env.DOVO_BROWSER_TIMINGS,
      JSON.stringify({ shard, count, suites: timings }, null, 2) + '\n',
    )
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `- ${suite}: ${timings.at(-1).seconds}s (${timings.at(-1).status})\n`,
    )
  if (result.status !== 0) process.exit(result.status ?? 1)
}
