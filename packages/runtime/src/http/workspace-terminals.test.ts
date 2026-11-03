import { homedir } from 'node:os'
import { realpath, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import {
  decode,
  responses,
  STUDIO_TERMINAL_SCOPE,
  SCRATCH_PROJECT_ID,
  taskSchema,
  terminalShellsResponseSchema,
} from '@dovo/protocol'
import { startRuntime } from '../index'
import { fixture } from '../testing/fixture'
import { runtimeIntegration, waitForRuntime } from '../testing/integration'
import { HttpError } from '../errors'

vi.setConfig(runtimeIntegration)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
const ownerToken = 'workspace-terminal-owner-token-at-least-32-chars'
async function setup() {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken, port: 0 })
  cleanups.push(runtime.close)
  runtime.services.store.update(() => ({ ...f.workspace, tasks: [] }))
  const token = 'paired-computer-terminal-token-at-least-32-chars'
  runtime.services.devices.add('Paired computer', token)
  const request = (path: string, input: unknown, credential = token) =>
    fetch(`http://127.0.0.1:${runtime.port}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  const post = (input: unknown, credential = token) =>
    request('/api/terminals/workspace', input, credential)
  const update = (input: unknown, credential = token) =>
    request('/api/terminals/update', input, credential)
  return { ...f, runtime, post, update, request, token }
}
it('opens home and project shells for a paired device without creating threads', async () => {
  const { runtime, post, directory, workspace } = await setup()
  const home = decode(responses.terminal, await (await post({})).json())
  expect(home.taskId).toBe(STUDIO_TERMINAL_SCOPE)
  expect(home.directory).toBe(await realpath(homedir()))
  expect(home.shellId).toBe('default')
  expect(home.execution).toBe('main')
  expect(runtime.services.terminals.get(home.id).directory).toBe(await realpath(homedir()))
  const project = decode(
    responses.terminal,
    await (await post({ repositoryId: workspace.repositories[0].id })).json(),
  )
  expect(project.repositoryId).toBe(workspace.repositories[0].id)
  expect(runtime.services.terminals.get(project.id).directory).toBe(await realpath(directory))
  expect(runtime.services.store.get().tasks).toEqual([])
})
it('rejects unknown projects and unpaired devices before opening shells', async () => {
  const { runtime, post } = await setup()
  expect((await post({ repositoryId: 'missing' })).status).toBe(404)
  expect((await post({}, 'unpaired-token-at-least-32-characters')).status).toBe(401)
  expect((await post({ command: '' })).status).toBe(400)
  expect(runtime.services.terminals.list()).toEqual([])
})
it('runs explicitly submitted input in the new standalone terminal', async () => {
  const { runtime, post } = await setup()
  const session = decode(
    responses.terminal,
    await (
      await post({
        command: `"${process.execPath}" -e "process.stdout.write('workspace-' + 'command-ready')"`,
      })
    ).json(),
  )
  await waitForRuntime(() =>
    expect(runtime.services.terminals.get(session.id).buffer).toContain('workspace-command-ready'),
  )
})

it('pins, settles, reopens and snoozes a standalone shell without replacing or stopping it', async () => {
  const { runtime, post, update } = await setup()
  const terminal = decode(responses.terminal, await (await post({})).json())
  const session = runtime.services.terminals.get(terminal.id)
  const process = session.process
  const change = async (fields: object) => {
    const response = await update({ id: terminal.id, ...fields })
    expect(response.status).toBe(200)
    return decode(responses.terminal, await response.json())
  }
  const revision = runtime.services.activity.revision
  await Promise.all([change({ pinned: true }), change({ settled: true })])
  expect(session.info.pinned).toBe(true)
  expect(session.info.settledAt).toEqual(expect.any(String))
  runtime.services.terminals.input(terminal.id, "printf 'settled-%s\\n' usable\r")
  await waitForRuntime(() => expect(session.buffer).toContain('settled-usable'))
  const until = new Date(Date.now() + 60_000).toISOString()
  expect(await change({ snoozedUntil: until })).toMatchObject({ pinned: true, snoozedUntil: until })
  expect(session.info.settledAt).toBeUndefined()
  runtime.services.terminals.input(terminal.id, "printf 'snoozed-%s\\n' usable\r")
  await waitForRuntime(() => expect(session.buffer).toContain('snoozed-usable'))
  await change({ settled: true })
  expect(session.info.snoozedUntil).toBeUndefined()
  await change({ snoozedUntil: until })
  await change({ settled: false })
  expect(session.info.settledAt).toBeUndefined()
  expect(session.info.snoozedUntil).toBeUndefined()
  await change({ snoozedUntil: until })
  await change({ snoozedUntil: null, pinned: false })
  expect(session.info.snoozedUntil).toBeUndefined()
  expect(session.info.pinned).toBe(false)
  expect(runtime.services.activity.revision).toBeGreaterThan(revision)
  expect(session.process).toBe(process)
  expect(session.info.exited).toBe(false)
  runtime.services.terminals.input(terminal.id, "printf 'lifecycle-%s\\n' usable\r")
  await waitForRuntime(() => expect(session.buffer).toContain('lifecycle-usable'))
  expect(runtime.services.store.get().tasks).toEqual([])
})

it('supports thread terminals but denies lifecycle mutations even to a run that owns the terminal', async () => {
  const { runtime, directory, update, post, request } = await setup()
  const task = decode(taskSchema, {
    id: 'terminal-thread',
    title: 'Terminal thread',
    repositoryId: 'repo',
    agentId: 'agent',
    status: 'running',
    activeRunId: 'terminal-run',
    createdAt: new Date().toISOString(),
    messages: [],
    files: [],
    draft: '',
    example: false,
  })
  runtime.services.store.update((workspace) => ({ ...workspace, tasks: [task] }))
  const terminal = runtime.services.terminals.create(task.id, directory)
  const credential = runtime.services.runCredentials.issue(
    {
      taskId: task.id,
      runId: 'terminal-run',
      readOnly: false,
      permissions: { provider: 'codex', permission: 'ask' },
      artifacts: false,
      pipelineWatching: false,
      pullRequestWatching: false,
      deviceHub: false,
      memoryScopes: [],
    },
    new AbortController().signal,
  )
  runtime.services.runCredentials.addTerminal(credential, terminal.id)
  expect((await post({}, credential)).status).toBe(403)
  expect((await request('/api/terminals/shells', {}, credential)).status).toBe(403)
  expect((await post({ sourceTerminalId: terminal.id })).status).toBe(400)
  expect((await update({ id: terminal.id, settled: true }, credential)).status).toBe(403)
  expect(runtime.services.terminals.get(terminal.id).info.settledAt).toBeUndefined()
  expect((await update({ id: terminal.id, pinned: true, settled: true })).status).toBe(200)
  expect(runtime.services.terminals.get(terminal.id).info).toMatchObject({
    taskId: task.id,
    pinned: true,
    settledAt: expect.any(String),
    exited: false,
  })
})

it('reports shell exit after a combined lifecycle update in owner snapshots', async () => {
  const { runtime, post, update } = await setup()
  const terminal = decode(responses.terminal, await (await post({})).json())
  const until = new Date(Date.now() + 60_000).toISOString()
  const response = await update({
    id: terminal.id,
    pinned: true,
    settled: true,
    snoozedUntil: until,
  })
  expect(response.status).toBe(200)
  const updated = decode(responses.terminal, await response.json())
  expect(updated.snoozedUntil).toBe(until)
  expect(updated.settledAt).toBeUndefined()
  runtime.services.terminals.input(terminal.id, 'exit 7\r')
  await waitForRuntime(() =>
    expect(runtime.services.terminals.get(terminal.id).info).toMatchObject({
      exited: true,
      exitCode: 7,
      pinned: true,
      snoozedUntil: until,
    }),
  )
  const snapshot = await fetch(`http://127.0.0.1:${runtime.port}/api/snapshot`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
  })
  expect(snapshot.status).toBe(200)
  expect(await snapshot.json()).toMatchObject({
    terminals: [
      expect.objectContaining({
        id: terminal.id,
        exited: true,
        exitCode: 7,
        pinned: true,
        snoozedUntil: until,
      }),
    ],
  })
})

it('validates lifecycle input atomically and requires paired or owner authorization', async () => {
  const { runtime, post, update } = await setup()
  const terminal = decode(responses.terminal, await (await post({})).json())
  for (const snoozedUntil of [
    'tomorrow',
    '2030-02-30T12:00:00.000Z',
    '2030-13-01T00:00:00Z',
    new Date(Date.now() - 60_000).toISOString(),
  ]) {
    expect((await update({ id: terminal.id, pinned: true, snoozedUntil })).status).toBe(400)
  }
  expect((await update({ id: terminal.id, settled: 'true' })).status).toBe(400)
  expect((await update({ id: 'missing', pinned: true })).status).toBe(404)
  expect((await update({ id: terminal.id, pinned: true }, 'unpaired-token')).status).toBe(401)
  expect(runtime.services.terminals.get(terminal.id).info.pinned).toBeUndefined()
  expect((await update({ id: terminal.id, pinned: true, settled: true }, ownerToken)).status).toBe(
    200,
  )
  const response = await fetch(`http://127.0.0.1:${runtime.port}/api/snapshot`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
  })
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({
    terminals: [
      expect.objectContaining({ id: terminal.id, pinned: true, settledAt: expect.any(String) }),
    ],
  })
})

it('lists owning-computer shells for paired and owner clients and launches the selected shell', async () => {
  const { runtime, request, post } = await setup()
  const response = await request('/api/terminals/shells', {})
  expect(response.status).toBe(200)
  const { shells } = decode(terminalShellsResponseSchema, await response.json())
  expect(shells[0]?.id).toBe('default')
  expect((await request('/api/terminals/shells', {}, ownerToken)).status).toBe(200)
  expect((await request('/api/terminals/shells', {}, 'unpaired')).status).toBe(401)
  const shell = shells.find((item) => item.id !== 'default') ?? shells[0]!
  const opened = await post({ shellId: shell.id })
  expect(opened.status).toBe(200)
  const terminal = decode(responses.terminal, await opened.json())
  expect(terminal.shellId).toBe(shell.id)
  const session = runtime.services.terminals.get(terminal.id)
  expect(session.command).toBe(shell.path)
  expect(session.launch.args).toEqual(shell.args)
})

it('creates a standalone worktree from the selected base and splits without creating another checkout', async () => {
  const { runtime, post, directory } = await setup()
  const s = runtime.services
  s.preferences.save({
    worktreesRoot: join(directory, 'managed-worktrees'),
    branchPrefix: 'custom/',
  })
  await s.git.command(directory, ['branch', 'terminal-base'])
  const add = vi.spyOn(s.git, 'addWorktree')
  const response = await post({
    repositoryId: 'repo',
    execution: 'worktree',
    worktreeBaseBranch: 'terminal-base',
  })
  expect(response.status).toBe(200)
  const terminal = decode(responses.terminal, await response.json())
  expect(terminal).toMatchObject({
    taskId: STUDIO_TERMINAL_SCOPE,
    repositoryId: 'repo',
    execution: 'worktree',
    shellId: 'default',
  })
  expect(terminal.directory).toContain(join(directory, 'managed-worktrees', 'terminal-'))
  expect(terminal.checkoutBranch).toMatch(/^custom\/terminal-/)
  expect(add).toHaveBeenCalledTimes(1)
  expect(add.mock.calls[0]?.[2].at(-1)).toBe('refs/heads/terminal-base')
  const common = (
    await s.git.command(directory, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  ).trim()
  expect(s.store.managedWorktrees(common)).toContain(terminal.directory)
  const splitResponse = await post({ sourceTerminalId: terminal.id })
  expect(splitResponse.status).toBe(200)
  const split = decode(responses.terminal, await splitResponse.json())
  expect(split.id).not.toBe(terminal.id)
  expect(split).toMatchObject({
    directory: terminal.directory,
    shellId: terminal.shellId,
    execution: 'worktree',
    checkoutBranch: terminal.checkoutBranch,
    repositoryId: 'repo',
  })
  expect(s.terminals.get(split.id).launch).toEqual(s.terminals.get(terminal.id).launch)
  expect(add).toHaveBeenCalledTimes(1)
  expect(s.store.get().tasks).toEqual([])
  expect((await post({ sourceTerminalId: terminal.id, shellId: 'default' })).status).toBe(400)
  expect((await post({ sourceTerminalId: 'missing' })).status).toBe(404)
  await s.terminals.close(terminal.id)
  await s.terminals.close(split.id)
  expect(await s.git.command(directory, ['worktree', 'list', '--porcelain'])).toContain(
    terminal.directory,
  )
})

it('opens only registered existing worktrees of the selected project', async () => {
  const { runtime, post, directory } = await setup()
  const target = join(directory, 'existing-worktree')
  await runtime.services.git.addWorktree(directory, target, [
    '-b',
    'existing-terminal',
    target,
    'HEAD',
  ])
  const add = vi.spyOn(runtime.services.git, 'addWorktree')
  const response = await post({
    repositoryId: 'repo',
    execution: 'worktree',
    existingWorktreePath: target,
  })
  expect(response.status).toBe(200)
  expect(decode(responses.terminal, await response.json())).toMatchObject({
    directory: await realpath(target),
    execution: 'worktree',
    checkoutBranch: 'existing-terminal',
  })
  expect(add).not.toHaveBeenCalled()
  expect((await post({ repositoryId: 'repo', existingWorktreePath: homedir() })).status).toBe(400)
  const unrelated = await fixture()
  cleanups.unshift(unrelated.cleanup)
  const unrelatedTree = join(unrelated.directory, 'other-tree')
  await runtime.services.git.addWorktree(unrelated.directory, unrelatedTree, [
    '--detach',
    unrelatedTree,
    'HEAD',
  ])
  expect((await post({ repositoryId: 'repo', existingWorktreePath: unrelatedTree })).status).toBe(
    400,
  )
})

it('rejects invalid starter choices and unauthorized creation before worktree mutations', async () => {
  const { runtime, post, directory } = await setup()
  const add = vi.spyOn(runtime.services.git, 'addWorktree')
  for (const input of [
    { repositoryId: 'repo', execution: 'worktree', shellId: 'not-installed' },
    { repositoryId: 'repo', execution: 'worktree', worktreeBaseBranch: '--orphan' },
    { repositoryId: 'repo', execution: 'main', existingWorktreePath: directory },
    { execution: 'worktree' },
    { worktreeBaseBranch: 'main' },
  ])
    expect((await post(input)).status).toBe(400)
  expect((await post({ repositoryId: 'repo', execution: 'worktree' }, 'unpaired')).status).toBe(401)
  expect(add).not.toHaveBeenCalled()
  expect(runtime.services.terminals.list()).toEqual([])
})

it('rechecks project selection and pairing after asynchronous checkout inspection', async () => {
  const { runtime, post, token } = await setup()
  const s = runtime.services
  const inspect = s.git.inspect.bind(s.git)
  const add = vi.spyOn(s.git, 'addWorktree')
  vi.spyOn(s.git, 'inspect').mockImplementationOnce(async (...args) => {
    const result = await inspect(...args)
    s.store.update((workspace) => ({ ...workspace, repositories: [] }))
    return result
  })
  const repositories = s.store.get().repositories
  expect((await post({ repositoryId: 'repo', execution: 'worktree' })).status).toBe(409)
  s.store.update((workspace) => ({ ...workspace, repositories }))
  vi.spyOn(s.git, 'inspect').mockImplementationOnce(async (...args) => {
    const result = await inspect(...args)
    const device = s.devices.list().find((entry) => entry.name === 'Paired computer')!
    s.devices.revoke(device.id)
    return result
  })
  expect((await post({ repositoryId: 'repo', execution: 'worktree' }, token)).status).toBe(401)
  expect(add).not.toHaveBeenCalled()
  expect(s.terminals.list()).toEqual([])
})

it('treats the No Project id as home even when its scratch directory is unavailable', async () => {
  const { runtime, post } = await setup()
  for (const registered of [false, true]) {
    if (registered)
      runtime.services.store.update((workspace) => ({
        ...workspace,
        repositories: [
          ...workspace.repositories,
          {
            id: SCRATCH_PROJECT_ID,
            name: 'No Project',
            kind: 'scratch',
            path: '/unavailable/managed-scratch',
            branch: '',
          },
        ],
      }))
    const response = await post({ repositoryId: SCRATCH_PROJECT_ID })
    expect(response.status).toBe(200)
    const terminal = decode(responses.terminal, await response.json())
    expect(terminal.directory).toBe(await realpath(homedir()))
    expect(terminal.repositoryId).toBeUndefined()
    expect((await post({ repositoryId: SCRATCH_PROJECT_ID, execution: 'worktree' })).status).toBe(
      400,
    )
  }
  expect(runtime.services.store.get().tasks).toEqual([])
})

it('preserves and registers the created worktree when pairing is revoked during creation', async () => {
  const { runtime, post, directory } = await setup()
  const s = runtime.services
  s.preferences.save({ worktreesRoot: join(directory, 'managed-worktrees') })
  const common = (
    await s.git.command(directory, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  ).trim()
  const add = s.git.addWorktree.bind(s.git)
  let created: string | undefined
  vi.spyOn(s.git, 'addWorktree').mockImplementationOnce(async (...args) => {
    await add(...args)
    created = await realpath(args[1])
    // Clear the GitService callback's registration to verify the helper records it too.
    s.store.forgetWorktree(common, created)
    const device = s.devices.list().find((entry) => entry.name === 'Paired computer')!
    s.devices.revoke(device.id)
  })
  expect((await post({ repositoryId: 'repo', execution: 'worktree' })).status).toBe(401)
  expect(created).toEqual(expect.any(String))
  expect(s.store.managedWorktrees(common)).toContain(created)
  expect(await s.git.command(directory, ['worktree', 'list', '--porcelain'])).toContain(created)
  expect(s.terminals.list()).toEqual([])
  expect(s.store.get().tasks).toEqual([])
})

it('rejects a missing configured default shell before creating any worktree directory', async () => {
  const { runtime, post, directory } = await setup()
  const s = runtime.services
  const root = join(directory, 'unused-worktrees')
  s.preferences.save({ worktreesRoot: root })
  s.commands.save({ ...s.commands.get(), shell: join(directory, 'missing-shell') })
  const add = vi.spyOn(s.git, 'addWorktree')
  const response = await post({ repositoryId: 'repo', execution: 'worktree' })
  expect(response.status).toBe(400)
  expect(await response.json()).toMatchObject({
    error: 'This shell is not available on the selected computer.',
  })
  expect(add).not.toHaveBeenCalled()
  await expect(readdir(root)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(s.terminals.list()).toEqual([])
})

it.each([
  { failure: new Error('Shell spawn failed'), status: 500 },
  {
    failure: new HttpError(409, 'Close a terminal before opening another (limit 20)'),
    status: 409,
  },
])(
  'keeps and identifies a new worktree when shell creation fails with status $status',
  async ({ failure, status }) => {
    const { runtime, post, directory } = await setup()
    const s = runtime.services
    s.preferences.save({ worktreesRoot: join(directory, 'managed-worktrees') })
    const add = vi.spyOn(s.git, 'addWorktree')
    vi.spyOn(s.terminals, 'createCommand').mockImplementation(() => {
      throw failure
    })
    const response = await post({ repositoryId: 'repo', execution: 'worktree' })
    expect(response.status).toBe(status)
    expect(add).toHaveBeenCalledTimes(1)
    const kept = await realpath(add.mock.calls[0]![1])
    expect(await response.json()).toMatchObject({
      error: `${failure.message}\nWorktree kept at ${kept}`,
    })
    const common = (
      await s.git.command(directory, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
    ).trim()
    expect(s.store.managedWorktrees(common)).toContain(kept)
    expect(await s.git.command(directory, ['worktree', 'list', '--porcelain'])).toContain(kept)
    expect(s.terminals.list()).toEqual([])

    const existing = await post({
      repositoryId: 'repo',
      execution: 'worktree',
      existingWorktreePath: kept,
    })
    expect(existing.status).toBe(status)
    expect(await existing.json()).toMatchObject({ error: failure.message })
    const main = await post({ repositoryId: 'repo' })
    expect(main.status).toBe(status)
    expect(await main.json()).toMatchObject({ error: failure.message })
    expect(add).toHaveBeenCalledTimes(1)
  },
)
