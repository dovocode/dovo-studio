import { readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

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
  shard >= count
)
  throw new Error('Usage: node scripts/run-browser-suites.mjs [shard] [count] [--list]')
if (mode !== '--list') {
  for (const args of [
    ['--filter', '@dovo/api...', '-r', 'build'],
    ['--filter', '@dovo/web', 'build'],
    ['--filter', '@dovo/desktop', 'build'],
  ]) {
    const result = spawnSync('pnpm', args, { stdio: 'inherit' })
    if (result.status !== 0) process.exit(result.status ?? 1)
  }
}
for (const [index, suite] of suites.entries()) {
  if (index % count !== shard) continue
  console.log(suite)
  if (mode === '--list') continue
  const result = spawnSync(process.execPath, ['scripts/retry-browser.mjs', 'pnpm', suite], {
    stdio: 'inherit',
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
