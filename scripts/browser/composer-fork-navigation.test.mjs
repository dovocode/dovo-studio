import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

await test('a late composer fork keeps the new thread selected', () => {
  execFileSync(
    process.execPath,
    [
      fileURLToPath(new URL('../check-composer-send-browser.mjs', import.meta.url)),
      '--fork-navigation-only',
    ],
    { stdio: 'inherit', timeout: 60_000 },
  )
})
