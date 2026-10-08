import { decode } from '@dovo/protocol'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { writeFile, readFile, mkdir, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { startRuntime } from '../../index'
import { fixture } from '../../testing/fixture'
import type { AgentRun } from '../../agents/execution/types'
import { responses } from '@dovo/protocol'
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
it('keeps agents, terminals, review edits, commits and gh inside the selected task checkout', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const ownerToken = 'checkout-test-owner-token-at-least-32-characters'
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken,
    port: 0,
  })
  cleanups.push(() => runtime.close())
  const s = runtime.services
  // Test checkout routing without the developer's interactive login shell/plugins.
  s.commands.save({
    ...s.commands.get(),
    shell: '/bin/sh',
    shellArgs: [],
  })
  s.store.update(() => f.workspace)
  const call = async (path: string, input: unknown) => {
    const response = await fetch(`http://127.0.0.1:${runtime.port}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    })
    const result: unknown = await response.json()
    if (!response.ok) throw new Error(JSON.stringify(result))
    return result
  }
  const main = s.tasks.create({
    title: 'Main',
    agentId: 'agent',
    repositoryId: 'repo',
    objective: 'Work here',
  })
  const isolated = s.tasks.create({
    title: 'Isolated',
    agentId: 'agent',
    repositoryId: 'repo',
    execution: 'worktree',
    objective: 'Work separately',
  })
  const [cwd, same] = await Promise.all([
    s.checkouts.directory(isolated.id),
    s.checkouts.directory(isolated.id),
  ])
  cleanups.push(() =>
    rm(cwd, {
      recursive: true,
      force: true,
    }),
  )
  expect((await s.git.command(cwd, ['branch', '--show-current'])).trim()).toMatch(
    /^dovo\/isolated-[a-f0-9]{8}$/,
  )
  // Readable location: <org or user>/<repo>-<branch>; this fixture repo has no remote.
  expect(cwd).toMatch(/\.dovo\/worktrees\/local\/[\w.-]+-isolated-[a-f0-9]{8}$/)
  expect(cwd).toBe(same)
  const inspect = vi.spyOn(s.git, 'inspect')
  const command = vi.spyOn(s.git, 'command')
  expect(await s.checkouts.directory(isolated.id)).toBe(cwd)
  expect(inspect).not.toHaveBeenCalled()
  expect(command).not.toHaveBeenCalled()
  inspect.mockRestore()
  command.mockRestore()
  expect(cwd).not.toBe(f.directory)
  expect(await s.checkouts.directory(main.id)).toBe(await realpath(f.directory))
  const runs: AgentRun[] = []
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: async () => ({
      provider: 'codex',
      available: true,
      detail: '',
    }),
    run: async (run) => {
      runs.push(run)
      await writeFile(join(run.cwd, 'hello.txt'), 'agent change\n')
    },
  })
  await (
    await s.tasks.start(isolated.id)
  ).done
  expect(runs[0].cwd).toBe(cwd)
  expect(runs[0].agent.instructions).toContain('Use gh for GitHub operations')
  expect(s.store.task(isolated.id).files[0].after).toBe('agent change\n')
  const scope = {
    repositoryId: 'repo',
    taskId: isolated.id,
  }
  await call('/api/scm/apply', {
    ...scope,
    path: 'hello.txt',
    expected: 'agent change\n',
    contents: 'review edit\n',
  })
  const files = decode(responses.files, await call('/api/scm/changes', scope)).files
  expect(files[0].after).toBe('review edit\n')
  s.store.updateTask(isolated.id, (task) => ({
    ...task,
    files: task.files.map((file) => ({ ...file, viewed: true })),
  }))
  const beforeRefresh = s.store.task(isolated.id).files
  await call('/api/scm/changes', scope)
  expect(s.store.task(isolated.id).files).toBe(beforeRefresh)
  expect(s.store.task(isolated.id).files[0].viewed).toBe(true)
  await call('/api/scm/stage', {
    ...scope,
    paths: ['hello.txt'],
  })
  await call('/api/scm/commit', {
    ...scope,
    message: 'Task worktree change',
  })
  expect(await readFile(join(f.directory, 'hello.txt'), 'utf8')).toBe('original\n')
  expect((await s.git.command(f.directory, ['log', '-1', '--format=%s'])).trim()).toBe(
    'Initial fixture',
  )
  expect((await s.git.command(cwd, ['log', '-1', '--format=%s'])).trim()).toBe(
    'Task worktree change',
  )
  const terminal = decode(
    responses.terminal,
    await call('/api/terminals', {
      taskId: isolated.id,
    }),
  )
  s.terminals.input(terminal.id, 'printf \'CHECKOUT:%s:END\\n\' "$PWD"\r')
  await vi.waitFor(() =>
    expect(s.terminals.get(terminal.id).buffer).toContain(`CHECKOUT:${cwd}:END`),
  )
  await s.terminals.close(terminal.id)
  const bin = join(f.directory, '.git', 'fake-bin')
  await mkdir(bin)
  await writeFile(
    join(bin, 'gh'),
    '#!/bin/sh\nif [ -n "$GH_REPO" ]; then exit 9; fi\nprintf \'[{"number":1,"title":"%s","url":"https://github.com/test/project/pull/1","state":"OPEN","headRefName":"task"}]\' "$PWD"\n',
    {
      mode: 0o755,
    },
  )
  vi.stubEnv('PATH', `${bin}:${process.env.PATH}`)
  vi.stubEnv('GH_REPO', 'wrong/project')
  vi.stubEnv('GIT_DIR', '/missing/wrong-project')
  expect(decode(responses.pulls, await call('/api/scm/pulls', scope)).pulls[0].title).toBe(cwd)
  expect(await s.checkouts.directory(isolated.id)).toBe(cwd)
})

it('starts worktrees from the local branch, or with Start from origin from the latest origin branch', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'worktree-base-test-owner-token-32-characters',
    port: 0,
  })
  cleanups.push(() => runtime.close())
  const s = runtime.services
  s.store.update(() => f.workspace)
  const git = (...args: string[]) => s.git.command(f.directory, args).then((out) => out.trim())
  const current = await git('branch', '--show-current')
  // origin gets a commit this clone has not fetched yet.
  const origin = join(f.directory, '..', `${f.directory.split('/').pop()}-origin.git`)
  cleanups.push(() => rm(origin, { recursive: true, force: true }))
  await git('clone', '--quiet', '--bare', f.directory, origin)
  const bare = (...args: string[]) =>
    s.git.command(f.directory, ['--git-dir', origin, ...args]).then((out) => out.trim())
  await bare('config', 'user.name', 'Dovo Test')
  await bare('config', 'user.email', 'test@example.invalid')
  const remote = await bare('commit-tree', `${current}^{tree}`, '-p', current, '-m', 'Remote work')
  await bare('update-ref', `refs/heads/${current}`, remote)
  await git('remote', 'add', 'origin', origin)
  await writeFile(join(f.directory, 'hello.txt'), 'local branch only\n')
  await git('commit', '-am', 'Local branch work')
  const local = await git('rev-parse', 'HEAD')
  await git('branch', 'chosen-base')
  const make = async (fromOrigin: boolean, base?: string) => {
    const task = s.tasks.create({
      title: 'Base test',
      repositoryId: 'repo',
      agentId: 'agent',
      objective: 'Start test',
      execution: 'worktree',
    })
    s.store.update((w) => ({
      ...w,
      tasks: w.tasks.map((t) =>
        t.id === task.id ? { ...t, worktreeBaseBranch: base, worktreeFromOrigin: fromOrigin } : t,
      ),
    }))
    const cwd = await s.checkouts.directory(task.id)
    cleanups.push(() => rm(cwd, { recursive: true, force: true }))
    return (await s.git.command(cwd, ['rev-parse', 'HEAD'])).trim()
  }
  expect(await make(false)).toBe(local)
  // Fetched first, so the worktree starts from origin's newest commit.
  expect(await make(true)).toBe(remote)
  // A branch origin does not have falls back to origin's detected default branch.
  await git('checkout', '--quiet', '-b', 'feature-only-here')
  expect(await make(true)).toBe(remote)
  expect(await make(false)).toBe(local)
  expect(await make(true, 'refs/heads/chosen-base')).toBe(local)
  await expect(make(false, 'refs/heads/missing')).rejects.toThrow('Choose an existing base branch')
  expect(await git('rev-parse', 'HEAD')).toBe(local)
})

it('snapshots project defaults and retries failed worktree setup without rerunning completed setup', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'setup-test-owner-token-at-least-32-characters',
    port: 0,
  })
  cleanups.push(() => runtime.close())
  const s = runtime.services
  s.commands.save({ ...s.commands.get(), shell: '/bin/sh', shellArgs: [] })
  s.store.update(() => ({
    ...f.workspace,
    repositories: f.workspace.repositories.map((repo) => ({
      ...repo,
      taskDefaults: {
        execution: 'worktree',
        setupCommand:
          'if [ ! -f setup-attempt ]; then touch setup-attempt; exit 1; fi\nprintf done >> setup-result',
      },
    })),
  }))
  const task = s.tasks.create({
    title: 'Setup',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Start test',
  })
  expect(task.execution).toBe('worktree')
  expect(task.setupCommand).toContain('setup-attempt')
  s.store.update((w) => ({
    ...w,
    repositories: w.repositories.map((repo) => ({
      ...repo,
      taskDefaults: { setupCommand: 'exit 9' },
    })),
  }))
  await expect(s.checkouts.directory(task.id)).rejects.toThrow('Worktree setup failed')
  expect(s.store.task(task.id).worktreeSetupComplete).toBeUndefined()
  const cwd = await s.checkouts.directory(task.id)
  cleanups.push(() => rm(cwd, { recursive: true, force: true }))
  expect(await readFile(join(cwd, 'setup-result'), 'utf8')).toBe('done')
  expect(s.store.task(task.id).worktreeSetupComplete).toBe(true)
  await s.checkouts.directory(task.id)
  expect(await readFile(join(cwd, 'setup-result'), 'utf8')).toBe('done')
  await expect(readFile(join(f.directory, 'setup-result'), 'utf8')).rejects.toThrow('ENOENT')
})
it('publishes worktree setup progress step by step and clears it once the agent starts', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'progress-test-owner-token-at-least-32-characters',
    port: 0,
  })
  cleanups.push(() => runtime.close())
  const s = runtime.services
  s.commands.save({ ...s.commands.get(), shell: '/bin/sh', shellArgs: [] })
  s.store.update(() => f.workspace)
  const task = s.tasks.create({
    title: 'Progress',
    repositoryId: 'repo',
    agentId: 'agent',
    execution: 'worktree',
    objective: 'Show progress',
  })
  s.store.updateTask(task.id, (value) => ({ ...value, setupCommand: 'printf ready > setup-ok' }))
  const seen: string[] = []
  const stepLists = new Set<string>()
  const update = s.store.update.bind(s.store)
  vi.spyOn(s.store, 'update').mockImplementation((...args) => {
    const next = update(...args)
    const current = next.tasks.find((item) => item.id === task.id)?.preparation
    if (current) stepLists.add(current.steps.join(','))
    if (current && seen.at(-1) !== current.current) seen.push(current.current)
    return next
  })
  let during: unknown = 'not run'
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: async () => ({ provider: 'codex', available: true, detail: '' }),
    run: async (run) => {
      cleanups.push(() => rm(run.cwd, { recursive: true, force: true }))
      during = s.store.task(task.id).preparation
    },
  })
  await (
    await s.tasks.start(task.id)
  ).done
  expect(seen).toEqual(['worktree', 'setup', 'agent'])
  expect([...stepLists]).toEqual(['worktree,setup,agent'])
  expect(during).toBeUndefined()
  expect(s.store.task(task.id).preparation).toBeUndefined()
})
it('keeps a failed setup step visible and clears it when a retry succeeds', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'retry-test-owner-token-at-least-32-characters',
    port: 0,
  })
  cleanups.push(() => runtime.close())
  const s = runtime.services
  s.commands.save({ ...s.commands.get(), shell: '/bin/sh', shellArgs: [] })
  s.store.update(() => f.workspace)
  const task = s.tasks.create({
    title: 'Retry',
    repositoryId: 'repo',
    agentId: 'agent',
    execution: 'worktree',
    objective: 'Retry setup',
  })
  // Fails the first time, succeeds once the marker exists.
  s.store.updateTask(task.id, (value) => ({
    ...value,
    setupCommand: 'if [ ! -f attempted ]; then touch attempted; exit 3; fi',
  }))
  const agent = vi.fn<(run: AgentRun) => Promise<void>>(async (run) => {
    cleanups.push(() => rm(run.cwd, { recursive: true, force: true }))
  })
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: async () => ({ provider: 'codex', available: true, detail: '' }),
    run: agent,
  })
  await expect(s.tasks.start(task.id)).rejects.toThrow('Worktree setup failed')
  expect(s.store.task(task.id)).toMatchObject({
    status: 'failed',
    preparation: { current: 'setup', failed: true },
  })
  expect(agent).not.toHaveBeenCalled()
  await (
    await s.tasks.start(task.id)
  ).done
  expect(agent).toHaveBeenCalledOnce()
  expect(s.store.task(task.id).preparation).toBeUndefined()
})

it('invalidates prepared checkouts when a folder project path changes', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const first = join(f.directory, 'first'),
    second = join(f.directory, 'second')
  await Promise.all([mkdir(first), mkdir(second)])
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'checkout-path-test-token-at-least-32-characters',
    port: 0,
  })
  cleanups.push(() => runtime.close())
  const s = runtime.services
  s.store.update(() => ({
    ...f.workspace,
    repositories: [{ id: 'repo', name: 'Folder', kind: 'folder', path: first, branch: '' }],
  }))
  const task = s.tasks.create({
    title: 'Path change',
    agentId: 'agent',
    repositoryId: 'repo',
    objective: 'Use selected folder',
  })
  expect(await s.checkouts.directory(task.id)).toBe(await realpath(first))
  s.store.patch({
    collection: 'repositories',
    id: 'repo',
    changes: { path: { before: first, after: second } },
  })
  expect(await s.checkouts.selectedDirectory(task.id)).toBe(await realpath(second))
  const directories: string[] = []
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: async () => ({ provider: 'codex', available: true, detail: '' }),
    run: async (run) => {
      directories.push(run.cwd)
    },
  })
  await (
    await s.tasks.start(task.id)
  ).done
  expect(directories).toEqual([await realpath(second)])
})

it('populates worktree submodules before setup and does not repeat initialization', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'submodule-checkout-owner-token-long-enough',
    port: 0,
  })
  cleanups.push(() => runtime.close())
  const s = runtime.services
  s.store.update(() => f.workspace)
  s.defaults.save(
    {
      ...s.defaults.get(),
      scopedSettings: {
        shared: [],
        environment: { taskDefaults: { submodules: 'recursive', execution: 'worktree' } },
      },
    },
    false,
  )
  const task = s.tasks.create({
    title: 'Submodules',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Work',
  })
  const command = vi.spyOn(s.git, 'command')
  const cwd = await s.checkouts.directory(task.id)
  cleanups.push(() => rm(cwd, { recursive: true, force: true }))
  expect(
    command.mock.calls.some(
      ([path, args]) => path === cwd && args.join(' ') === 'submodule update --init --recursive',
    ),
  ).toBe(true)
  expect(s.store.task(task.id).worktreeSubmodulesComplete).toBe(true)
  command.mockClear()
  await s.checkouts.directory(task.id)
  expect(command.mock.calls.some(([, args]) => args[0] === 'submodule')).toBe(false)
})
