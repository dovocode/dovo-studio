/// <reference types="node" />
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import type { AgentDiscovery } from '@dovo/protocol'
import type { CliRunner } from './container-cli.js'
import { harnessProfiles } from './harnesses.js'
import { Sandboxes } from './sandboxes.js'

const temporary: string[] = []
afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true })
})
function temp(prefix: string) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  temporary.push(directory)
  return directory
}

/** Login files and transcripts. Nothing that a harness loads as settings, hooks, MCP servers,
 * plugins, extensions or skills may be shared writable. */
const shareable = new Set([
  'auth.json',
  '.credentials.json',
  'mcp-auth.json',
  'sessions',
  'archived_sessions',
  'projects',
])

describe('harness folders in a sandbox', () => {
  it('share only login files and transcripts writable', () => {
    for (const [provider, profile] of Object.entries(harnessProfiles))
      for (const home of profile.homes({}, '/home/me'))
        for (const item of home.shared)
          expect(shareable.has(item.name), `${provider}: ${item.name}`).toBe(true)
  })

  it('keeps each harness configuration file read-only', () => {
    const readOnly = (provider: keyof typeof harnessProfiles) =>
      harnessProfiles[provider].homes({}, '/home/me').flatMap((home) => home.readOnly)
    expect(readOnly('codex')).toEqual(expect.arrayContaining(['config.toml', 'hooks.json']))
    expect(readOnly('claude')).toEqual(expect.arrayContaining(['settings.json', 'plugins']))
    expect(readOnly('opencode')).toEqual(expect.arrayContaining(['opencode.json', 'plugins']))
    expect(readOnly('pi')).toEqual(expect.arrayContaining(['settings.json', 'extensions']))
    expect(readOnly('copilot')).toContain('mcp-config.json')
    expect(readOnly('hermes')).toEqual(expect.arrayContaining(['config.yaml', 'cron']))
  })

  it('copies Claude state once into the private folder and never follows a planted link', async () => {
    const calls: string[][] = []
    const runner: CliRunner = async (_command, args) => {
      calls.push([...args])
      return args[0] === 'container'
        ? { stdout: '', stderr: 'No such container', code: 1 }
        : { stdout: '', stderr: '', code: 0 }
    }
    const root = temp('dovo-homes-root-')
    const home = temp('dovo-homes-home-')
    const claudeDirectory = join(home, '.claude')
    const service = new Sandboxes({
      runtimeId: 'runtime-1',
      root,
      home,
      platform: 'linux',
      ids: { uid: 1000, gid: 1000 },
      taskTools: () => undefined,
      keepThread: () => true,
      runner,
      detect: async () => ({ cli: { kind: 'docker', command: 'docker', rootless: false } }),
      loadImage: async () => ({ files: [], hash: 'a'.repeat(64) }),
      agentToolsBundle: async () => Buffer.from(''),
      hostVersion: async () => undefined,
      resolveGitLayout: async () => undefined,
    })
    writeFileSync(join(home, '.claude.json'), '{"mcpServers":{}}')
    const claude: AgentDiscovery = { provider: 'claude', endpoint: '', model: '', env: {} }
    const cwd = temp('dovo-homes-cwd-')
    await service.ensure({ taskId: 'task-1', sandbox: { mode: 'mise' }, cwd, agent: claude })
    const create = calls.find((call) => call[0] === 'create')!
    const base = create.find((value) => value.endsWith(`:${claudeDirectory}`))!
    const own = base.slice(0, base.indexOf(':'))
    expect(own.startsWith(join(root, 'homes'))).toBe(true)
    expect(readFileSync(join(own, '.claude.json'), 'utf8')).toBe('{"mcpServers":{}}')
    // The container's later writes stay in its copy.
    writeFileSync(join(own, '.claude.json'), '{"changed":true}')
    await service.ensure({ taskId: 'task-1', sandbox: { mode: 'mise' }, cwd, agent: claude })
    expect(readFileSync(join(own, '.claude.json'), 'utf8')).toBe('{"changed":true}')
    expect(readFileSync(join(home, '.claude.json'), 'utf8')).toBe('{"mcpServers":{}}')
    // A link that the agent puts in place of the copy is never written through.
    rmSync(join(own, '.claude.json'))
    const victim = join(home, 'victim')
    symlinkSync(victim, join(own, '.claude.json'))
    await service.ensure({ taskId: 'task-1', sandbox: { mode: 'mise' }, cwd, agent: claude })
    expect(existsSync(victim)).toBe(false)
    // The host folder gets only the shared transcript folder.
    expect(readdirSync(claudeDirectory)).toEqual(['projects'])
    await service.remove('task-1')
    expect(existsSync(own)).toBe(false)
    await service.dispose()
  })
})
