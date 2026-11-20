import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const fixture = fileURLToPath(new URL('./check-workspace-modes-browser.mjs', import.meta.url))
const buildDependencies = () => {
  if (
    [
      'client-runtime/dist/index.js',
      'design/dist/index.js',
      'protocol/dist/secure-input.js',
      'web-ui/dist/button.js',
    ].every((path) => existsSync(new URL(`../packages/${path}`, import.meta.url)))
  )
    return
  const build = spawnSync('pnpm', ['--filter', '@dovo/extension-tasks...', '-r', 'build'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    encoding: 'utf8',
  })
  if (build.error) throw build.error
  assert.equal(build.status, 0, build.stdout + build.stderr)
}
buildDependencies()

for (const [scenario, description] of [
  ['terminal', 'Home retains terminal requests across mode switches'],
  ['capacity', 'Home retains the address after the browser rejects it at capacity'],
  ['external', 'Unified selects the tab created for a desktop external link'],
]) {
  await test(description, () => {
    const result = spawnSync(process.execPath, [fixture, scenario], { encoding: 'utf8' })
    if (result.error) throw result.error
    assert.equal(result.status, 0, result.stdout + result.stderr)
  })
}
