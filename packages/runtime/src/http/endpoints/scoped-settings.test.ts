import sharp from 'sharp'
import { Effect } from 'effect'
import { runtimeSnapshot } from '../support/runtime-snapshot'
import { expect, it } from 'vite-plus/test'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { startRuntime } from '../../index'
import {
  decode,
  defaultTaskHarness,
  builtInAgentPresets,
  mcpServerSchema,
  scopedSettingsResultSchema,
  type SettingsScope,
  type ScopedSettingsValue,
} from '@dovo/protocol'

async function fixture() {
  const token = randomBytes(32).toString('hex')
  const directory = await mkdtemp(join(tmpdir(), 'dovo-scopes-'))
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  await runtime.services.git.command(directory, ['init'])
  await runtime.services.git.command(directory, [
    'remote',
    'add',
    'origin',
    'git@github.com:Team/Project.git',
  ])
  runtime.services.store.update((workspace) => ({
    ...workspace,
    repositories: [{ id: 'project', name: 'Project', path: directory, branch: 'main' }],
  }))
  const call = (path: string, input: unknown, credential = token) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/agents/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  const read = async (scope: SettingsScope) => {
    const response = await call('settings/read', { scope, repositoryId: 'project' })
    expect(response.status).toBe(200)
    return decode(scopedSettingsResultSchema, await response.json())
  }
  const save = async (scope: SettingsScope, after: ScopedSettingsValue) => {
    const previous = await read(scope)
    return call('settings/save', {
      scope,
      repositoryId: 'project',
      projectKey: previous.projectKey,
      before: previous.value,
      after,
    })
  }
  return {
    runtime,
    icon: (input: unknown) =>
      fetch(`http://127.0.0.1:${runtime.port}/api/scm/repositories/icon`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    call,
    read,
    save,
    directory,
    close: async () => {
      await runtime.close()
      await rm(directory, { recursive: true, force: true })
    },
  }
}

it('exposes built-in profiles before setup, saves only overrides and keeps existing task launches intact', async () => {
  const f = await fixture()
  try {
    const read = async (scope: SettingsScope) => {
      const response = await f.call('settings/read', { scope, includeAgents: true })
      expect(response.status).toBe(200)
      return decode(scopedSettingsResultSchema, await response.json())
    }
    const baseline = builtInAgentPresets().find((agent) => agent.provider === 'claude')!
    const initial = await read('global')
    expect(initial.value.agents).toEqual([])
    expect(initial.inherited.agents).toEqual(builtInAgentPresets())
    expect(f.runtime.services.store.get().agents).toEqual([])
    const save = async (scope: SettingsScope, agents: typeof initial.value.agents) => {
      const previous = await read(scope)
      const response = await f.call('settings/save', {
        scope,
        includeAgents: true,
        before: previous.value,
        after: { ...previous.value, agents },
      })
      expect(response.status).toBe(200)
    }
    await save('global', [{ ...baseline, model: 'shared-model' }])
    const task = f.runtime.services.tasks.create({
      title: 'Built-in launch',
      repositoryId: 'project',
      agentId: baseline.id,
      objective: '',
    })
    expect(task.harness).toMatchObject({ provider: 'claude', model: 'shared-model' })
    await save('environment', [{ ...baseline, model: 'computer-model' }])
    expect(
      f.runtime.services.store.agentsFor('project').find((agent) => agent.id === baseline.id)
        ?.model,
    ).toBe('computer-model')
    await save('environment', [])
    expect(
      f.runtime.services.store.agentsFor('project').find((agent) => agent.id === baseline.id)
        ?.model,
    ).toBe('shared-model')
    await save('global', [])
    expect(
      f.runtime.services.store.agentsFor('project').find((agent) => agent.id === baseline.id),
    ).toEqual(baseline)
    expect(f.runtime.services.store.task(task.id).harness?.model).toBe('shared-model')
  } finally {
    await f.close()
  }
})

it('shares global and remote project settings across runtimes while preserving local overrides and reset revisions', async () => {
  const a = await fixture(),
    b = await fixture()
  try {
    expect((await a.call('settings/read', { scope: 'global' }, 'invalid')).status).toBe(401)
    expect(
      (
        await a.save('global', {
          taskDefaults: {
            setupCommand: 'global',
            harness: defaultTaskHarness('claude'),
            permission: 'ask',
          },
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await a.save('environment', {
          taskDefaults: { setupCommand: 'environment', execution: 'worktree' },
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await a.save('project', {
          taskDefaults: { setupCommand: 'project' },
          prompts: [{ id: 'review', name: 'review', text: 'Review changes' }],
        })
      ).status,
    ).toBe(200)
    expect(
      (await a.save('environment-project', { taskDefaults: { setupCommand: '' } })).status,
    ).toBe(200)
    expect(a.runtime.services.store.taskDefaults('project')).toMatchObject({
      setupCommand: '',
      execution: 'worktree',
      harness: { provider: 'claude', permission: 'ask' },
    })
    const shared = a.runtime.services.defaults.get().scopedSettings?.shared
    expect((await b.call('settings/sync', { shared })).status).toBe(200)
    await b.read('project')
    expect(b.runtime.services.store.taskDefaults('project')).toMatchObject({
      setupCommand: 'project',
      execution: 'main',
      harness: { provider: 'claude' },
    })
    expect((await b.read('environment')).value).toEqual({})
    expect((await b.read('project')).value.prompts?.[0].text).toBe('Review changes')
    expect((await a.save('global', {})).status).toBe(200)
    const reset = a.runtime.services.defaults.get().scopedSettings?.shared
    await b.call('settings/sync', { shared: reset })
    await b.call('settings/sync', { shared })
    expect((await b.read('global')).value).toEqual({})
  } finally {
    await a.close()
    await b.close()
  }
})

it('preserves configured legacy defaults, rejects stale edits and checks remote changes before project saves', async () => {
  const f = await fixture()
  try {
    f.runtime.services.defaults.save({
      harness: defaultTaskHarness('claude'),
      setupCommand: 'legacy',
      permission: 'ask',
    })
    const old = await f.read('global')
    expect((await f.save('global', { taskDefaults: { setupCommand: 'global' } })).status).toBe(200)
    expect(f.runtime.services.store.taskDefaults('project').setupCommand).toBe('legacy')
    expect(
      (await f.call('settings/save', { scope: 'global', before: old.value, after: {} })).status,
    ).toBe(409)
    const project = await f.read('project')
    await f.runtime.services.git.command(f.directory, [
      'remote',
      'set-url',
      'origin',
      'https://github.com/team/fork.git',
    ])
    expect(
      (
        await f.call('settings/save', {
          scope: 'project',
          repositoryId: 'project',
          projectKey: project.projectKey,
          before: project.value,
          after: { taskDefaults: { setupCommand: 'wrong-repo' } },
        })
      ).status,
    ).toBe(409)
    expect((await f.save('environment', {})).status).toBe(200)
    expect(f.runtime.services.store.taskDefaults('project').setupCommand).toBe('global')
    await f.runtime.services.git.command(f.directory, ['remote', 'remove', 'origin'])
    expect(
      (await f.call('settings/read', { scope: 'project', repositoryId: 'project' })).status,
    ).toBe(400)
    expect(
      (await f.save('environment-project', { taskDefaults: { setupCommand: 'local' } })).status,
    ).toBe(200)
  } finally {
    await f.close()
  }
})

it('keeps environment MCP literals private and excludes them and installed ACP IDs from shared scopes', async () => {
  const f = await fixture()
  try {
    const server = decode(mcpServerSchema, {
      name: 'tools',
      transport: 'stdio',
      enabled: true,
      command: 'tools',
      args: [],
      envValues: { TOKEN: 'private-mcp-token' },
    })
    const value = { resources: { mcpServers: [server], skills: [] } }
    expect((await f.save('global', value)).status).toBe(400)
    const response = await f.save('environment', value)
    expect(response.status).toBe(200)
    expect(await response.text()).not.toContain('private-mcp-token')
    const previous = await f.read('environment')
    expect(JSON.stringify(previous)).not.toContain('private-mcp-token')
    expect(
      (
        await f.call('settings/save', {
          scope: 'environment',
          before: previous.value,
          after: { ...previous.value, taskDefaults: { setupCommand: 'test' } },
        })
      ).status,
    ).toBe(200)
    expect(
      f.runtime.services.store.projectSettings('project').resources?.mcpServers[0].envValues?.TOKEN,
    ).toBe('private-mcp-token')
    for (const [path, input] of [
      ['setup/read', {}],
      ['models/preference', { key: 'codex:test', favorite: true }],
    ] as const) {
      const result = await f.call(path, input)
      expect(result.status).toBe(200)
      expect(await result.text()).not.toContain('private-mcp-token')
    }
    expect(
      (
        await f.save('global', {
          taskDefaults: {
            harness: { ...defaultTaskHarness('acp'), acpInstallationId: 'local-install' },
          },
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await f.save('global', {
          prompts: [
            { id: 'a', name: 'review', text: 'a' },
            { id: 'b', name: 'Review', text: 'b' },
          ],
        })
      ).status,
    ).toBe(400)
  } finally {
    await f.close()
  }
})

it('shares pinned catalog skills without local paths and rejects nonportable local bundles', async () => {
  const f = await fixture()
  try {
    const skill = {
      name: 'review',
      description: 'Review',
      enabled: true,
      content: 'Review carefully',
      sourcePath: '/local/skills/review/SKILL.md',
    }
    expect(
      (await f.save('global', { resources: { mcpServers: [], skills: [skill] } })).status,
    ).toBe(400)
    const catalog = {
      ...skill,
      sourceUrl: 'https://skills.sh/team/tools/review',
      sourceRevision: 'a'.repeat(40),
    }
    expect(
      (await f.save('global', { resources: { mcpServers: [], skills: [catalog] } })).status,
    ).toBe(200)
    const shared = (await f.read('global')).value.resources?.skills[0]
    expect(shared?.sourcePath).toBeUndefined()
    expect(shared?.sourceRevision).toBe(catalog.sourceRevision)
    expect(shared?.content).toBe(skill.content)
  } finally {
    await f.close()
  }
})

it('rejects simultaneous project saves based on the same prior document', async () => {
  const f = await fixture()
  try {
    const prior = await f.read('project')
    const results = await Promise.all(
      ['one', 'two'].map((setupCommand) =>
        f.call('settings/save', {
          scope: 'project',
          repositoryId: 'project',
          projectKey: prior.projectKey,
          before: prior.value,
          after: { taskDefaults: { setupCommand } },
        }),
      ),
    )
    expect(results.map((result) => result.status).sort((a, b) => a - b)).toEqual([200, 409])
  } finally {
    await f.close()
  }
})

it('inherits named configurations through four scopes, syncs by Git remote, and preserves tools during independent edits', async () => {
  const a = await fixture(),
    b = await fixture()
  try {
    const agent = {
      ...defaultTaskHarness('codex'),
      id: 'writer',
      name: 'Writer',
      permission: 'ask' as const,
    }
    const readAgents = async (scope: SettingsScope) => {
      const response = await a.call('settings/read', {
        scope,
        repositoryId: 'project',
        includeAgents: true,
      })
      expect(response.status).toBe(200)
      return decode(scopedSettingsResultSchema, await response.json())
    }
    const saveAgents = async (scope: SettingsScope, model: string) => {
      const previous = await readAgents(scope)
      const response = await a.call('settings/save', {
        scope,
        repositoryId: 'project',
        includeAgents: true,
        projectKey: previous.projectKey,
        before: previous.value,
        after: { ...previous.value, agents: [{ ...agent, model }] },
      })
      expect(response.status).toBe(200)
      return decode(scopedSettingsResultSchema, await response.json())
    }
    await saveAgents('global', 'global')
    await saveAgents('environment', 'environment')
    await saveAgents('project', 'project')
    await saveAgents('environment-project', 'local-project')
    expect(
      a.runtime.services.store.agentsFor('project').find((agent) => agent.id === 'writer'),
    ).toMatchObject({ id: 'writer', model: 'local-project' })
    expect(
      (await readAgents('environment-project')).inherited.agents?.find(
        (agent) => agent.id === 'writer',
      ),
    ).toMatchObject({ id: 'writer', model: 'project' })
    const previous = await readAgents('environment-project')
    expect(
      (
        await a.call('settings/save', {
          scope: 'environment-project',
          repositoryId: 'project',
          includeAgents: true,
          before: previous.value,
          after: { agents: [] },
        })
      ).status,
    ).toBe(200)
    expect(
      a.runtime.services.store.agentsFor('project').find((agent) => agent.id === 'writer'),
    ).toMatchObject({ id: 'writer', model: 'project' })
    const shared = a.runtime.services.defaults.get().scopedSettings?.shared
    expect((await b.call('settings/sync', { shared })).status).toBe(200)
    await b.read('project')
    expect(
      b.runtime.services.store.agentsFor('project').find((entry) => entry.id === 'writer')?.model,
    ).toBe('project')
    const beforeDefaults = await a.read('global')
    await saveAgents('global', 'global-new')
    expect(
      (
        await a.call('settings/save', {
          scope: 'global',
          before: beforeDefaults.value,
          after: { ...beforeDefaults.value, taskDefaults: { permission: 'read-only' } },
        })
      ).status,
    ).toBe(200)
    expect(
      a.runtime.services.defaults
        .get()
        .scopedSettings?.shared.find((entry) => entry.key === 'global')?.value.agents?.[0].model,
    ).toBe('global-new')
    const beforeAgents = await readAgents('global')
    await a.save('global', {
      taskDefaults: { permission: 'ask' },
      prompts: [{ id: 'p', name: 'p', text: 'Keep' }],
    })
    expect(
      (
        await a.call('settings/save', {
          scope: 'global',
          includeAgents: true,
          before: beforeAgents.value,
          after: { agents: [{ ...agent, model: 'last' }] },
        })
      ).status,
    ).toBe(200)
    expect((await a.read('global')).value).toMatchObject({
      taskDefaults: { permission: 'ask' },
      prompts: [{ text: 'Keep' }],
      agents: [{ model: 'last' }],
    })
    const stale = await readAgents('global')
    await saveAgents('global', 'newer')
    expect(
      (
        await a.call('settings/save', {
          scope: 'global',
          includeAgents: true,
          before: stale.value,
          after: { agents: [] },
        })
      ).status,
    ).toBe(409)
  } finally {
    await a.close()
    await b.close()
  }
})

it('copies scoped configurations into threads and rejects shared host-specific installations and nested credentials', async () => {
  const f = await fixture()
  try {
    const read = async () => {
      const response = await f.call('settings/read', { scope: 'global', includeAgents: true })
      return decode(scopedSettingsResultSchema, await response.json())
    }
    const agent = {
      ...defaultTaskHarness('claude'),
      id: 'reviewer',
      name: 'Reviewer',
      instructions: 'Original instructions',
    }
    const before = await read()
    expect(
      (
        await f.call('settings/save', {
          scope: 'global',
          includeAgents: true,
          before: before.value,
          after: { agents: [agent] },
        })
      ).status,
    ).toBe(200)
    const task = f.runtime.services.tasks.create({
      title: 'Copied',
      repositoryId: 'project',
      agentId: agent.id,
      objective: '',
    })
    expect(task.harness?.instructions).toBe('Original instructions')
    const stored = await read()
    expect(
      (
        await f.call('settings/save', {
          scope: 'global',
          includeAgents: true,
          before: stored.value,
          after: { agents: [] },
        })
      ).status,
    ).toBe(200)
    expect(f.runtime.services.store.task(task.id).harness?.instructions).toBe(
      'Original instructions',
    )
    const empty = await read()
    expect(
      (
        await f.call('settings/save', {
          scope: 'global',
          includeAgents: true,
          before: empty.value,
          after: {
            agents: [{ ...agent, provider: 'acp', acpInstallationId: 'host-installation' }],
          },
        })
      ).status,
    ).toBe(400)
    const server = decode(mcpServerSchema, {
      name: 'private',
      transport: 'stdio',
      command: 'server',
      envValues: { TOKEN: 'secret' },
      enabled: true,
    })
    expect(
      (
        await f.call('settings/save', {
          scope: 'global',
          includeAgents: true,
          before: empty.value,
          after: { agents: [{ ...agent, resources: { skills: [], mcpServers: [server] } }] },
        })
      ).status,
    ).toBe(400)
    expect((await read()).value.agents).toEqual([])
  } finally {
    await f.close()
  }
})

it('edits legacy server overrides without treating private preset metadata as a conflict', async () => {
  const f = await fixture()
  try {
    const preset = { ...defaultTaskHarness('codex'), id: 'legacy', name: 'Legacy' }
    f.runtime.services.store.update((workspace) => ({
      ...workspace,
      agents: [{ ...preset, model: 'local', globalPreset: preset, serverOverride: true }],
    }))
    const response = await f.call('settings/read', { scope: 'environment', includeAgents: true })
    const before = decode(scopedSettingsResultSchema, await response.json())
    expect(before.value.agents).toMatchObject([{ id: 'legacy', model: 'local' }])
    expect(
      (
        await f.call('settings/save', {
          scope: 'environment',
          includeAgents: true,
          before: before.value,
          after: { agents: [{ ...preset, model: 'edited' }] },
        })
      ).status,
    ).toBe(200)
    expect(f.runtime.services.store.agentsFor().find((agent) => agent.id === 'legacy')?.model).toBe(
      'edited',
    )
  } finally {
    await f.close()
  }
})

it('inherits lifecycle policy across all four scopes and resets individual overrides', async () => {
  const f = await fixture()
  try {
    expect(
      (
        await f.save('global', {
          taskBehavior: { quotaResume: true, quotaSnooze: true, inactiveDays: 3 },
          taskDefaults: { submodules: 'recursive' },
        })
      ).status,
    ).toBe(200)
    expect(
      (await f.save('environment', { taskBehavior: { quotaResume: false, settleInactive: true } }))
        .status,
    ).toBe(200)
    expect((await f.save('project', { taskBehavior: { inactiveDays: 7 } })).status).toBe(200)
    expect(
      (await f.save('environment-project', { taskBehavior: { quotaResume: true } })).status,
    ).toBe(200)
    expect(f.runtime.services.store.projectSettings('project')).toMatchObject({
      taskBehavior: { quotaResume: true, quotaSnooze: true, inactiveDays: 7, settleInactive: true },
      taskDefaults: { submodules: 'recursive' },
    })
    expect((await f.save('environment-project', { taskBehavior: {} })).status).toBe(200)
    expect(f.runtime.services.store.projectSettings('project').taskBehavior?.quotaResume).toBe(
      false,
    )
    expect(f.runtime.services.store.taskDefaults('project').submodules).toBe('recursive')
    expect((await f.save('global', { taskBehavior: { inactiveDays: 0 } })).status).toBe(400)
    expect((await f.save('global', { taskBehavior: { inactiveDays: 366 } })).status).toBe(400)
  } finally {
    await f.close()
  }
})

it('shares uploaded project icons and resets across different runtime repository IDs', async () => {
  const a = await fixture(),
    b = await fixture()
  try {
    await a.save('project', { taskDefaults: { setupCommand: 'pnpm install' } })
    await b.read('project')
    b.runtime.services.store.update((workspace) => ({
      ...workspace,
      repositories: workspace.repositories.map((repo) => ({ ...repo, id: 'other-project' })),
    }))
    const image = await sharp({
      create: { width: 2, height: 2, channels: 4, background: '#ff0000' },
    })
      .png()
      .toBuffer()
    expect((await a.icon({ repositoryId: 'project', data: image.toString('base64') })).status).toBe(
      200,
    )
    const uploaded = a.runtime.services.defaults.get().scopedSettings?.shared
    expect((await a.read('project')).value.taskDefaults?.setupCommand).toBe('pnpm install')
    expect((await b.call('settings/sync', { shared: uploaded })).status).toBe(200)
    const snapshot = await Effect.runPromise(
      runtimeSnapshot(b.runtime.services, { id: 'owner', owner: true }),
    )
    const icon = snapshot.workspace.repositories.find(
      (repo) => repo.id === 'other-project',
    )?.iconOverride
    expect(icon).toMatch(/^data:image\/png;base64,/)
    // Keep an old local upload to verify that a shared reset suppresses it.
    b.runtime.services.store.update((workspace) => ({
      ...workspace,
      repositories: workspace.repositories.map((repo) => ({ ...repo, iconOverride: icon })),
    }))
    expect((await a.icon({ repositoryId: 'project' })).status).toBe(200)
    const reset = a.runtime.services.defaults.get().scopedSettings?.shared
    await b.call('settings/sync', { shared: reset })
    await b.call('settings/sync', { shared: uploaded })
    const cleared = await Effect.runPromise(
      runtimeSnapshot(b.runtime.services, { id: 'owner', owner: true }),
    )
    expect(
      cleared.workspace.repositories.find((repo) => repo.id === 'other-project')?.iconOverride,
    ).toBeUndefined()
    expect(
      b.runtime.services.defaults
        .get()
        .scopedSettings?.shared.find((entry) => entry.key === 'project:github.com/team/project')
        ?.value.projectIcon,
    ).toBeNull()
  } finally {
    await a.close()
    await b.close()
  }
})
