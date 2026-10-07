// Runs a browser suite, retrying once, and records the flake so a rerun cannot hide a real
// regression: the summary names suites that only passed on retry.
import { spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'

const [command, ...args] = process.argv.slice(2)
if (!command) {
  console.error('Usage: node scripts/retry-browser.mjs <command> [args...]')
  process.exit(2)
}
const label = [command, ...args].join(' ')
const attempts = Number(process.env.DOVO_BROWSER_ATTEMPTS ?? 2)
const summary = process.env.GITHUB_STEP_SUMMARY
const note = (line) => {
  console.log(line)
  if (summary) appendFileSync(summary, `${line}\n`)
}
for (let attempt = 1; attempt <= attempts; attempt++) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.status === 0) {
    if (attempt > 1) note(`- ⚠️ Flaky: \`${label}\` passed on attempt ${attempt} of ${attempts}`)
    process.exit(0)
  }
  console.error(`${label} failed on attempt ${attempt} of ${attempts} (exit ${result.status})`)
}
note(`- ❌ Failed: \`${label}\` after ${attempts} attempts`)
process.exit(1)
