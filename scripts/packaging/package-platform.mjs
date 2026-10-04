import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { releaseVariant } from './release-variant.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code ?? signal}`)),
    )
  })
}
async function server() {
  await run(process.execPath, ['scripts/packaging/package-server.mjs'])
  if (process.platform !== 'win32') return
  const { version, nightly } = await releaseVariant(root)
  const directory = await mkdtemp(join(tmpdir(), 'dovo-server-smoke-'))
  try {
    const archive = join(
      root,
      'release',
      `Dovo-Server${nightly ? '-Nightly' : ''}-${version}-windows-${process.arch}.zip`,
    )
    await run('pwsh', [
      '-NoProfile',
      '-File',
      'scripts/packaging/windows-server-smoke.ps1',
      '-Archive',
      archive,
      '-Directory',
      directory,
    ])
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}
// Share one immutable runtime stage, but keep archive/smoke work parallel with desktop packaging.
const results = await Promise.allSettled([
  server(),
  run(process.execPath, ['scripts/packaging/package-desktop.mjs', ...process.argv.slice(2)]),
])
const errors = results
  .filter((result) => result.status === 'rejected')
  .map((result) => result.reason)
if (errors.length) throw new AggregateError(errors, 'Platform packaging failed')
