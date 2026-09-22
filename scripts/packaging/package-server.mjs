import { stageWorkspace } from './stage-workspace.mjs'
import { mkdtemp, cp, mkdir, readFile, writeFile, chmod, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
const root = fileURLToPath(new URL('../../', import.meta.url))
if (!['darwin', 'linux'].includes(process.platform) || !['arm64', 'x64'].includes(process.arch))
  throw new Error('Server archives support macOS/Linux arm64 and x64.')
if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Package with Node 24.')
const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version
const stage = await mkdtemp(join(tmpdir(), 'dovo-server-package-'))
try {
  const source = join(stage, 'source'),
    archive = join(stage, 'archive')
  const server = join(archive, 'libexec/server')
  await stageWorkspace(root, source)
  await mkdir(join(archive, 'libexec'), { recursive: true })
  execFileSync(
    'pnpm',
    [
      '--config.allow-unused-patches=true',
      '--filter',
      '@dovo/api',
      'deploy',
      '--prod',
      '--legacy',
      server,
    ],
    { cwd: source, stdio: 'inherit' },
  )
  await cp(process.execPath, join(archive, 'libexec/node'))
  await chmod(join(archive, 'libexec/node'), 0o755)
  const runtimeRequire = createRequire(
    await realpath(join(server, 'node_modules/@dovo/runtime/package.json')),
  )
  if (process.platform === 'darwin') {
    const pty = dirname(runtimeRequire.resolve('node-pty/package.json'))
    await chmod(join(pty, `prebuilds/darwin-${process.arch}/spawn-helper`), 0o755)
  }
  await mkdir(join(archive, 'bin'))
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
  execFileSync(join(archive, 'bin/dovo-server'), ['--help'], { stdio: 'inherit' })
  execFileSync(
    join(archive, 'libexec/node'),
    [
      '--input-type=module',
      '--eval',
      "import {startRuntime} from '@dovo/runtime'; const r=await startRuntime({databasePath:':memory:',ownerToken:'archive-smoke-test-owner-token-at-least-32',port:0}); const t=r.services.terminals.create('check',process.cwd()); r.services.terminals.close(t.id); await r.close();",
    ],
    { cwd: server, stdio: 'inherit' },
  )
  const output = resolve(root, 'release')
  await mkdir(output, { recursive: true })
  const name = `Dovo-Server-${version}-${process.platform === 'darwin' ? 'macos' : 'linux'}-${process.arch}.tar.gz`
  execFileSync('tar', ['-czf', join(output, name), '-C', archive, '.'], { stdio: 'inherit' })
  console.log(join(output, name))
} finally {
  await rm(stage, { recursive: true, force: true })
}
