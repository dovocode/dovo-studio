import { expect, it } from 'vite-plus/test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { builtInAgentPresets, defaultTaskHarness, type Task } from '@dovo/protocol'
import { startRuntime } from '../index.js'

it('lists enabled Antigravity plugin skills from the selected thread’s own profile', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dovo-native-skills-'))
  const profile = join(root, 'profile')
  const config = join(profile, 'config')
  const plugins = join(config, 'plugins')
  const token = 'native-skills-owner-token-at-least-32-characters'
  const write = async (path: string, text: string) => {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, text)
  }
  const skill = (name: string) =>
    `---\nname: ${name}\ndescription: Find ${name}\n---\nBody stays with Antigravity.\n`
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  try {
    const preset = builtInAgentPresets().find(({ id }) => id === 'dovo:antigravity')!
    const harness = { ...preset, env: { GEMINI_HOME: profile } }
    const task = (id: string, settings: Task['harness']): Task => ({
      id,
      title: id,
      agentId: '',
      harness: settings,
      repositoryId: 'repo',
      status: 'draft',
      createdAt: '2026-11-26T12:00:00Z',
      messages: [],
      files: [],
      draft: '',
      example: false,
    })
    runtime.services.store.update((workspace) => ({
      ...workspace,
      repositories: [{ id: 'repo', path: root, name: 'Fixture', branch: 'main', kind: 'folder' }],
      tasks: [
        task('agy', harness),
        task('other-acp', { ...defaultTaskHarness('acp'), endpoint: 'other' }),
        { ...task('archived', harness), archivedAt: '2026-11-26T12:00:00Z' },
      ],
    }))
    await write(join(config, 'config.json'), '{"plugins":{"disabled":{"enabled":false}}}')
    await write(join(plugins, 'disabled/plugin.json'), '{}')
    await write(join(plugins, 'disabled/skills/hidden/SKILL.md'), skill('hidden'))
    await write(
      join(plugins, 'enabled/.antigravity-plugin/plugin.json'),
      JSON.stringify({
        skills: ['./extra/SKILL.md', './collection', '../../../../outside/SKILL.md'],
      }),
    )
    await write(join(plugins, 'enabled/plugin.json'), '{"skills":"./ignored"}')
    await write(join(plugins, 'enabled/extra/SKILL.md'), skill('extra'))
    await write(join(plugins, 'enabled/collection/one/SKILL.md'), skill('collection'))
    await write(join(plugins, 'enabled/skills/standard/SKILL.md'), skill('standard'))
    await write(join(plugins, 'enabled/ignored/SKILL.md'), skill('ignored'))
    await write(join(root, 'outside/SKILL.md'), skill('outside'))
    const read = async (id: string, credential = token) => {
      const response = await fetch(`http://127.0.0.1:${runtime.port}/api/tasks/native-skills`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      expect(response.status).toBe(200)
      return response.json()
    }
    expect(await read('agy')).toEqual([
      { name: 'collection', description: 'Find collection' },
      { name: 'extra', description: 'Find extra' },
      { name: 'standard', description: 'Find standard' },
    ])
    await write(join(plugins, 'enabled/extra/SKILL.md'), skill('updated'))
    expect(await read('agy')).toEqual([
      { name: 'collection', description: 'Find collection' },
      { name: 'standard', description: 'Find standard' },
      { name: 'updated', description: 'Find updated' },
    ])
    expect(await read('other-acp')).toEqual([])
    expect(await read('archived')).toEqual([])
  } finally {
    await runtime.close()
    await rm(root, { recursive: true, force: true })
  }
})
