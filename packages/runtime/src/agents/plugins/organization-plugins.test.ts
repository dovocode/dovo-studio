import { afterEach, expect, it, vi } from 'vite-plus/test'
import { join } from 'node:path'
import {
  decode,
  defaultTaskHarness,
  harnessPluginStateSchema,
  scopedSettingsResultSchema,
  type ScopedSettingsValue,
  type Task,
} from '@dovo/protocol'
import { startRuntime } from '../../index.js'
import { fixture } from '../../testing/fixture.js'
import { runtimeIntegration } from '../../testing/integration.js'
import { first, pluginRepository } from '../../testing/plugin-marketplace.js'
import { HarnessPlugins, type CodexPluginHost } from './harness-plugins.js'
import type { AgentAdapter, AgentRun } from '../execution/types.js'

vi.setConfig(runtimeIntegration)
const cleanups: Array<() => unknown> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
const human = 'paired-group-client-token-with-at-least-32-chars'
const codex: CodexPluginHost = {
  install: async () => {},
  setEnabled: async () => {},
  remove: async () => {},
}

async function setup() {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({
    databasePath: join(f.directory, 'state.sqlite'),
    ownerToken: 'group-owner-token-with-at-least-32-characters',
    port: 0,
  })
  cleanups.push(runtime.close)
  const s = runtime.services
  s.devices.add('Paired computer', human)
  s.harnessPlugins = new HarnessPlugins(
    s.db,
    join(f.directory, 'harness-plugins'),
    codex,
    pluginRepository().fetcher,
  )
  const base = f.workspace.repositories[0]
  s.store.update(() => ({
    ...f.workspace,
    repositories: [
      { ...base, id: 'alpha', name: 'Alpha' },
      { ...base, id: 'beta', name: 'Beta' },
      { ...base, id: 'gamma', name: 'Gamma' },
    ],
  }))
  const post = async (path: string, body: unknown) => {
    const response = await fetch(`http://127.0.0.1:${runtime.port}/api/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${human}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { status: response.status, body: (await response.json()) as unknown }
  }
  const ok = async (path: string, body: unknown) => {
    const result = await post(path, body)
    if (result.status !== 200) throw new Error(`${result.status} ${JSON.stringify(result.body)}`)
    return result.body
  }
  /** Read a scope, apply a change to its resources, and save it the way the editors do. */
  const editResources = async (
    target: { scope: string; repositoryId?: string; organizationId?: string },
    change: (resources: NonNullable<ScopedSettingsValue['resources']>) => unknown,
  ) => {
    const read = decode(scopedSettingsResultSchema, await ok('agents/settings/read', target))
    const resources = read.value.resources ?? { mcpServers: [], skills: [] }
    return post('agents/settings/save', {
      ...target,
      before: read.value,
      after: { ...read.value, resources: change(resources) },
    })
  }
  /** Start a real turn and capture what the launch path gives the Claude harness. */
  const launch = async (repositoryId: string) => {
    let captured: AgentRun | undefined
    vi.spyOn(s.agents, 'get').mockResolvedValue({
      probe: vi.fn<AgentAdapter['probe']>(),
      run: async (run) => {
        captured = run
        run.onSession(`session-${repositoryId}`)
        run.onText('Done')
      },
    })
    const task: Task = {
      id: `task-${repositoryId}-${Math.random().toString(36).slice(2)}`,
      title: repositoryId,
      repositoryId,
      agentId: '',
      harness: { ...defaultTaskHarness('claude'), permission: 'ask' },
      status: 'draft',
      createdAt: '2026-11-25T10:00:00Z',
      messages: [{ id: 'request', role: 'user', text: 'Work' }],
      files: [],
      draft: '',
      example: false,
    }
    s.store.update((workspace) => ({ ...workspace, tasks: [...workspace.tasks, task] }))
    await (
      await s.tasks.start(task.id)
    ).done
    if (!captured) throw new Error('The turn did not launch')
    return {
      plugins: (captured.claudePlugins ?? []).map((path) => path.split(/[\\/]/).at(-2)),
      skills: (captured.agent.resources?.skills ?? []).map((skill) => skill.name).sort(),
      servers: (captured.agent.resources?.mcpServers ?? [])
        .map((server) => server.name)
        // Dovo's own thread tools are present in every launch.
        .filter((name) => name !== 'dovo_task')
        .sort(),
    }
  }
  return { s, f, ok, post, editResources, launch }
}

it('shares skills, MCP servers and Claude plugins with member projects only, with project overrides and removal', async () => {
  const t = await setup()
  const { marketplaces } = decode(
    harnessPluginStateSchema,
    await t.ok('agents/plugins', { action: 'add-marketplace', repository: 'team/tools' }),
  )
  const marketplaceId = marketplaces[0].id
  // Installed only: no project uses it until a scope turns it on.
  const installed = decode(
    harnessPluginStateSchema,
    await t.ok('agents/plugins', {
      action: 'install',
      marketplaceId,
      plugin: 'formatter',
      revision: first,
      harness: 'claude',
      enabled: false,
    }),
  )
  const formatter = installed.plugins[0].id
  const snapshot = t.s.harnessPlugins.claudePluginPaths({
    plugins: [{ name: formatter, enabled: true }],
  })[0]
  const folder = snapshot.split(/[\\/]/).at(-2)

  // Group two projects through the organization endpoint the settings page uses.
  await t.ok('agents/settings/organization', {
    action: 'assign',
    repositoryId: 'alpha',
    before: null,
    target: { name: 'Platform' },
  })
  const organizationId = t.s.store
    .get()
    .repositories.find((repo) => repo.id === 'alpha')?.organizationId
  if (!organizationId) throw new Error('No organization')
  await t.ok('agents/settings/organization', {
    action: 'assign',
    repositoryId: 'beta',
    before: null,
    target: { id: organizationId },
  })

  // One set of group resources: a skill, an MCP server and the plugin activation.
  const group = { scope: 'organization', organizationId }
  const saved = await t.editResources(group, (resources) => ({
    ...resources,
    skills: [
      { name: 'platform-review', description: 'Review', enabled: true, content: 'Review it.' },
    ],
    mcpServers: [
      {
        name: 'platform-tracker',
        enabled: true,
        transport: 'http',
        url: 'http://tracker.lan/mcp',
      },
    ],
    plugins: [{ name: formatter, enabled: true }],
  }))
  expect(saved.status).toBe(200)

  const alpha = await t.launch('alpha')
  const beta = await t.launch('beta')
  const gamma = await t.launch('gamma')
  expect(alpha).toEqual({
    plugins: [folder],
    skills: ['platform-review'],
    servers: ['platform-tracker'],
  })
  expect(beta).toEqual(alpha)
  expect(gamma).toEqual({ plugins: [], skills: [], servers: [] })

  // A project on this computer overrides the group by name; removing the override reveals it.
  const betaHere = { scope: 'environment-project', repositoryId: 'beta' }
  expect(
    (
      await t.editResources(betaHere, (resources) => ({
        ...resources,
        plugins: [{ name: formatter, enabled: false }],
      }))
    ).status,
  ).toBe(200)
  expect((await t.launch('beta')).plugins).toEqual([])
  expect((await t.launch('alpha')).plugins).toEqual([folder])
  await t.editResources(betaHere, (resources) => ({ ...resources, plugins: [] }))
  expect((await t.launch('beta')).plugins).toEqual([folder])

  // An editor that predates plugin activations omits the key; the group keeps its plugin.
  const read = decode(scopedSettingsResultSchema, await t.ok('agents/settings/read', group))
  const { plugins: _plugins, ...legacyResources } = read.value.resources ?? {
    mcpServers: [],
    skills: [],
  }
  const legacy = await t.post('agents/settings/save', {
    ...group,
    before: { ...read.value, resources: legacyResources },
    after: {
      ...read.value,
      resources: { ...legacyResources, additionalInstructions: 'Use the platform style.' },
    },
  })
  expect(legacy.status).toBe(200)
  expect((await t.launch('alpha')).plugins).toEqual([folder])

  // Codex reads plugin activation only from its machine-wide config, so a group cannot own it.
  const rejected = await t.editResources(group, (resources) => ({
    ...resources,
    plugins: [{ name: `notes@${marketplaceId}:codex`, enabled: true }],
  }))
  expect(rejected.status).toBe(400)
  expect(JSON.stringify(rejected.body)).toContain('after.resources.plugins')

  // Leaving the group removes all of its resources from that project.
  await t.ok('agents/settings/organization', {
    action: 'assign',
    repositoryId: 'beta',
    before: organizationId,
    target: null,
  })
  expect(await t.launch('beta')).toEqual({ plugins: [], skills: [], servers: [] })

  // Removing the installation stops the plugin everywhere; the group's choice is kept and ignored.
  await t.ok('agents/plugins', { action: 'remove', id: formatter })
  expect(await t.launch('alpha')).toEqual({
    plugins: [],
    skills: ['platform-review'],
    servers: ['platform-tracker'],
  })
  const after = decode(scopedSettingsResultSchema, await t.ok('agents/settings/read', group))
  expect(after.value.resources?.plugins).toEqual([{ name: formatter, enabled: true }])
})

it('applies a computer-wide plugin to every project unless a group or project turns it off', async () => {
  const t = await setup()
  const { marketplaces } = decode(
    harnessPluginStateSchema,
    await t.ok('agents/plugins', { action: 'add-marketplace', repository: 'team/tools' }),
  )
  const { plugins } = decode(
    harnessPluginStateSchema,
    await t.ok('agents/plugins', {
      action: 'install',
      marketplaceId: marketplaces[0].id,
      plugin: 'formatter',
      revision: first,
      harness: 'claude',
      enabled: true,
    }),
  )
  await t.ok('agents/settings/organization', {
    action: 'assign',
    repositoryId: 'alpha',
    before: null,
    target: { name: 'Quiet' },
  })
  const organizationId = t.s.store
    .get()
    .repositories.find((repo) => repo.id === 'alpha')?.organizationId
  await t.editResources({ scope: 'organization', organizationId }, (resources) => ({
    ...resources,
    plugins: [{ name: plugins[0].id, enabled: false }],
  }))
  expect((await t.launch('alpha')).plugins).toEqual([])
  expect((await t.launch('gamma')).plugins).toHaveLength(1)
})
