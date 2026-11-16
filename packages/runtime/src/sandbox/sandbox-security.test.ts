/// <reference types="node" />
// Reproduces the container sandbox escapes from the security review with real Git. The tests
// import only modules and exports that existed before the fix, so `pnpm prove` can run them on
// the old code and show that they fail there.
import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { AgentDiscovery } from '@dovo/protocol'
import * as acpModule from '../agents/providers/acp/acp.js'
import { AgentRegistry } from '../agents/configuration/registry.js'
import { executeHook } from '../agents/execution/agent-hooks.js'
import type { AgentAdapter } from '../agents/execution/types.js'
import { readCodexThread } from '../agents/providers/codex/codex-thread.js'
import { GitService } from '../scm/git/git.js'
import type { CliRunner } from './container-cli.js'
import type { SandboxSession } from './launcher.js'
import { Sandboxes, type SandboxesOptions } from './sandboxes.js'
import { fakeContainerCli } from './testing/fake-container-cli.js'

const temporary: string[] = []
beforeEach(() => {
  vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null')
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true })
})
function temp(prefix: string) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  temporary.push(directory)
  return directory
}
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=Dovo', '-c', 'user.email=dovo@example.invalid', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
function repository() {
  const directory = temp('dovo-security-repo-')
  git(directory, 'init', '--quiet')
  git(directory, 'config', 'user.name', 'Dovo Test')
  git(directory, 'config', 'user.email', 'test@example.invalid')
  writeFileSync(join(directory, 'hello.txt'), 'original\n')
  git(directory, 'add', 'hello.txt')
  git(directory, 'commit', '--quiet', '-m', 'first')
  return directory
}
/** A script that records each run, like code an agent would plant. */
function planted() {
  const directory = temp('dovo-planted-')
  const marker = join(directory, 'ran')
  const script = join(directory, 'payload.sh')
  writeFileSync(script, `#!/bin/sh\necho "$0 $*" >> '${marker}'\ncat\n`)
  chmodSync(script, 0o755)
  return { script, ran: () => existsSync(marker) }
}

/** A container CLI with in-memory containers. */
function fakeRunner() {
  const calls: string[][] = []
  const containers = new Map<string, { labels: Record<string, string>; running: boolean }>()
  const runner: CliRunner = async (_command, args) => {
    const list = [...args]
    calls.push(list)
    const ok = (stdout = '') => ({ stdout, stderr: '', code: 0 })
    const missing = { stdout: '', stderr: 'Error: No such container', code: 1 }
    if (list[0] === 'container' && list[1] === 'inspect') {
      const item = containers.get(list.at(-1)!)
      if (!item) return missing
      return ok(
        `${item.labels['dev.dovo.sandbox.spec']}\t${item.running}\t${item.labels['dev.dovo.sandbox.mounts'] ?? ''}\n`,
      )
    }
    if (list[0] === 'create') {
      const labels: Record<string, string> = {}
      list.forEach((value, index) => {
        if (list[index - 1] !== '--label') return
        const [key, ...rest] = value.split('=')
        labels[key!] = rest.join('=')
      })
      containers.set(list[list.indexOf('--name') + 1]!, { labels, running: false })
      return ok()
    }
    if (list[0] === 'start' || list[0] === 'stop') {
      const item = containers.get(list.at(-1)!)
      if (!item) return missing
      item.running = list[0] === 'start'
      return ok()
    }
    if (list[0] === 'rm') return containers.delete(list.at(-1)!) ? ok() : missing
    return ok()
  }
  const creates = () => calls.filter((call) => call[0] === 'create')
  const volumes = (create = creates().at(-1)!) =>
    create.flatMap((value, index) => (create[index - 1] === '--volume' ? [value] : []))
  return { runner, calls, creates, volumes }
}

function sandboxes(overrides: Partial<SandboxesOptions> = {}) {
  const fake = fakeRunner()
  const root = temp('dovo-security-sandboxes-')
  const service = new Sandboxes({
    runtimeId: 'runtime-1',
    root,
    home: temp('dovo-security-home-'),
    platform: 'linux',
    ids: { uid: 1000, gid: 1000 },
    taskTools: () => undefined,
    keepThread: () => true,
    runner: fake.runner,
    detect: async () => ({ cli: { kind: 'docker', command: 'docker', rootless: false } }),
    loadImage: async () => ({ files: [], hash: 'a'.repeat(64) }),
    agentToolsBundle: async () => Buffer.from('// tools'),
    hostVersion: async () => '0.50.0',
    ...overrides,
  })
  return { service, fake, root }
}
const sandbox = { mode: 'mise' as const, network: 'none' as const }
/** Dovo's Git service wired to the sandboxes the way the runtime wires it. */
function gitFor(service: Sandboxes) {
  const git = new GitService()
  const wiring = git as unknown as {
    setSandboxedCheckouts?: (lookup: (path: string) => unknown) => void
  }
  const layouts = service as unknown as { gitLayout?: (path: string) => unknown }
  wiring.setSandboxedCheckouts?.((path) => layouts.gitLayout?.(path))
  return git
}

describe('container sandbox Git protection', () => {
  it('runs no nested repository code that the agent planted after a turn', async () => {
    const cwd = repository()
    const payload = planted()
    const { service } = sandboxes()
    await service.ensure({ taskId: 'task-1', sandbox, cwd })
    // Inside the sandbox: a gitlink in the index and a nested repository config.
    const nested = join(cwd, 'evil')
    mkdirSync(nested)
    git(nested, 'init', '--quiet')
    writeFileSync(join(nested, 'x'), 'x\n')
    git(nested, 'add', 'x')
    git(nested, 'commit', '--quiet', '-m', 'x')
    git(
      cwd,
      'update-index',
      '--add',
      '--cacheinfo',
      `160000,${git(nested, 'rev-parse', 'HEAD').trim()},evil`,
    )
    git(nested, 'config', 'core.fsmonitor', payload.script)
    git(nested, 'config', 'filter.x.clean', payload.script)
    writeFileSync(join(nested, '.gitattributes'), 'x filter=x\n')
    writeFileSync(join(nested, 'x'), 'y\n')
    writeFileSync(join(cwd, 'hello.txt'), 'edited\n')
    // On the host, after the turn: Dovo's checkpoint, Changes and status.
    const dovo = gitFor(service)
    await dovo.snapshot(cwd, 'refs/dovo/checkpoints/turn/after')
    await dovo.changes(cwd)
    await dovo.command(cwd, ['status', '--porcelain', '--untracked-files=all'])
    await dovo.command(cwd, ['diff', 'HEAD'])
    expect(payload.ran()).toBe(false)
    await service.dispose()
  })

  it('protects the main checkout that shares its Git folder with a sandboxed worktree', async () => {
    const main = repository()
    const library = repository()
    git(main, '-c', 'protocol.file.allow=always', 'submodule', 'add', '--quiet', library, 'library')
    git(main, 'commit', '--quiet', '-m', 'Add library')
    const payload = planted()
    const hook = planted()
    writeFileSync(join(main, '.git', 'hooks', 'pre-commit'), `#!/bin/sh\n${hook.script}\n`)
    chmodSync(join(main, '.git', 'hooks', 'pre-commit'), 0o755)
    const cwd = join(temp('dovo-security-worktrees-'), 'feature')
    git(main, 'worktree', 'add', '--quiet', '-b', 'feature', cwd)
    const { service } = sandboxes()
    await service.ensure({ taskId: 'task-1', sandbox, cwd })
    // Inside the sandbox the common Git folder is writable, including submodule config.
    const submodule = join(main, '.git', 'modules', 'library')
    git(submodule, 'config', 'core.fsmonitor', payload.script)
    writeFileSync(join(main, 'library', 'hello.txt'), 'edited\n')
    const dovo = gitFor(service)
    await dovo.command(main, ['status', '--porcelain'])
    await dovo.snapshot(main, 'refs/dovo/checkpoints/main/before')
    expect(payload.ran()).toBe(false)
    // The sandbox cannot write the main checkout's hooks, so a commit there still runs them.
    writeFileSync(join(main, 'hello.txt'), 'main edit\n')
    await dovo.stage(main, ['hello.txt'])
    await dovo.commit(main, 'Commit in the main checkout')
    expect(hook.ran()).toBe(true)
    expect(payload.ran()).toBe(false)
    // The planted config is real: Git without Dovo's protection runs it.
    git(main, 'status')
    expect(payload.ran()).toBe(true)
    await service.dispose()
  })

  it('refuses to continue a sandbox after the agent rewrites Git pointer files', async () => {
    const cwd = repository()
    const { service, fake } = sandboxes()
    await service.ensure({ taskId: 'task-1', sandbox, cwd })
    expect(fake.creates()).toHaveLength(1)
    // Point the checkout's .git at another repository on the host.
    const other = repository()
    writeFileSync(join(cwd, '.git', 'commondir'), `${join(other, '.git')}\n`)
    // A new linked checkout would recreate the container with new mounts.
    const linked = temp('dovo-security-linked-')
    const next = {
      taskId: 'task-1',
      sandbox,
      cwd,
      linked: [{ path: linked, access: 'edit' as const }],
    }
    await expect(service.ensure(next)).rejects.toThrow(/changed since its sandbox started/)
    expect(fake.creates()).toHaveLength(1)
    expect(service.status().threads[0]?.state).toBe('failed')
    // Restoring the Git folder makes the sandbox usable again.
    rmSync(join(cwd, '.git', 'commondir'))
    await service.ensure(next)
    expect(fake.creates()).toHaveLength(2)
    expect(fake.volumes().join('\n')).not.toContain(other)
    await service.dispose()
  })

  it('refuses a linked worktree whose .git file now points at another repository', async () => {
    const main = repository()
    const cwd = join(temp('dovo-security-worktrees-'), 'feature')
    git(main, 'worktree', 'add', '--quiet', '-b', 'feature', cwd)
    const { service, fake } = sandboxes()
    await service.ensure({ taskId: 'task-1', sandbox, cwd })
    const other = repository()
    git(other, 'worktree', 'add', '--quiet', '-b', 'other', join(temp('dovo-security-other-'), 'x'))
    writeFileSync(join(cwd, '.git'), `gitdir: ${join(other, '.git', 'worktrees', 'x')}\n`)
    await expect(
      service.ensure({
        taskId: 'task-1',
        sandbox,
        cwd,
        linked: [{ path: temp('l-'), access: 'edit' }],
      }),
    ).rejects.toThrow(/changed since its sandbox started/)
    expect(fake.creates()).toHaveLength(1)
    expect(fake.volumes().join('\n')).not.toContain(other)
    await service.dispose()
  })

  it('refuses a .git folder that was renamed and replaced by a link', async () => {
    const cwd = repository()
    const { service } = sandboxes()
    await service.ensure({ taskId: 'task-1', sandbox, cwd })
    renameSync(join(cwd, '.git'), join(cwd, 'moved'))
    symlinkSync(join(cwd, 'moved'), join(cwd, '.git'))
    await expect(service.ensure({ taskId: 'task-1', sandbox, cwd })).rejects.toThrow(
      /changed since its sandbox started/,
    )
    await service.dispose()
  })

  it('never mounts a planted Git folder whose hooks link to the home folder', async () => {
    const cwd = repository()
    const home = temp('dovo-security-victim-')
    // Before Dovo first sees it, the checkout already points .git/commondir at a planted folder.
    const fake = join(cwd, 'fake')
    execFileSync('git', ['init', '--quiet', '--bare', fake])
    rmSync(join(fake, 'hooks'), { recursive: true, force: true })
    symlinkSync(home, join(fake, 'hooks'))
    writeFileSync(join(cwd, '.git', 'commondir'), '../fake\n')
    const { service, fake: cli } = sandboxes()
    await expect(service.ensure({ taskId: 'task-1', sandbox, cwd })).rejects.toThrow(
      /cannot start a sandbox/,
    )
    expect(cli.creates()).toHaveLength(0)
    await service.dispose()
  })

  it('mounts .git on itself so that it cannot be renamed or replaced', async () => {
    const cwd = repository()
    const { service, fake } = sandboxes()
    await service.ensure({ taskId: 'task-1', sandbox, cwd })
    const volumes = fake.volumes()
    expect(volumes).toContain(`${cwd}/.git:${cwd}/.git`)
    expect(volumes.indexOf(`${cwd}/.git:${cwd}/.git`)).toBeGreaterThan(
      volumes.indexOf(`${cwd}:${cwd}`),
    )
    expect(volumes.indexOf(`${cwd}/.git/hooks:${cwd}/.git/hooks:ro`)).toBeGreaterThan(
      volumes.indexOf(`${cwd}/.git:${cwd}/.git`),
    )
    await service.dispose()
  })
})

describe('container sandbox harness folders', () => {
  it('shares only the Codex login and transcripts writable, and keeps config read-only', async () => {
    const cwd = repository()
    const codexHome = temp('dovo-security-codex-')
    writeFileSync(join(codexHome, 'config.toml'), 'model = "x"\n')
    writeFileSync(join(codexHome, 'hooks.json'), '{}\n')
    writeFileSync(join(codexHome, 'auth.json'), '{}\n')
    const codex: AgentDiscovery = {
      provider: 'codex',
      endpoint: 'codex',
      model: '',
      env: { CODEX_HOME: codexHome },
    }
    const { service, fake } = sandboxes()
    await service.ensure({ taskId: 'task-1', sandbox, cwd, agent: codex })
    const volumes = fake.volumes()
    expect(volumes).not.toContain(`${codexHome}:${codexHome}`)
    expect(volumes).toContain(`${codexHome}/config.toml:${codexHome}/config.toml:ro`)
    expect(volumes).toContain(`${codexHome}/hooks.json:${codexHome}/hooks.json:ro`)
    expect(volumes).toContain(`${codexHome}/auth.json:${codexHome}/auth.json`)
    expect(volumes).toContain(`${codexHome}/sessions:${codexHome}/sessions`)
    await service.dispose()
  })

  it('does not run a harness command from the checkout on the host to read its version', async () => {
    const cwd = repository()
    const hostVersion = vi.fn<NonNullable<SandboxesOptions['hostVersion']>>(async () => '1.0.0')
    const { service } = sandboxes({ hostVersion })
    const endpoint = join(cwd, 'bin', 'codex')
    mkdirSync(join(cwd, 'bin'))
    writeFileSync(endpoint, '#!/bin/sh\necho 1.0.0\n')
    chmodSync(endpoint, 0o755)
    await service.ensure({
      taskId: 'task-1',
      sandbox,
      cwd,
      agent: { provider: 'codex', endpoint, model: '', env: { CODEX_HOME: temp('c-') } },
    })
    expect(hostVersion).not.toHaveBeenCalled()
    await service.dispose()
  })
})

describe('host helpers for sandboxed threads', () => {
  const session = (cli: string, cwd: string): SandboxSession => ({
    taskId: 'task-1',
    cli,
    container: 'dovo-sandbox-test',
    user: '1000:1000',
    stateDirectory: cwd,
    commands: new Map(),
    explicitEnv: new Set(),
    hostEnv: new Set(),
    env: {},
    mounts: [cwd],
    lease: () => () => {},
    stopExec: async () => {},
  })

  it('runs a user agent hook inside the container with its event data', async () => {
    const fake = fakeContainerCli()
    temporary.push(fake.directory)
    const cwd = temp('dovo-security-hook-')
    const run = executeHook as (...args: unknown[]) => ReturnType<typeof executeHook>
    const result = await run(
      {
        name: 'check',
        enabled: true,
        event: 'after-turn',
        command: 'cat',
        timeoutSeconds: 10,
      },
      cwd,
      new AbortController().signal,
      { version: 1, event: 'after-turn', cwd, harness: 'codex' },
      undefined,
      session(fake.cli, cwd),
    )
    expect(result.ok).toBe(true)
    expect(result.output).toContain('"event":"after-turn"')
    const calls = readFileSync(fake.log, 'utf8')
    expect(calls).toContain('"exec"')
    expect(calls).toContain('"/bin/sh","-c","cat"')
  })

  it('reads a sandboxed Codex transcript through the container, not with host Codex', async () => {
    const fake = fakeContainerCli()
    temporary.push(fake.directory)
    const cwd = temp('dovo-security-codex-read-')
    const endpoint = join(cwd, 'codex')
    writeFileSync(endpoint, '#!/bin/sh\nexit 1\n')
    chmodSync(endpoint, 0o755)
    const read = readCodexThread as (...args: unknown[]) => ReturnType<typeof readCodexThread>
    await read(
      { provider: 'codex', endpoint, model: '', id: 'a', name: 'a' },
      'thread',
      cwd,
      session(fake.cli, cwd),
    ).catch(() => undefined)
    expect(existsSync(fake.log) && readFileSync(fake.log, 'utf8')).toContain('"exec"')
  })

  it('does not probe an ACP command that a sandbox can change', async () => {
    const cwd = repository()
    const { service } = sandboxes()
    await service.ensure({ taskId: 'task-1', sandbox, cwd })
    const command = join(cwd, 'agent')
    writeFileSync(command, '#!/bin/sh\n')
    chmodSync(command, 0o755)
    const probe = vi
      .fn<AgentAdapter['probe']>()
      .mockResolvedValue({ provider: 'acp', available: true, detail: '' })
    vi.spyOn(acpModule, 'createAcpAdapter').mockReturnValue({
      run: vi.fn<AgentAdapter['run']>(),
      probe,
    })
    const registry = new AgentRegistry()
    const guard = registry as unknown as {
      setHostCommandGuard?: (guard: (command: string) => Promise<boolean>) => void
    }
    const sandboxed = service as unknown as {
      hostCommandWritable?: (command: string) => Promise<boolean>
    }
    guard.setHostCommandGuard?.(
      (path) => sandboxed.hostCommandWritable?.(path) ?? Promise.resolve(false),
    )
    try {
      const adapter = await registry.get('acp')
      const status = await adapter.probe({
        provider: 'acp',
        endpoint: command,
        model: '',
        id: 'acp',
        name: 'ACP',
        instructions: '',
        permission: 'ask',
      })
      expect(probe).not.toHaveBeenCalled()
      expect(status.available).toBe(true)
    } finally {
      await registry.dispose()
      await service.dispose()
    }
  })
})
