import { afterEach, expect, it, vi } from 'vite-plus/test'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import {
  decode,
  defaultTaskHarness,
  harnessPluginCatalogSchema,
  harnessPluginPreviewSchema,
  harnessPluginStateSchema,
  SCRATCH_PROJECT_ID,
} from '@dovo/protocol'
import { startRuntime } from '../../index.js'
import { fixture } from '../../testing/fixture.js'
import { runtimeIntegration } from '../../testing/integration.js'
import { taskToolsServer } from '../../agent-tools/config.js'
import { codexAppServerPlugins, HarnessPlugins, type CodexPluginHost } from './harness-plugins.js'
import { first, pluginRepository as repository, second } from '../../testing/plugin-marketplace.js'

vi.setConfig(runtimeIntegration)
const cleanups: Array<() => unknown> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.unstubAllEnvs()
})
const human = 'paired-plugin-client-token-with-at-least-32-chars'
function recordingCodex(): CodexPluginHost & { calls: unknown[][] } {
  const calls: unknown[][] = []
  return {
    calls,
    install: async (...args) => void calls.push(['install', ...args]),
    setEnabled: async (...args) => void calls.push(['setEnabled', ...args]),
    remove: async (...args) => void calls.push(['remove', ...args]),
  }
}

async function setup(codex: CodexPluginHost = recordingCodex()) {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({
    databasePath: join(f.directory, 'state.sqlite'),
    ownerToken: 'plugin-owner-token-with-at-least-32-characters',
    port: 0,
  })
  cleanups.push(runtime.close)
  runtime.services.devices.add('Paired computer', human)
  const repo = repository()
  const root = join(f.directory, 'harness-plugins')
  runtime.services.harnessPlugins = new HarnessPlugins(
    runtime.services.db,
    root,
    codex,
    repo.fetcher,
  )
  const request = (path: string, command: unknown, headers: Record<string, string> = {}) =>
    fetch(`http://127.0.0.1:${runtime.port}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${human}`, 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(command),
    })
  const post = (command: unknown, headers?: Record<string, string>) =>
    request('/api/agents/plugins', command, headers)
  const command = async (body: unknown) => {
    const response = await post(body)
    const value: unknown = await response.json()
    if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(value)}`)
    return value
  }
  return { runtime, repo, root, post, request, command, f }
}

it('adds a GitHub marketplace, reviews entries as data and installs a Claude plugin bound to the reviewed revision', async () => {
  const codex = recordingCodex()
  const t = await setup(codex)
  const added = decode(
    harnessPluginStateSchema,
    await t.command({ action: 'add-marketplace', repository: 'https://github.com/team/tools' }),
  )
  expect(added.marketplaces).toEqual([
    expect.objectContaining({ repository: 'team/tools', revision: first, name: 'Team tools' }),
  ])
  const marketplaceId = added.marketplaces[0].id
  // Adding the same repository again keeps one marketplace.
  await t.command({ action: 'add-marketplace', repository: 'team/tools' })
  expect(
    decode(harnessPluginStateSchema, await t.command({ action: 'list' })).marketplaces,
  ).toHaveLength(1)

  const catalog = decode(
    harnessPluginCatalogSchema,
    await t.command({ action: 'catalog', marketplaceId }),
  )
  expect(catalog.formats).toEqual(['claude', 'codex'])
  expect(catalog.plugins).toEqual([
    { name: 'escape', unsupported: 'The plugin folder is outside the repository' },
    {
      name: 'formatter',
      description: 'Formats code',
      path: 'plugins/formatter',
    },
    { name: 'linked', path: 'plugins/linked' },
    { name: 'notes', path: 'plugins/notes' },
    {
      name: 'remote',
      unsupported: 'The github source type is not supported. Use a folder.',
    },
  ])

  const preview = decode(
    harnessPluginPreviewSchema,
    await t.command({ action: 'preview', marketplaceId, plugin: 'formatter' }),
  )
  expect(preview).toMatchObject({
    revision: first,
    plugin: { name: 'formatter', version: '1.2.0' },
    components: {
      skills: ['tidy'],
      commands: ['format'],
      agents: [],
      hooks: true,
      mcpServers: ['lint'],
    },
    files: 5,
  })
  // Listing and review read manifests only. No plugin code is downloaded or run.
  expect(t.repo.requests.filter((url) => url.endsWith('commands/format.md'))).toEqual([])
  expect(existsSync(t.root)).toBe(false)
  expect(codex.calls).toEqual([])

  const symlinked = await t.post({ action: 'preview', marketplaceId, plugin: 'linked' })
  expect(symlinked.status).toBe(422)
  expect(await symlinked.text()).toContain('without symlinks')

  // The repository moves on after the review; the install still uses the reviewed files.
  t.repo.advance()
  const installed = decode(
    harnessPluginStateSchema,
    await t.command({
      action: 'install',
      marketplaceId,
      plugin: 'formatter',
      revision: first,
      harness: 'claude',
      enabled: true,
    }),
  )
  expect(installed.plugins).toEqual([
    expect.objectContaining({
      id: `formatter@${marketplaceId}:claude`,
      revision: first,
      harness: 'claude',
      enabled: true,
    }),
  ])
  const paths = t.runtime.services.harnessPlugins.claudePluginPaths({})
  expect(paths).toHaveLength(1)
  expect(readFileSync(join(paths[0], 'commands', 'format.md'), 'utf8')).toBe('# Format the file')
  expect(codex.calls).toEqual([])

  // Repeating the install is a no-op.
  const before = JSON.stringify(installed)
  expect(
    JSON.stringify(
      await t.command({
        action: 'install',
        marketplaceId,
        plugin: 'formatter',
        revision: first,
        harness: 'claude',
        enabled: true,
      }),
    ),
  ).toBe(before)

  // After a refresh, an install from the earlier review is refused.
  const refreshed = decode(
    harnessPluginStateSchema,
    await t.command({ action: 'refresh-marketplace', marketplaceId }),
  )
  expect(refreshed.marketplaces[0].revision).toBe(second)
  const stale = await t.post({
    action: 'install',
    marketplaceId,
    plugin: 'formatter',
    revision: first,
    harness: 'claude',
    enabled: true,
  })
  expect(stale.status).toBe(409)
  expect(await stale.text()).toContain('Review the plugin again')

  // Disable and enable are reversible and apply to new Claude launches.
  await t.command({
    action: 'set-enabled',
    id: `formatter@${marketplaceId}:claude`,
    enabled: false,
  })
  expect(t.runtime.services.harnessPlugins.claudePluginPaths({})).toEqual([])
  await t.command({ action: 'set-enabled', id: `formatter@${marketplaceId}:claude`, enabled: true })
  expect(t.runtime.services.harnessPlugins.claudePluginPaths({})).toEqual(paths)

  // A marketplace with installed plugins cannot be removed until they are removed.
  expect((await t.post({ action: 'remove-marketplace', marketplaceId })).status).toBe(409)
  await t.command({ action: 'remove', id: `formatter@${marketplaceId}:claude` })
  expect(existsSync(paths[0])).toBe(false)
  expect(
    decode(
      harnessPluginStateSchema,
      await t.command({ action: 'remove-marketplace', marketplaceId }),
    ),
  ).toEqual({ marketplaces: [], plugins: [] })
})

it('installs Codex plugins through the Codex plugin API and keeps agents out', async () => {
  const codex = recordingCodex()
  const t = await setup(codex)
  const { marketplaces } = decode(
    harnessPluginStateSchema,
    await t.command({ action: 'add-marketplace', repository: 'team/tools' }),
  )
  const marketplaceId = marketplaces[0].id
  const agent = await t.post(
    {
      action: 'install',
      marketplaceId,
      plugin: 'notes',
      revision: first,
      harness: 'codex',
      enabled: true,
    },
    { 'x-dovo-agent-access': '1' },
  )
  expect(agent.status).toBe(403)
  expect(codex.calls).toEqual([])

  await t.command({
    action: 'install',
    marketplaceId,
    plugin: 'notes',
    revision: first,
    harness: 'codex',
    enabled: true,
  })
  const [install] = codex.calls
  expect(install?.[0]).toBe('install')
  const snapshot = String(install?.[1])
  expect(install?.[2]).toBe('notes')
  const name = snapshot.split(/[\\/]/).at(-1)
  expect(
    JSON.parse(readFileSync(join(snapshot, '.agents', 'plugins', 'marketplace.json'), 'utf8')),
  ).toEqual({ name, plugins: [{ name: 'notes', source: { source: 'local', path: './plugin' } }] })
  expect(readdirSync(join(snapshot, 'plugin', 'skills'))).toEqual(['notes'])
  // Codex plugins never reach Claude launches.
  expect(t.runtime.services.harnessPlugins.claudePluginPaths({})).toEqual([])

  const id = `notes@${marketplaceId}:codex`
  await t.command({ action: 'set-enabled', id, enabled: false })
  await t.command({ action: 'remove', id })
  expect(codex.calls.slice(1)).toEqual([
    ['setEnabled', `notes@${name}`, false],
    ['remove', `notes@${name}`, name],
  ])
  expect(existsSync(snapshot)).toBe(false)
  // Removing an already removed plugin is a no-op.
  await t.command({ action: 'remove', id })
  expect(codex.calls).toHaveLength(3)
})

it('matches Lean’s Bot plugin install policy through the real approval and marketplace endpoints', async () => {
  const t = await setup()
  const s = t.runtime.services
  const now = new Date().toISOString()
  const taskId = randomUUID()
  const runId = randomUUID()
  s.store.update(() => ({
    ...t.f.workspace,
    tasks: [
      {
        id: taskId,
        repositoryId: SCRATCH_PROJECT_ID,
        title: 'Plugin helper',
        agentId: '',
        harness: defaultTaskHarness('claude'),
        execution: 'main',
        status: 'running',
        activeRunId: runId,
        createdAt: now,
        messages: [],
        files: [],
        draft: '',
        example: false,
        bot: {
          role: 'Plugin helper',
          responsibilities: 'Find plugins.',
          state: 'active',
          revision: randomUUID(),
          createdAt: now,
          updatedAt: now,
        },
      },
    ],
  }))
  const controller = new AbortController()
  cleanups.push(() => controller.abort())
  const issue = (readOnly: boolean) =>
    s.runCredentials.issue(
      {
        taskId,
        runId,
        permissions: { provider: 'claude', permission: 'workspace-write' },
        readOnly,
        artifacts: false,
        pipelineWatching: false,
        pullRequestWatching: false,
        deviceHub: false,
        memoryScopes: [],
      },
      controller.signal,
    )
  const token = issue(false)
  const config = taskToolsServer(taskId, t.runtime.port, token, '127.0.0.1', false, false, runId)
  const client = new Client({ name: 'bot-plugin-fixture', version: '1' })
  cleanups.push(() => client.close())
  await client.connect(
    new StdioClientTransport({ command: config.command, args: config.args, env: config.envValues }),
  )
  const tool = (plugins?: object) =>
    client.callTool({
      name: 'studio_extensions',
      arguments: { action: 'plugins', ...(plugins ? { plugins } : {}) },
    })
  const added = decode(
    harnessPluginStateSchema,
    await t.command({ action: 'add-marketplace', repository: 'team/tools' }),
  )
  const marketplaceId = added.marketplaces[0].id
  expect((await tool()).isError).not.toBe(true)
  expect(JSON.stringify(await tool({ action: 'list' }))).toContain(marketplaceId)
  expect(JSON.stringify(await tool({ action: 'catalog', marketplaceId }))).toContain('formatter')
  const install = {
    action: 'install',
    marketplaceId,
    plugin: 'formatter',
    revision: first,
    harness: 'claude',
    enabled: false,
  }
  expect(JSON.stringify(await tool({ ...install, action: 'preview' }))).toContain(first)
  const cases = readFileSync(
    new URL('../../../../../verification/bot-workflows-cases.jsonl', import.meta.url),
    'utf8',
  )
    .trim()
    .split('\n')
    .map(
      (line) =>
        JSON.parse(line) as {
          kind: string
          input: {
            writable: boolean
            activeBefore: boolean
            activeAtInstall: boolean
            activate: boolean
            reviewedRevisionMatches: boolean
            approved: boolean
            currentRevisionMatches: boolean
          }
          needsApproval: boolean
          installed: boolean
        },
    )
    .filter((entry) => entry.kind === 'plugin')
  expect(cases).toHaveLength(8)
  const pause = (paused: boolean) =>
    s.store.updateTask(taskId, (task) => ({
      ...task,
      bot: { ...task.bot!, state: paused ? 'paused' : 'active' },
    }))
  let revision = first
  const decide = async (input: (typeof cases)[number]['input'], reviewed: string) => {
    await vi.waitFor(() => expect(s.approvals.list()).toHaveLength(1))
    const [approval] = s.approvals.list()
    expect(approval).toMatchObject({ taskId, title: 'Install Claude Code plugin formatter' })
    expect(JSON.parse(approval.detail)).toMatchObject({
      repository: 'team/tools',
      revision: reviewed,
      activation: 'Off',
    })
    expect(s.harnessPlugins.state().plugins).toEqual([])
    pause(!input.activeAtInstall)
    if (!input.currentRevisionMatches) {
      t.repo.advance()
      await t.command({ action: 'refresh-marketplace', marketplaceId })
      revision = second
    }
    expect((await t.request('/api/approvals', { id: approval.id, allow: input.approved })).ok).toBe(
      true,
    )
  }
  for (const { input, needsApproval, installed } of cases) {
    const reviewed = revision
    pause(!input.activeBefore)
    const command = {
      ...install,
      enabled: input.activate,
      revision: input.reviewedRevisionMatches ? reviewed : second,
    }
    const installing = t
      .request(
        '/api/agent/studio-extensions',
        { taskId, parentRunId: runId, command: { action: 'plugins', plugins: command } },
        { Authorization: `Bearer ${issue(!input.writable)}` },
      )
      .then((response) => response.ok)
    if (needsApproval) await decide(input, reviewed)
    expect({ input, installed: await installing }).toEqual({ input, installed })
    expect(s.approvals.list()).toEqual([])
    expect(s.harnessPlugins.state().plugins).toHaveLength(installed ? 1 : 0)
  }
  expect(s.harnessPlugins.state().plugins).toMatchObject([{ name: 'formatter', enabled: false }])
  expect(s.harnessPlugins.claudePluginPaths({})).toEqual([])
})

const codexAvailable = spawnSync('codex', ['--version'], { encoding: 'utf8' }).status === 0
it.skipIf(!codexAvailable)(
  'installs, disables and removes a reviewed plugin with the real Codex app-server',
  async () => {
    const f = await fixture()
    cleanups.push(f.cleanup)
    const home = join(f.directory, 'codex-home')
    mkdirSync(home)
    const repo = repository()
    const { default: Database } = await import('better-sqlite3')
    const db = new Database(':memory:')
    cleanups.push(() => db.close())
    const plugins = new HarnessPlugins(
      db,
      join(f.directory, 'snapshots'),
      codexAppServerPlugins('codex', { CODEX_HOME: home }),
      repo.fetcher,
    )
    const { marketplaces } = decode(
      harnessPluginStateSchema,
      await plugins.command({ action: 'add-marketplace', repository: 'team/tools' }),
    )
    const marketplaceId = marketplaces[0].id
    await plugins.command({
      action: 'install',
      marketplaceId,
      plugin: 'notes',
      revision: first,
      harness: 'codex',
      enabled: false,
    })
    // Installed without activation: Codex keeps it off for every session.
    const config = () => readFileSync(join(home, 'config.toml'), 'utf8')
    expect(config()).toMatch(/\[plugins\."notes@dovo-[a-f0-9]{12}"\]\nenabled = false/)
    const id = `notes@${marketplaceId}:codex`
    await plugins.command({ action: 'set-enabled', id, enabled: true })
    expect(config()).toMatch(/\[plugins\."notes@dovo-[a-f0-9]{12}"\]\nenabled = true/)
    await plugins.command({ action: 'set-enabled', id, enabled: false })
    expect(config()).toMatch(/\[plugins\."notes@dovo-[a-f0-9]{12}"\]\nenabled = false/)
    await plugins.command({ action: 'remove', id })
    expect(config()).not.toContain('dovo-')
  },
)
