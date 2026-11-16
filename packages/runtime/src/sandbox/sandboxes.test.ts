/// <reference types="node" />
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { decode, mcpServerSchema, type AgentDiscovery } from '@dovo/protocol'
import type { CliRunner } from './container-cli.js'
import { resolveGitLayout } from './git-mounts.js'
import { Sandboxes, type SandboxesOptions } from './sandboxes.js'

const temporary: string[] = []
afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true })
})
function temp(prefix: string) {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  temporary.push(directory)
  return directory
}

type Call = { args: string[]; input?: string }
/** A container CLI with in-memory images and containers. */
function fakeRunner(options: { failInstall?: (spec: string) => boolean } = {}) {
  const calls: Call[] = []
  const images = new Set<string>()
  const containers = new Map<string, { labels: Record<string, string>; running: boolean }>()
  const runner: CliRunner = async (_command, args, run = {}) => {
    const list = [...args]
    calls.push({ args: list, ...(run.input !== undefined ? { input: run.input } : {}) })
    const ok = (stdout = '') => ({ stdout, stderr: '', code: 0 })
    const missing = { stdout: '', stderr: 'Error: No such container', code: 1 }
    if (list[0] === 'image' && list[1] === 'inspect')
      return images.has(list.at(-1)!) ? ok('sha256:1') : { stdout: '', stderr: 'none', code: 1 }
    if (list[0] === 'build') {
      run.onLine?.('#5 [2/6] RUN apt-get update')
      images.add(list[list.indexOf('--tag') + 1]!)
      return ok()
    }
    if (list[0] === 'run') {
      const spec = list.at(-1)!
      return options.failInstall?.(spec) ? { stdout: '', stderr: 'no such version', code: 1 } : ok()
    }
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
    if (list[0] === 'ps')
      return ok(
        [...containers]
          .map(
            ([name, item]) =>
              `${name}\t${item.labels['dev.dovo.sandbox.thread']}\t${item.running ? 'running' : 'exited'}`,
          )
          .join('\n'),
      )
    return ok()
  }
  return { runner, calls, images, containers }
}

const codex: AgentDiscovery = {
  provider: 'codex',
  endpoint: 'codex',
  model: '',
  env: { CODEX_HOME: temp('dovo-codex-') },
}

function sandboxes(overrides: Partial<SandboxesOptions> = {}, fake = fakeRunner()) {
  const root = temp('dovo-sandboxes-')
  const home = temp('dovo-sandbox-home-')
  const service = new Sandboxes({
    runtimeId: 'runtime-1',
    root,
    home,
    platform: 'linux',
    ids: { uid: 1000, gid: 1000 },
    taskTools: () => ({ host: '127.0.0.1', port: 5235 }),
    keepThread: () => true,
    runner: fake.runner,
    detect: async () => ({ cli: { kind: 'docker', command: 'docker', rootless: false } }),
    loadImage: async () => ({ files: [], hash: 'a'.repeat(64) }),
    agentToolsBundle: async () => Buffer.from('// tools'),
    hostVersion: async () => '0.50.0',
    resolveGitLayout: async () => undefined,
    ...overrides,
  })
  return { service, fake, root, home }
}
const request = (cwd: string, agent: AgentDiscovery | undefined = codex) => ({
  taskId: 'task-1',
  sandbox: { mode: 'mise' as const, network: 'none' as const, cpus: 2, memoryMb: 4096 },
  cwd,
  agent: agent && { ...agent, env: { ...agent.env } },
})
const commands = (calls: Call[], name: string) => calls.filter((call) => call.args[0] === name)
/** Harness and agent installs, after the Node LTS install that every sandbox gets. */
const installs = (calls: Call[]) =>
  commands(calls, 'run').filter((call) => call.args.at(-1) !== 'node@lts')

describe('Sandboxes', () => {
  it.each(['hermes', 'vibe'] as const)(
    'installs %s with an isolated Python 3.13',
    async (provider) => {
      const { service, fake } = sandboxes()
      try {
        await service.ensure(
          request(temp('dovo-checkout-'), { provider, endpoint: provider, model: '', env: {} }),
        )
        const install = installs(fake.calls)[0]!.args
        expect(install[install.indexOf('-c') + 1]).toContain(
          'UV_PYTHON_INSTALL_DIR=/mise/python UV_PYTHON=3.13 mise exec uv@latest --',
        )
      } finally {
        await service.dispose()
      }
    },
  )

  it('finds launched processes as the harness user without requiring ptrace capability', async () => {
    const { service, fake } = sandboxes()
    const session = await service.ensure(request(temp('dovo-checkout-')))
    try {
      await session.stopExec('launch-id')
      expect(fake.calls.at(-1)?.args).toEqual([
        'exec',
        '--user',
        '1000:1000',
        session.container,
        '/opt/dovo/bin/dovo-kill',
        'launch-id',
      ])
    } finally {
      await service.dispose()
    }
  })

  it('builds, installs the host harness version, creates and prepares one container', async () => {
    const { service, fake, root } = sandboxes()
    const cwd = temp('dovo-checkout-')
    const progress: string[] = []
    const codexHome = temp('dovo-codex-home-')
    const session = await service.ensure({
      ...request(cwd, { ...codex, env: { CODEX_HOME: codexHome } }),
      progress: (text) => progress.push(text),
    })
    expect(commands(fake.calls, 'build')).toHaveLength(1)
    expect(progress.some((text) => text.includes('[2/6] RUN apt-get update'))).toBe(true)
    expect(commands(fake.calls, 'run')[0]!.args.at(-1)).toBe('node@lts')
    const install = installs(fake.calls)[0]!.args
    expect(install).toContain('dovo-sandbox-mise:/mise')
    expect(install.at(-1)).toBe('npm:@openai/codex@0.50.0')
    const create = commands(fake.calls, 'create')[0]!.args
    expect(create).toEqual(expect.arrayContaining(['--network', 'none', '--memory', '4096m']))
    expect(create).toEqual(expect.arrayContaining(['--cpus', '2']))
    expect(create).toContain(`${cwd}:${cwd}`)
    // The harness folder is private to the thread. Only login and transcripts are shared.
    const home = create.find((value) => value.endsWith(`:${codexHome}`))!
    expect(home.startsWith(join(root, 'homes'))).toBe(true)
    expect(create).toContain(`${codexHome}/sessions:${codexHome}/sessions`)
    expect(create).not.toContain(`${codexHome}:${codexHome}`)
    expect(create).toContain(`${session.stateDirectory}:${session.stateDirectory}`)
    expect(create.join(' ')).not.toContain('/.ssh')
    expect(create).toContain('dev.dovo.sandbox.thread=task-1')
    const exec = commands(fake.calls, 'exec')
    expect(exec[0]!.input).toBe('// tools')
    expect(exec.some((call) => call.args.includes('/opt/dovo/bin/dovo-link-tool'))).toBe(true)
    expect(exec.some((call) => call.args.includes('/opt/dovo/bin/dovo-prepare-project'))).toBe(true)
    expect(session.commands.get('codex')).toEqual(['/opt/dovo/harness/codex'])
    const grok = await service.ensure({
      ...request(cwd, { provider: 'grok', endpoint: '', model: '', env: {} }),
      taskId: 'task-grok',
    })
    expect(grok.commands.get('grok')).toEqual(['grok'])
    expect(session.explicitEnv.has('CODEX_HOME')).toBe(true)
    expect(session.hostEnv.has('OPENAI_API_KEY')).toBe(true)
    expect(session.stateDirectory.startsWith(root)).toBe(true)
    expect(service.status().threads).toEqual([
      { taskId: 'task-1', state: 'running' },
      { taskId: 'task-grok', state: 'running' },
    ])
    await service.dispose()
  })

  it('reuses a running container without rebuilding or preparing again', async () => {
    const { service, fake } = sandboxes()
    const cwd = temp('dovo-checkout-')
    await service.ensure(request(cwd))
    const before = fake.calls.length
    await service.ensure(request(cwd))
    const later = fake.calls.slice(before).map((call) => call.args[0])
    expect(later).toEqual(['container'])
    await service.dispose()
  })

  it('reuses a container whose mounts cover a terminal request and recreates for new mounts', async () => {
    const { service, fake } = sandboxes()
    const cwd = temp('dovo-checkout-')
    const linked = temp('dovo-linked-')
    await service.ensure({ ...request(cwd), linked: [{ path: linked, access: 'read-only' }] })
    await service.ensure(request(cwd))
    expect(commands(fake.calls, 'create')).toHaveLength(1)
    const other = temp('dovo-linked-')
    await service.ensure({ ...request(cwd), linked: [{ path: other, access: 'edit' }] })
    expect(commands(fake.calls, 'rm')).toHaveLength(1)
    expect(commands(fake.calls, 'create')).toHaveLength(2)
    await service.dispose()
  })

  it('stops an idle container after its last lease and prepares it again on reuse', async () => {
    const { service, fake } = sandboxes({ idleStopMs: 20 })
    const cwd = temp('dovo-checkout-')
    const session = await service.ensure(request(cwd))
    const first = session.lease()
    const second = session.lease()
    first()
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(commands(fake.calls, 'stop')).toHaveLength(0)
    second()
    await expect.poll(() => commands(fake.calls, 'stop').length).toBe(1)
    expect(service.status().threads[0]?.state).toBe('stopped')
    expect(service.current('task-1')).toBeUndefined()
    const setups = commands(fake.calls, 'exec').length
    await service.ensure(request(cwd))
    expect(commands(fake.calls, 'start').length).toBe(2)
    expect(commands(fake.calls, 'exec').length).toBeGreaterThan(setups)
    await service.dispose()
  })

  it('removes the container and state directory with the thread', async () => {
    const { service, fake } = sandboxes()
    const cwd = temp('dovo-checkout-')
    const session = await service.ensure(request(cwd))
    expect(existsSync(session.stateDirectory)).toBe(true)
    await service.remove('task-1')
    expect(fake.containers.size).toBe(0)
    expect(existsSync(session.stateDirectory)).toBe(false)
    expect(service.status().threads).toEqual([])
    await service.dispose()
  })

  it('removes orphaned containers and stops the rest on startup', async () => {
    const fake = fakeRunner()
    const cwd = temp('dovo-checkout-')
    const first = sandboxes({}, fake)
    await first.service.ensure(request(cwd))
    await first.service.ensure({ ...request(cwd), taskId: 'task-2' })
    await first.service.dispose()
    const restarted = sandboxes({ root: first.root, keepThread: (id) => id === 'task-2' }, fake)
    await restarted.service.reconcile()
    expect(
      [...fake.containers.values()].map((item) => item.labels['dev.dovo.sandbox.thread']),
    ).toEqual(['task-2'])
    expect([...fake.containers.values()][0]!.running).toBe(false)
    expect(
      fake.calls.some(
        (call) =>
          call.args[0] === 'ps' && call.args.includes('label=dev.dovo.sandbox.runtime=runtime-1'),
      ),
    ).toBe(true)
  })

  it('installs the latest harness when the host version is not published', async () => {
    const fake = fakeRunner({ failInstall: (spec) => spec.endsWith('@0.50.0') })
    const { service } = sandboxes({}, fake)
    const cwd = temp('dovo-checkout-')
    await service.ensure(request(cwd))
    expect(installs(fake.calls).map((call) => call.args.at(-1))).toEqual([
      'npm:@openai/codex@0.50.0',
      'npm:@openai/codex@latest',
    ])
    await service.dispose()
  })

  it('reports a missing container CLI and an unsupported harness clearly', async () => {
    const cwd = temp('dovo-checkout-')
    const missing = sandboxes({ detect: async () => ({ message: 'Install Docker or Podman.' }) })
    await expect(missing.service.ensure(request(cwd))).rejects.toThrow(/Install Docker or Podman/)
    expect(missing.service.status()).toMatchObject({
      available: false,
      message: 'Install Docker or Podman.',
    })
    expect(missing.service.status().threads[0]?.state).toBe('failed')
    const { service } = sandboxes()
    await expect(
      service.ensure(request(cwd, { provider: 'cursor', endpoint: '', model: '' })),
    ).rejects.toThrow(/outside the sandbox/)
  })

  it('installs an ACP Registry agent from its pinned Linux archive', async () => {
    const { service, fake } = sandboxes({
      arch: 'x64',
      acpDistribution: async () => ({
        hostCommand: '/data/acp/agent/1.2.0/agent',
        registryId: 'agent',
        version: '1.2.0',
        distribution: {
          kind: 'binary',
          value: {
            archive: 'https://example.com/agent.tar.gz',
            sha256: 'f'.repeat(64),
            cmd: './agent',
          },
        },
      }),
    })
    const cwd = temp('dovo-checkout-')
    const session = await service.ensure({
      ...request(cwd, { provider: 'acp', endpoint: '', model: '', acpInstallationId: 'agent' }),
      acpLaunch: { command: '/data/acp/agent/1.2.0/agent', args: [], env: {} },
    })
    expect(installs(fake.calls)[0]!.args.slice(-5)).toEqual([
      '/opt/dovo/bin/dovo-fetch',
      'https://example.com/agent.tar.gz',
      'f'.repeat(64),
      '/mise/acp/agent/1.2.0-x86_64',
      './agent',
    ])
    expect(session.commands.get('/data/acp/agent/1.2.0/agent')).toEqual([
      '/mise/acp/agent/1.2.0-x86_64/agent',
    ])
    await service.dispose()
  })

  it('points the Dovo tools server at the thread socket on Linux and the host gateway elsewhere', () => {
    const server = decode(mcpServerSchema, {
      name: 'dovo_task',
      enabled: true,
      transport: 'stdio',
      command: process.execPath,
      args: ['/dovo/server.js'],
      env: {},
      envValues: {
        ELECTRON_RUN_AS_NODE: '1',
        DOVO_TASK_URL: 'http://127.0.0.1:5235',
        DOVO_TASK_CREDENTIAL_FILE: '/state/run-credential.json',
      },
    })
    const linux = sandboxes().service.toolServer('task-1', server)
    expect(linux.command).toBe('/opt/dovo/lib/dovo-task-tools')
    expect(linux.envValues?.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(linux.envValues?.DOVO_TASK_SOCKET).toMatch(/dovo\.sock$/)
    const mac = sandboxes({ platform: 'darwin' }).service.toolServer('task-1', server)
    expect(mac.envValues?.DOVO_TASK_URL).toBe('http://host.docker.internal:5235')
    expect(mac.envValues?.DOVO_TASK_SOCKET).toBeUndefined()
  })

  describe('Git hooks and config', () => {
    const git = (cwd: string, ...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=Dovo', '-c', 'user.email=dovo@example.com', ...args], {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
      })
    /** A repository with one commit, at its real path: Git reports real paths. */
    const repository = () => {
      const directory = realpathSync(temp('dovo-repo-'))
      git(directory, 'init', '--quiet')
      git(directory, 'commit', '--quiet', '--allow-empty', '-m', 'first')
      return directory
    }
    /** `--volume` values in order, from the container create call. */
    const volumes = async (
      cwd: string,
      linked?: Array<{ path: string; access: 'read-only' | 'edit' }>,
    ) => {
      const { service, fake } = sandboxes({ resolveGitLayout })
      await service.ensure({ ...request(cwd), ...(linked ? { linked } : {}) })
      await service.dispose()
      const create = commands(fake.calls, 'create')[0]!.args
      return create.flatMap((value, index) => (create[index - 1] === '--volume' ? [value] : []))
    }

    it('mounts the hooks directory and config read-only after the writable checkout', async () => {
      const repo = repository()
      // The checkout path that Dovo uses goes through a symbolic link.
      const cwd = join(temp('dovo-link-'), 'checkout')
      symlinkSync(repo, cwd)
      const edited = repository()
      const viewed = repository()
      const mounts = await volumes(cwd, [
        { path: edited, access: 'edit' },
        { path: viewed, access: 'read-only' },
      ])
      expect(mounts).toContain(`${cwd}:${cwd}`)
      const readOnly = (path: string) => `${path}:${path}:ro`
      expect(mounts.filter((mount) => mount.endsWith(':ro')).sort()).toEqual(
        [
          viewed,
          `${cwd}/.git/hooks`,
          `${cwd}/.git/config`,
          // Other worktrees' Git folders: the agent cannot plant files for them.
          `${cwd}/.git/worktrees`,
          `${edited}/.git/hooks`,
          `${edited}/.git/config`,
          `${edited}/.git/worktrees`,
        ]
          .map(readOnly)
          .sort(),
      )
      // The .git folder is mounted on itself, so the agent cannot rename or replace it. It
      // comes after the checkout and before the read-only files inside it.
      const own = mounts.indexOf(`${cwd}/.git:${cwd}/.git`)
      expect(own).toBeGreaterThan(mounts.indexOf(`${cwd}:${cwd}`))
      expect(mounts.indexOf(`${cwd}/.git/hooks:${cwd}/.git/hooks:ro`)).toBeGreaterThan(own)
      expect(mounts).toContain(`${edited}/.git:${edited}/.git`)
    })

    it('protects the common hooks and config, and config.worktree, for a linked worktree', async () => {
      const repo = repository()
      git(repo, 'config', 'extensions.worktreeConfig', 'true')
      const cwd = join(realpathSync(temp('dovo-worktrees-')), 'feature')
      git(repo, 'worktree', 'add', '--quiet', '-b', 'feature', cwd)
      const common = join(repo, '.git')
      const worktreeConfig = join(common, 'worktrees', 'feature', 'config.worktree')
      expect(existsSync(worktreeConfig)).toBe(false)
      const mounts = await volumes(cwd)
      const writable = [`${cwd}:${cwd}`, `${common}:${common}`]
      const gitDir = join(common, 'worktrees', 'feature')
      const readOnly = [
        // The pointers that tell Git where its folders are cannot change.
        `${cwd}/.git`,
        `${gitDir}/commondir`,
        `${gitDir}/gitdir`,
        `${common}/hooks`,
        `${common}/config`,
        // Other worktrees' Git folders, and the main checkout's config.worktree.
        `${common}/worktrees`,
        `${common}/config.worktree`,
        worktreeConfig,
      ].map((path) => `${path}:${path}:ro`)
      expect(mounts.slice(0, 2)).toEqual(writable)
      expect(mounts.filter((mount) => mount.endsWith(':ro')).sort()).toEqual([...readOnly].sort())
      // The thread's own Git folder is writable on top of the read-only worktrees folder, and
      // mounted on itself so that it cannot be renamed or replaced.
      const own = mounts.indexOf(`${gitDir}:${gitDir}`)
      expect(own).toBeGreaterThan(mounts.indexOf(`${common}/worktrees:${common}/worktrees:ro`))
      expect(mounts.indexOf(`${gitDir}/commondir:${gitDir}/commondir:ro`)).toBeGreaterThan(own)
      expect(Math.min(...readOnly.map((mount) => mounts.indexOf(mount)))).toBeGreaterThan(1)
      // Created empty so the bind mount has a source, and Git still reads the same config.
      expect(readFileSync(worktreeConfig, 'utf8')).toBe('')
      expect(git(cwd, 'config', '--get', 'extensions.worktreeConfig').trim()).toBe('true')
    })

    it('creates a missing hooks directory before it mounts it', async () => {
      const cwd = repository()
      rmSync(join(cwd, '.git', 'hooks'), { recursive: true, force: true })
      const mounts = await volumes(cwd)
      expect(mounts).toContain(`${cwd}/.git/hooks:${cwd}/.git/hooks:ro`)
      expect(readdirSync(join(cwd, '.git', 'hooks'))).toEqual([])
    })

    it('keeps recorded layouts across restarts, shares them between threads and prunes deleted threads', async () => {
      const cwd = repository()
      const fake = fakeRunner()
      const first = sandboxes({ resolveGitLayout }, fake)
      await first.service.ensure(request(cwd))
      await first.service.dispose()
      const layout = {
        worktree: cwd,
        gitDir: join(cwd, '.git'),
        commonDir: join(cwd, '.git'),
      }
      // Each thread keeps the layout recorded before any agent code ran in the checkout.
      const resolve = vi.fn<typeof resolveGitLayout>(resolveGitLayout)
      const restarted = sandboxes({ root: first.root, resolveGitLayout: resolve }, fake)
      expect(await restarted.service.gitLayout(join(cwd, 'src'))).toEqual(layout)
      expect(await restarted.service.gitLayout(`${cwd}-other`)).toBeUndefined()
      await restarted.service.ensure({ ...request(cwd), taskId: 'task-2' })
      expect(resolve).not.toHaveBeenCalled()
      // Archive keeps the record; only a thread that no longer exists loses it.
      await restarted.service.remove('task-1')
      expect(await restarted.service.gitLayout(cwd)).toEqual(layout)
      const pruned = sandboxes(
        { root: first.root, threadExists: () => false, keepThread: () => false },
        fake,
      )
      await pruned.service.reconcile()
      expect(await pruned.service.gitLayout(cwd)).toBeUndefined()
    })

    it('adds no Git mounts outside a repository', async () => {
      const cwd = realpathSync(temp('dovo-plain-'))
      const mounts = await volumes(cwd)
      expect(mounts.some((mount) => mount.includes('.git'))).toBe(false)
    })
  })
})
