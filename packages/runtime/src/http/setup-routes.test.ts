import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decode, defaultTaskHarness, runtimeSetupSchema, snapshotSchema } from '@dovo/protocol'
import { startRuntime } from '../index'
import { RuntimeDefaults } from '../storage/runtime-defaults'
import type { AgentAdapter } from '../agents/types'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const close of cleanups.splice(0).reverse()) await close()
})
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-setup-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const options = {
    databasePath: join(directory, 'runtime.sqlite'),
    ownerToken: 'setup-owner-token-at-least-thirty-two-characters',
    port: 0,
  }
  const runtime = await startRuntime(options)
  cleanups.push(runtime.close)
  const call = (path: string, body: unknown = {}, token = options.ownerToken) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/agents/setup/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  return { runtime, options, call }
}
const selection = {
  defaults: {
    configured: false,
    harness: { ...defaultTaskHarness('claude'), model: 'main-model' },
  },
  titles: {
    harness: { provider: 'codex', endpoint: 'fixture-codex' },
    model: 'small-title-model',
    reasoning: 'low',
  },
}
it('shares setup with paired devices, persists it, and keeps utility models independent', async () => {
  const { runtime, options, call } = await setup()
  expect((await call('read', {}, 'wrong')).status).toBe(401)
  expect(decode(runtimeSetupSchema, await (await call('read')).json()).defaults.configured).toBe(
    false,
  )
  const phoneToken = 'paired-phone-token-at-least-thirty-two-characters'
  runtime.services.devices.add('Phone', phoneToken)
  const saved = await call('save', selection, phoneToken)
  expect(saved.status).toBe(200)
  expect(decode(runtimeSetupSchema, await saved.json()).defaults).toMatchObject({
    configured: true,
    harness: { provider: 'claude', model: 'main-model' },
  })
  const task = runtime.services.tasks.create({
    title: 'New',
    repositoryId: '',
    agentId: '',
    objective: 'Work',
  })
  expect(task.harness).toMatchObject({ provider: 'claude', model: 'main-model' })
  const explicit = runtime.services.tasks.create({
    title: 'Custom',
    repositoryId: '',
    agentId: 'chosen-agent',
    objective: 'Work',
  })
  expect(explicit.agentId).toBe('chosen-agent')
  expect(explicit.harness).toBeUndefined()
  const run = vi.fn<AgentAdapter['run']>(async (input) => input.onText('A useful title'))
  vi.spyOn(runtime.services.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run,
  })
  await runtime.services.titles.generate({ text: 'Name this work' })
  expect(run.mock.calls[0][0].agent).toMatchObject({
    provider: 'codex',
    model: 'small-title-model',
    reasoning: 'low',
    permission: 'read-only',
  })
  await runtime.services.titles.cleanup({ text: 'A useful title' })
  expect(run.mock.calls[1][0].agent.model).toBe('small-title-model')
  expect(run.mock.calls[1][0].tools).toBe('none')
  expect(
    (
      await call('save', {
        ...selection,
        defaults: { harness: { ...defaultTaskHarness('opencode'), model: 'another/main' } },
      })
    ).status,
  ).toBe(200)
  expect(runtime.services.store.task(task.id).harness?.model).toBe('main-model')
  expect(runtime.services.titles.read().model).toBe('small-title-model')
  const response = await fetch(`http://127.0.0.1:${runtime.port}/api/snapshot`, {
    headers: { Authorization: `Bearer ${phoneToken}` },
  })
  expect(decode(snapshotSchema, await response.json()).defaults?.harness.model).toBe('another/main')
  await runtime.close()
  const restarted = await startRuntime(options)
  cleanups.push(restarted.close)
  expect(restarted.services.defaults.get().harness.model).toBe('another/main')
  expect(restarted.services.titles.read().model).toBe('small-title-model')
})
it('rolls back both selections when title validation or persistence fails', async () => {
  const { runtime, call } = await setup()
  expect((await call('save', { ...selection, titles: { agentId: 'missing' } })).status).toBe(400)
  expect(new RuntimeDefaults(runtime.services.db).get().configured).toBe(false)
  runtime.services.db.exec(
    "CREATE TRIGGER fail_setup BEFORE INSERT ON documents WHEN NEW.id = 'title-generation' BEGIN SELECT RAISE(ABORT, 'fixture storage failure'); END",
  )
  expect((await call('save', selection)).status).toBe(500)
  expect(runtime.services.defaults.get().configured).toBe(false)
  expect(runtime.services.titles.read().model).toBe('')
  runtime.services.db.exec('DROP TRIGGER fail_setup')
  expect((await call('save', selection)).status).toBe(200)
})
it('rejects missing ACP configuration and invalid provider choices', async () => {
  const { call } = await setup()
  expect(
    (await call('save', { ...selection, defaults: { harness: defaultTaskHarness('acp') } })).status,
  ).toBe(400)
  expect(
    (
      await call('save', {
        ...selection,
        titles: { harness: { provider: 'acp', endpoint: '' }, model: '' },
      })
    ).status,
  ).toBe(400)
  expect(
    (
      await call('save', {
        ...selection,
        defaults: { harness: { ...defaultTaskHarness('codex'), provider: 'unknown' } },
      })
    ).status,
  ).toBe(400)
})

it('persists project overrides, inherits runtime settings, and leaves existing tasks unchanged', async () => {
  const { runtime, options, call } = await setup()
  await call('save', {
    ...selection,
    defaults: {
      ...selection.defaults,
      execution: 'worktree',
      worktreeBaseBranch: 'origin/main',
      setupCommand: 'pnpm install',
    },
  })
  runtime.services.store.update((w) => ({
    ...w,
    repositories: [{ id: 'project', name: 'Project', path: '/tmp', branch: 'main' }],
  }))
  const overrides = {
    harness: { ...defaultTaskHarness('codex'), model: 'project-model' },
    setupCommand: '',
  }
  const patch = async (before: unknown, after: unknown) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/workspace`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${options.ownerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        collection: 'repositories',
        id: 'project',
        changes: { taskDefaults: { before, after } },
      }),
    })
  expect((await patch(null, overrides)).status).toBe(200)
  const task = runtime.services.tasks.create({
    title: 'Project task',
    repositoryId: 'project',
    agentId: '',
    objective: '',
  })
  expect(task).toMatchObject({
    harness: { model: 'project-model' },
    execution: 'worktree',
    worktreeBaseBranch: 'origin/main',
    setupCommand: '',
  })
  expect((await patch(null, {})).status).toBe(409)
  expect((await patch(overrides, {})).status).toBe(200)
  expect(runtime.services.store.task(task.id).harness?.model).toBe('project-model')
  expect(runtime.services.store.taskDefaults('project')).toMatchObject({
    harness: { model: 'main-model' },
    setupCommand: 'pnpm install',
  })
  await runtime.close()
  const restarted = await startRuntime(options)
  cleanups.push(restarted.close)
  expect(restarted.services.store.taskDefaults('project')).toMatchObject({
    execution: 'worktree',
    worktreeBaseBranch: 'origin/main',
    setupCommand: 'pnpm install',
  })
  expect(restarted.services.store.task(task.id).setupCommand).toBe('')
})

it('rejects stale runtime default saves without overwriting independent title settings', async () => {
  const { runtime, options, call } = await setup()
  await call('save', selection)
  const before = runtime.services.defaults.get()
  const save = (execution: string) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/agents/defaults/save`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.ownerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ before, after: { ...before, execution } }),
    })
  expect((await save('worktree')).status).toBe(200)
  expect((await save('worktree')).status).toBe(200)
  expect((await save('main')).status).toBe(409)
  expect(runtime.services.defaults.get().execution).toBe('worktree')
  expect(runtime.services.titles.read().model).toBe(selection.titles.model)
})
