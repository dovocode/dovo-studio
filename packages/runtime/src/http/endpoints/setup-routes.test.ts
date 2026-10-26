import { afterEach, expect, it, vi } from 'vite-plus/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  decode,
  defaultTaskHarness,
  runtimeSetupSchema,
  snapshotSchema,
  taskSchema,
} from '@dovo/protocol'
import { startRuntime } from '../../index'
import { RuntimeDefaults } from '../../storage/runtime-defaults'
import type { AgentAdapter } from '../../agents/execution/types'

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
it('rejects stale setup and title settings from a second device', async () => {
  const { runtime, call, options } = await setup()
  const original = decode(runtimeSetupSchema, await (await call('read')).json())
  expect((await call('save', { before: original, after: selection })).status).toBe(200)
  expect(
    (
      await call('save', {
        before: original,
        after: { ...selection, defaults: { ...selection.defaults, execution: 'worktree' } },
      })
    ).status,
  ).toBe(409)
  expect(runtime.services.defaults.get().harness.model).toBe('main-model')

  const titles = runtime.services.titles.read()
  const postTitles = (input: unknown) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/agents/title-settings/save`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.ownerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    })
  expect((await postTitles({ before: titles, after: { ...titles, model: 'first' } })).status).toBe(
    200,
  )
  expect((await postTitles({ before: titles, after: { ...titles, model: 'second' } })).status).toBe(
    409,
  )
  expect(runtime.services.titles.read().model).toBe('first')
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
      // An older app may still send the retired fixed base branch; it is accepted and dropped.
      worktreeBaseBranch: 'origin/main',
      worktreeFromOrigin: true,
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
    worktreeFromOrigin: true,
    setupCommand: '',
  })
  expect(task.worktreeBaseBranch).toBeUndefined()
  const stale = await patch(null, {})
  expect(stale.status).toBe(200)
  expect(await stale.json()).toMatchObject({ outcome: 'reconciled', reconciled: true })
  expect(runtime.services.store.taskDefaults('project').harness?.model).toBe('project-model')
  // An empty stale override adds no conflicting intent to recover.
  expect(runtime.services.store.recoveredEdits()).toEqual([])
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
    worktreeFromOrigin: true,
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

it('keeps Scope selection off by default and publishes the per-computer opt-in', async () => {
  const { runtime, options } = await setup()
  const s = runtime.services
  s.titles.save({ harness: { provider: 'codex', endpoint: '' }, model: 'title-model' })
  s.store.update((w) => ({
    ...w,
    repositories: [{ id: 'project', kind: 'folder', name: 'Project', path: tmpdir(), branch: '' }],
  }))
  const task = s.tasks.create({
    title: 'Scope draft',
    repositoryId: 'project',
    agentId: '',
    objective: '',
  })
  s.store.updateTask(task.id, (current) => ({ ...current, autoProject: true }))
  const run = vi.fn<AgentAdapter['run']>(async (input) =>
    input.onText(
      JSON.stringify({ status: 'selected', repositoryId: 'project', links: [], reason: '' }),
    ),
  )
  vi.spyOn(s.agents, 'get').mockResolvedValue({ probe: vi.fn<AgentAdapter['probe']>(), run })
  const post = (path: string, input: unknown) =>
    fetch(`http://127.0.0.1:${runtime.port}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.ownerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    })
  const snapshot = async () =>
    decode(
      snapshotSchema,
      await (
        await fetch(`http://127.0.0.1:${runtime.port}/api/snapshot`, {
          headers: { Authorization: `Bearer ${options.ownerToken}` },
        })
      ).json(),
    )
  expect(s.preferences.get().enableAutoProjectSelection).toBe(false)
  expect((await snapshot()).autoProjectSelectionEnabled).toBe(false)
  expect(
    (await post('/api/tasks/projects/select', { id: task.id, text: 'Update Project' })).status,
  ).toBe(403)
  expect(run).not.toHaveBeenCalled()
  expect(s.store.task(task.id).autoProject).toBe(true)
  expect(
    (await post('/api/runtime/preferences/save', { enableAutoProjectSelection: true })).status,
  ).toBe(200)
  expect((await snapshot()).autoProjectSelectionEnabled).toBe(true)
  expect(
    (await post('/api/tasks/projects/select', { id: task.id, text: 'Update Project' })).status,
  ).toBe(200)
  expect(run).toHaveBeenCalledOnce()
  expect(s.store.task(task.id)).toMatchObject({ repositoryId: 'project', autoProject: undefined })
  await post('/api/runtime/preferences/save', { enableAutoProjectSelection: false })
  expect((await snapshot()).autoProjectSelectionEnabled).toBe(false)
  expect(s.store.task(task.id).repositoryId).toBe('project')
})

it.each(['plain', 'progress', 'fenced'] as const)(
  'lets a paired device send the first message after a %s Scope response falls back to General',
  async (format) => {
    const { runtime } = await setup()
    const s = runtime.services
    const phoneToken = 'scope-paired-phone-token-at-least-thirty-two-characters'
    s.devices.add('Phone', phoneToken)
    s.preferences.save({ enableAutoProjectSelection: true })
    s.titles.save({ harness: { provider: 'codex', endpoint: '' }, model: 'title-model' })
    const scratch = await s.scratch.ensure()
    s.store.update((workspace) => ({
      ...workspace,
      repositories: [
        scratch,
        { id: 'project', kind: 'folder', name: 'Project', path: tmpdir(), branch: '' },
      ],
    }))
    const task = s.tasks.create({
      title: 'Scope draft',
      repositoryId: scratch.id,
      agentId: '',
      objective: '',
    })
    s.store.updateTask(task.id, (current) => ({
      ...current,
      autoProject: true,
      autoProjectExecution: 'worktree',
    }))
    vi.spyOn(s.agents, 'get').mockResolvedValue({
      probe: vi.fn<AgentAdapter['probe']>(),
      run: async (input) => {
        if (input.agent.model === 'title-model') {
          if (format === 'progress') {
            input.onText('I will compare the available projects.')
            input.onTextBoundary?.()
          }
          const result = JSON.stringify({
            status: 'ambiguous',
            repositoryId: null,
            links: [],
            reason: 'No project matches',
          })
          input.onText(
            format === 'fenced' ? `Here is the selection:\n\`\`\`json\n${result}\n\`\`\`` : result,
          )
        } else input.onText('Ready to help in General')
      },
    })
    const post = (path: string, body: unknown) =>
      fetch(`http://127.0.0.1:${runtime.port}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${phoneToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    const resolved = await post('/api/tasks/projects/select', {
      id: task.id,
      text: 'Plan a new service',
    })
    expect(resolved.status).toBe(200)
    const general = decode(taskSchema, await resolved.json())
    expect(general).toMatchObject({
      repositoryId: scratch.id,
      autoProjectFallback: true,
      linkedCheckouts: [],
    })
    expect(general.autoProject).toBeUndefined()
    expect(general.autoProjectExecution).toBeUndefined()
    expect(
      (
        await post('/api/tasks/message', {
          id: task.id,
          text: 'Plan a new service',
          messageId: 'first',
        })
      ).status,
    ).toBe(200)
    await vi.waitFor(() => expect(s.store.task(task.id).turns?.at(-1)?.status).toBe('completed'))
    expect(s.store.task(task.id)).toMatchObject({ repositoryId: scratch.id, linkedCheckouts: [] })
    expect(s.store.task(task.id).checkoutBranch).toBeUndefined()
  },
)

it('resolves a Maestro default before accepting the first message and keeps the concrete choice', async () => {
  const { runtime, options } = await setup()
  const s = runtime.services
  s.preferences.save({ ...s.preferences.get(), enableSmartModelSelection: true })
  s.titles.save({ harness: { provider: 'codex', endpoint: '' }, model: 'title-model' })
  s.store.update((w) => ({
    ...w,
    repositories: [
      {
        id: 'project',
        kind: 'folder',
        name: 'Project',
        path: tmpdir(),
        branch: '',
        taskDefaults: {
          modelSelection: 'smart',
          harness: { ...s.defaults.get().harness, provider: 'codex', model: 'project-model' },
        },
      },
    ],
  }))
  const task = s.tasks.create({
    title: 'Maestro draft',
    repositoryId: 'project',
    agentId: '',
    objective: '',
  })
  expect(task.modelSelection).toBe('smart')
  let selections = 0
  vi.spyOn(s.agents, 'get').mockImplementation(async (provider) => ({
    probe: async () => ({ provider, available: provider === 'codex', detail: '' }),
    models: async () => ({ models: [{ id: 'small', name: 'Small' }], reasoning: [] }),
    run: async (input) => {
      if (input.agent.model === 'title-model') {
        selections++
        const candidates = JSON.parse(input.prompt).candidates
        input.onText(JSON.stringify({ id: candidates[0].id, reason: 'Simple task' }))
      } else input.onText('Done')
    },
  }))
  const send = (messageId: string) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/tasks/message`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.ownerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: task.id, messageId, text: 'Explain this project' }),
    })
  expect((await send('first')).status).toBe(200)
  expect(s.store.task(task.id)).toMatchObject({ harness: { provider: 'codex', model: 'small' } })
  expect(s.store.task(task.id).modelSelection).toBeUndefined()
  expect((await send('first')).status).toBe(200)
  expect(selections).toBe(1)
})

it('gates selector-model overrides while keeping explicit title settings available', async () => {
  const { runtime, options } = await setup()
  const post = (path: string, input: unknown) =>
    fetch(`http://127.0.0.1:${runtime.port}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.ownerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    })
  const utility = { harness: { provider: 'codex', endpoint: '' }, model: 'selector-model' }
  expect(runtime.services.preferences.get().enableSmartModelSelection).toBe(false)
  expect((await post('/api/agents/selection-settings/save', utility)).status).toBe(403)
  expect((await post('/api/agents/title-settings/save', { model: 'missing-harness' })).status).toBe(
    400,
  )
  expect(
    (await post('/api/agents/title-settings/save', { ...utility, model: 'title-model' })).status,
  ).toBe(200)
  const preferences = runtime.services.preferences
  preferences.save({ ...preferences.get(), enableSmartModelSelection: true })
  const inherited = await post('/api/agents/selection-settings/read', {})
  expect(await inherited.json()).toMatchObject({ inheritTitleModel: true })
  expect((await post('/api/agents/selection-settings/save', utility)).status).toBe(200)
  expect(runtime.services.titles.read().model).toBe('title-model')
  preferences.save({ ...preferences.get(), enableSmartModelSelection: false })
  expect(
    (await post('/api/agents/selection-settings/save', { inheritTitleModel: true })).status,
  ).toBe(403)
})
