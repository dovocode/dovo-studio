/// <reference types="node" />
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { stopOwnedChild } from '../agents/execution/stop-owned-child.js'
import { runCli } from './container-cli.js'
import {
  sandboxCommand,
  sandboxEnvironment,
  spawnHarness,
  wrapLaunch,
  type SandboxSession,
} from './launcher.js'
import { fakeContainerCli } from './testing/fake-container-cli.js'

const temporary: string[] = []
afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true })
})
function temp(prefix: string) {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  temporary.push(directory)
  return directory
}

function session(overrides: Partial<SandboxSession> = {}): SandboxSession {
  return {
    taskId: 'task-1',
    cli: 'docker',
    container: 'dovo-sandbox-test',
    user: '1000:1000',
    stateDirectory: '/data/sandboxes/threads/abc',
    commands: new Map([
      ['codex', ['/opt/dovo/harness/codex']],
      ['/home/me/.dovo/acp/agent/1.0/agent', ['/mise/acp/agent/1.0-x86_64/agent']],
    ]),
    explicitEnv: new Set(['CODEX_HOME', 'EXPLICIT']),
    hostEnv: new Set(['OPENAI_API_KEY']),
    env: { CLAUDE_CONFIG_DIR: '/home/me/.claude' },
    mounts: ['/work/project', '/data/sandboxes/threads/abc'],
    lease: () => () => {},
    stopExec: async () => {},
    ...overrides,
  }
}

describe('sandbox environment', () => {
  const host = {
    PATH: '/usr/bin',
    HOME: '/home/me',
    SSH_AUTH_SOCK: '/run/ssh.sock',
    DOVO_OWNER_TOKEN: 'owner',
    ANTHROPIC_API_KEY: 'host-anthropic',
    OPENAI_API_KEY: 'host-openai',
    GH_TOKEN: 'host-gh',
    TERM: 'xterm-256color',
    LANG: 'en_US.UTF-8',
  }

  it('forwards configured and launch values, never inherited host secrets', () => {
    const env = sandboxEnvironment(
      {
        ...host,
        EXPLICIT: 'configured',
        CODEX_HOME: '/home/me/.codex-work',
        CLAUDE_CODE_ENTRYPOINT: 'sdk-ts',
        DOCKER_HOST: 'unix:///other.sock',
        LD_PRELOAD: '/tmp/x.so',
      },
      session(),
      host,
    )
    expect(env).toEqual({
      EXPLICIT: 'configured',
      CODEX_HOME: '/home/me/.codex-work',
      CLAUDE_CODE_ENTRYPOINT: 'sdk-ts',
      OPENAI_API_KEY: 'host-openai',
      TERM: 'xterm-256color',
      LANG: 'en_US.UTF-8',
      CLAUDE_CONFIG_DIR: '/home/me/.claude',
    })
  })

  it('adds the harness allowlist from the host even when the launch omits it', () => {
    expect(sandboxEnvironment({}, session(), host).OPENAI_API_KEY).toBe('host-openai')
    expect(sandboxEnvironment({}, session(), host).ANTHROPIC_API_KEY).toBeUndefined()
  })

  it('passes a GitHub token only when the harness settings configure it', () => {
    expect(sandboxEnvironment({ GH_TOKEN: 'set' }, session(), host).GH_TOKEN).toBeUndefined()
    expect(
      sandboxEnvironment({ GH_TOKEN: 'set' }, session({ explicitEnv: new Set(['GH_TOKEN']) }), host)
        .GH_TOKEN,
    ).toBe('set')
  })
})

describe('sandbox command mapping', () => {
  it('maps harness and registry commands and keeps bare names for the container PATH', () => {
    expect(sandboxCommand(session(), 'codex')).toEqual(['/opt/dovo/harness/codex'])
    expect(sandboxCommand(session(), '/opt/homebrew/bin/codex')).toEqual([
      '/opt/dovo/harness/codex',
    ])
    expect(sandboxCommand(session(), '/home/me/.dovo/acp/agent/1.0/agent')).toEqual([
      '/mise/acp/agent/1.0-x86_64/agent',
    ])
    expect(sandboxCommand(session(), 'npx')).toEqual(['npx'])
    expect(sandboxCommand(session(), '/bin/sh')).toEqual(['/bin/sh'])
    expect(sandboxCommand(session(), '/work/project/bin/agent')).toEqual([
      '/work/project/bin/agent',
    ])
  })

  it('rejects a host path that the container cannot see', () => {
    expect(() => sandboxCommand(session(), '/home/me/bin/other-agent')).toThrow(
      /outside the sandbox/,
    )
  })

  it('puts variable names, not values, on the CLI command line', () => {
    const wrapped = wrapLaunch(session(), {
      command: 'codex',
      args: ['app-server'],
      env: { EXPLICIT: 'secret-value', PATH: '/usr/bin' },
      cwd: '/work/project',
    })
    expect(wrapped.command).toBe('docker')
    expect(wrapped.args.slice(0, 6)).toEqual([
      'exec',
      '-i',
      '--user',
      '1000:1000',
      '--workdir',
      '/work/project',
    ])
    expect(wrapped.args).toContain('EXPLICIT')
    expect(wrapped.args.join(' ')).not.toContain('secret-value')
    expect(wrapped.args.slice(-3)).toEqual([
      'dovo-sandbox-test',
      '/opt/dovo/harness/codex',
      'app-server',
    ])
    expect(wrapped.env.EXPLICIT).toBe('secret-value')
    expect(wrapped.env.DOVO_EXEC_ID).toBe(wrapped.execId)
  })
})

describe('spawnHarness with a container CLI', () => {
  it('runs through the CLI with only forwarded variables', async () => {
    const fake = fakeContainerCli()
    temporary.push(fake.directory)
    const cwd = temp('dovo-sandbox-cwd-')
    const child = spawnHarness(
      session({ cli: fake.cli, commands: new Map(), mounts: [cwd] }),
      'sh',
      [
        '-c',
        'printf "%s|%s|%s|%s" "$PWD" "${EXPLICIT:-}" "${ANTHROPIC_API_KEY:-}" "${DOVO_EXEC_ID:+id}"',
      ],
      {
        cwd,
        env: { ...process.env, EXPLICIT: 'yes', ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
    await new Promise((resolve) => child.once('close', resolve))
    expect(output).toBe(`${cwd}|yes||id`)
    expect(readFileSync(fake.log, 'utf8')).toContain('"exec"')
  })

  it('Stop ends processes that left the launcher process group', async () => {
    if (process.platform !== 'linux') return
    const fake = fakeContainerCli()
    temporary.push(fake.directory)
    const cwd = temp('dovo-sandbox-cwd-')
    const pidFile = join(cwd, 'pid')
    const sandbox = session({
      cli: fake.cli,
      commands: new Map(),
      mounts: [cwd],
      stopExec: async (id) => {
        const result = await runCli(fake.cli, [
          'exec',
          '--user',
          '0:0',
          'dovo-sandbox-test',
          '/opt/dovo/bin/dovo-kill',
          id,
        ])
        if (result.code !== 0) throw new Error(result.stderr)
      },
    })
    const child = spawnHarness(
      sandbox,
      'sh',
      ['-c', `setsid sleep 300 & echo $! > ${pidFile}; echo started; wait`],
      { cwd, env: process.env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] },
    )
    await new Promise<void>((resolve) =>
      child.stdout.on('data', (chunk: Buffer) => {
        if (chunk.toString().includes('started')) resolve()
      }),
    )
    const pid = Number(readFileSync(pidFile, 'utf8'))
    expect(alive(pid)).toBe(true)
    await stopOwnedChild(child)
    await expect.poll(() => alive(pid), { timeout: 5000 }).toBe(false)
  }, 15000)
})

function alive(pid: number) {
  const stat = `/proc/${pid}/stat`
  if (!existsSync(stat)) return false
  try {
    // A killed process can stay a zombie until its new parent reaps it.
    return readFileSync(stat, 'utf8').split(') ')[1]?.[0] !== 'Z'
  } catch {
    return false
  }
}
