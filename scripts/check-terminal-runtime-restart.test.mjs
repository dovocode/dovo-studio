import { execFile } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const fixture = fileURLToPath(new URL('./check-terminal-runtime-restart.mjs', import.meta.url))

await test(
  'acknowledged terminal commands survive an immediate runtime exit',
  {
    skip: process.platform === 'win32',
  },
  async () => {
    await run(process.execPath, [fixture], { timeout: 120_000 })
  },
)
