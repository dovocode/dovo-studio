import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export function runBrowserCheck(command, args, { attempts, run = spawnSync }) {
  const results = []
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const started = performance.now()
    const result = run(command, args, { stdio: 'inherit', shell: process.platform === 'win32' })
    const exitCode = result.status ?? 1
    results.push({
      attempt,
      seconds: (performance.now() - started) / 1000,
      exitCode,
      ...(result.error ? { error: result.error.message } : {}),
      ...(result.signal ? { signal: result.signal } : {}),
    })
    if (exitCode === 0) break
    console.error(`Browser check failed on attempt ${attempt}: ${args.at(-1)} (exit ${exitCode})`)
  }
  return results
}

export function browserAttemptLimit(value = '2') {
  const attempts = Number(value)
  if (!Number.isSafeInteger(attempts) || attempts < 1)
    throw new Error('DOVO_BROWSER_ATTEMPTS must be a positive integer')
  return attempts
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2)
  if (!command) throw new Error('Usage: node scripts/retry-browser.mjs <command> [args...]')
  const results = runBrowserCheck(command, args, {
    attempts: browserAttemptLimit(process.env.DOVO_BROWSER_ATTEMPTS),
  })
  process.exitCode = results.at(-1).exitCode
}
