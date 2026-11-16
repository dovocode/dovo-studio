// Real Docker smoke check. Build the runtime first. Uses a temporary checkout and harness home,
// no provider login or paid turn. Installed tools remain in the normal shared mise volume.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { Sandboxes } from '../packages/runtime/dist/sandbox/sandboxes.js'
import { sandboxLaunch } from '../packages/runtime/dist/sandbox/launcher.js'

const exec = promisify(execFile)
const cli = process.env.DOVO_SANDBOX_TEST_CLI || 'docker'
const info = await exec(cli, ['info'])
const rootless = /^\s*rootless\s*$/m.test(info.stdout)
const root = await mkdtemp(join(tmpdir(), 'dovo-container-check-'))
const cwd = join(root, 'checkout')
const home = join(root, 'home')
const codexHome = join(home, '.codex')
await mkdir(cwd)
await mkdir(codexHome, { recursive: true })
await exec('git', ['init', '-q', cwd])
await writeFile(join(cwd, 'README.md'), 'Sandbox smoke check\n')
await writeFile(join(codexHome, 'config.toml'), '# Host configuration\n')
const config = await readFile(join(cwd, '.git/config'), 'utf8')
const server = createServer((_request, response) => response.end('sandbox-socket-ok'))
await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
})
const address = server.address()
assert(address && typeof address === 'object')
const taskId = randomUUID()
const options = {
  runtimeId: `smoke-${taskId}`,
  root: join(root, 'state'),
  home,
  taskTools: () => ({ host: '127.0.0.1', port: address.port }),
  keepThread: () => true,
  detect: async () => ({ cli: { kind: 'docker', command: cli, rootless } }),
  // Do not execute a real host harness or load the user's credentials.
  hostVersion: async () => undefined,
}
let service = new Sandboxes(options)
const request = {
  taskId,
  cwd,
  sandbox: { mode: 'mise', network: 'none', memoryMb: 2048, cpus: 2 },
  agent: { provider: 'codex', endpoint: 'codex', model: '', env: { CODEX_HOME: codexHome } },
  progress: (text) => console.log(text),
}
async function run(session, command, args = []) {
  // Keep even allowlisted provider keys out of this check.
  const launch = sandboxLaunch(
    { ...session, hostEnv: new Set() },
    { command, args, cwd, env: request.agent.env },
  )
  try {
    return await exec(launch.command, launch.args, {
      env: launch.env,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    })
  } finally {
    await launch.release()
  }
}

try {
  let session = await service.ensure(request)
  const version = await run(session, 'codex', ['--version'])
  assert.match(version.stdout, /codex/i)
  assert.equal(
    (await run(session, 'id', ['-u'])).stdout.trim(),
    String(rootless ? 0 : process.getuid()),
  )
  await run(session, 'sh', ['-c', 'printf sandbox > written.txt'])
  assert.equal(await readFile(join(cwd, 'written.txt'), 'utf8'), 'sandbox')
  assert.equal((await stat(join(cwd, 'written.txt'))).uid, process.getuid())
  await run(session, 'git', [
    '-c',
    'user.name=Smoke',
    '-c',
    'user.email=smoke@example.test',
    'add',
    '.',
  ])
  await run(session, 'git', [
    '-c',
    'user.name=Smoke',
    '-c',
    'user.email=smoke@example.test',
    'commit',
    '-qm',
    'Smoke check',
  ])
  await assert.rejects(run(session, 'sh', ['-c', 'echo changed >> .git/config']))
  await assert.rejects(run(session, 'sh', ['-c', 'echo changed > .git/hooks/post-commit']))
  await assert.rejects(run(session, 'mv', ['.git', '.git.old']))
  assert.equal(await readFile(join(cwd, '.git/config'), 'utf8'), config)
  await assert.rejects(run(session, 'sh', ['-c', 'echo changed >> "$CODEX_HOME/config.toml"']))
  await run(session, 'sh', ['-c', 'echo private > "$CODEX_HOME/private.txt"'])
  await assert.rejects(readFile(join(codexHome, 'private.txt')), { code: 'ENOENT' })
  assert.equal(await readFile(join(codexHome, 'config.toml'), 'utf8'), '# Host configuration\n')
  await assert.rejects(
    run(session, 'curl', ['--noproxy', '*', '--connect-timeout', '2', 'http://1.1.1.1']),
  )
  if (process.platform === 'linux') {
    const response = await run(session, 'curl', [
      '--silent',
      '--show-error',
      '--unix-socket',
      join(session.stateDirectory, 'dovo.sock'),
      'http://localhost/',
    ])
    assert.equal(response.stdout, 'sandbox-socket-ok')
  }
  const launch = sandboxLaunch(
    { ...session, hostEnv: new Set() },
    {
      command: 'sh',
      args: ['-c', 'setsid sleep 300 & echo $! > child.pid; wait'],
      cwd,
      env: {},
    },
  )
  const running = exec(launch.command, launch.args, { env: launch.env, timeout: 15_000 }).catch(
    () => undefined,
  )
  try {
    let pid
    for (let attempt = 0; attempt < 100; attempt++) {
      pid = await readFile(join(cwd, 'child.pid'), 'utf8').catch(() => '')
      if (pid.trim()) break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    assert.match(pid, /^\d+\s*$/)
    await launch.release()
    // A terminated child can remain as a zombie until PID 1 reaps it. kill -0 alone cannot
    // distinguish that dead process from a running descendant.
    const stopped = await run(session, 'sh', [
      '-c',
      'ps -o stat= -p "$1" || test "$?" = 1',
      'sh',
      pid.trim(),
    ])
    assert.match(stopped.stdout.trim(), /^(Z.*)?$/)
  } finally {
    await launch.release()
    await running
  }
  // Runtime restart preserves the checkout and private harness home. Reconcile stops the old
  // container before ensure starts it again.
  await service.dispose()
  service = new Sandboxes(options)
  await service.reconcile()
  session = await service.ensure(request)
  assert.equal((await run(session, 'cat', ['written.txt'])).stdout, 'sandbox')
  assert.equal(
    (await run(session, 'sh', ['-c', 'cat "$CODEX_HOME/private.txt"'])).stdout,
    'private\n',
  )
  for (const [provider, command, flag] of [
    ['hermes', 'hermes', '--version'],
    ['vibe', 'vibe-app-server', '--help'],
  ]) {
    session = await service.ensure({
      ...request,
      agent: { provider, endpoint: command, model: '', env: {} },
    })
    const result = await run(session, command, [flag])
    assert.match(result.stdout, new RegExp(provider, 'i'))
  }
  await service.remove(taskId)
  await assert.rejects(exec(cli, ['container', 'inspect', session.container]))
  console.log(
    'Real Docker sandbox: Codex, Hermes and Vibe startup, UID, Git mounts, private config, network off, socket, Stop, restart and removal pass. No live provider turn was run.',
  )
} finally {
  try {
    await service.remove(taskId)
  } finally {
    await service.dispose()
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  }
}
