import { expect, it } from 'vite-plus/test'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { startRuntime } from '../../index'
import {
  decode,
  defaultTaskHarness,
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
