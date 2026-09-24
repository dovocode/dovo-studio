import { runtimeSmoke } from './runtime-smoke.mjs'
import { deploy } from './deploy.mjs'
import { stageWorkspace } from './stage-workspace.mjs'
import { mkdtemp, cp, mkdir, readFile, writeFile, chmod, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
const root = fileURLToPath(new URL('../../', import.meta.url))
if (
  !['darwin', 'linux', 'win32'].includes(process.platform) ||
  !['arm64', 'x64'].includes(process.arch)
)
  throw new Error('Server archives support macOS/Linux/Windows arm64 and x64.')
if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Package with Node 24.')
const windows = process.platform === 'win32'
const nodeName = windows ? 'node.exe' : 'node'
const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version
const stage = await mkdtemp(join(tmpdir(), 'dovo-server-package-'))
try {
  const source = join(stage, 'source'),
    archive = join(stage, 'archive')
  const server = join(archive, 'libexec/server')
  await stageWorkspace(root, source)
  await mkdir(join(archive, 'libexec'), { recursive: true })
  deploy(
    [
      '--config.allow-unused-patches=true',
      '--config.node-linker=hoisted',
      '--config.shared-workspace-lockfile=false',
      '--filter',
      '@dovo/api',
      'deploy',
      '--prod',
      '--legacy',
      windows ? join(stage, 'deployed') : server,
    ],
    source,
  )
  // Materialize pnpm junctions before archiving; ZIPs must not reference the build machine.
  if (windows) await cp(join(stage, 'deployed'), server, { recursive: true, dereference: true })
  await cp(process.execPath, join(archive, 'libexec', nodeName))
  await chmod(join(archive, 'libexec', nodeName), 0o755)
  const runtimeRequire = createRequire(
    await realpath(join(server, 'node_modules/@dovo/runtime/package.json')),
  )
  if (process.platform === 'darwin') {
    const pty = dirname(runtimeRequire.resolve('node-pty/package.json'))
    await chmod(join(pty, `prebuilds/darwin-${process.arch}/spawn-helper`), 0o755)
  }
  await mkdir(join(archive, 'bin'))
  if (windows)
    await writeFile(
      join(archive, 'bin/dovo-server.cmd'),
      '@echo off\r\nsetlocal\r\nset DOVO_SERVER_DISTRIBUTION=archive\r\n"%~dp0..\\libexec\\node.exe" "%~dp0..\\libexec\\server\\dist\\server-cli.js" %*\r\nexit /b %errorlevel%\r\n',
    )
  else
    await writeFile(
      join(archive, 'bin/dovo-server'),
      `#!/bin/sh
set -eu
entry="$0"
while [ -L "$entry" ]; do
  parent=$(CDPATH= cd -- "$(dirname -- "$entry")" && pwd)
  entry=$(readlink "$entry")
  case "$entry" in /*) ;; *) entry="$parent/$entry" ;; esac
done
base=$(CDPATH= cd -- "$(dirname -- "$entry")/.." && pwd)
export DOVO_SERVER_DISTRIBUTION=archive
exec "$base/libexec/node" "$base/libexec/server/dist/server-cli.js" "$@"
`,
      { mode: 0o755 },
    )
  await writeFile(join(archive, 'VERSION'), `${version}\n`)
  execFileSync(join(archive, 'libexec', nodeName), [join(server, 'dist/server-cli.js'), '--help'], {
    stdio: 'inherit',
  })
  execFileSync(
    join(archive, 'libexec', nodeName),
    ['--input-type=module', '--eval', runtimeSmoke],
    { cwd: server, stdio: 'inherit' },
  )
  const output = resolve(root, 'release')
  await mkdir(output, { recursive: true })
  const name = `Dovo-Server-${version}-${windows ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux'}-${process.arch}.${windows ? 'zip' : 'tar.gz'}`
  execFileSync('tar', [windows ? '-acf' : '-czf', join(output, name), '-C', archive, '.'], {
    stdio: 'inherit',
  })
  console.log(join(output, name))
} finally {
  // Windows may briefly retain file handles after the PTY child exits.
  await rm(stage, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
