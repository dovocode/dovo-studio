import { decode } from '@dovo/protocol'
import { afterEach, expect, it, vi } from 'vitest'
import { writeFile, readFile, mkdir, realpath, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { startRuntime } from '../index'
import { fixture } from '../testing/fixture'
import type { AgentRun } from '../agents/types'
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
    rm(dirname(cwd), {
      recursive: true,
      force: true,
    }),
  )
  expect((await s.git.command(cwd, ['branch', '--show-current'])).trim()).toMatch(
    /^dovo\/isolated-[a-f0-9]{24}$/,
  )
  expect(cwd).toBe(same)
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
  s.terminals.close(terminal.id)
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

it('bases new worktrees on origin/main, then origin/master, or the explicitly selected branch', async () => {
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
  const initial = (await s.git.command(f.directory, ['rev-parse', 'HEAD'])).trim()
  await s.git.command(f.directory, ['update-ref', 'refs/remotes/origin/main', initial])
  await s.git.command(f.directory, ['update-ref', 'refs/remotes/origin/master', initial])
  await writeFile(join(f.directory, 'hello.txt'), 'local branch only\n')
  await s.git.command(f.directory, ['commit', '-am', 'Local branch work'])
  const local = (await s.git.command(f.directory, ['rev-parse', 'HEAD'])).trim()
  await s.git.command(f.directory, ['branch', 'chosen-base'])
  const make = async (base?: string) => {
    const task = s.tasks.create({
      title: 'Base test',
      repositoryId: 'repo',
      agentId: 'agent',
      objective: 'Start test',
      execution: 'worktree',
    })
    s.store.update((w) => ({
      ...w,
      tasks: w.tasks.map((t) => (t.id === task.id ? { ...t, worktreeBaseBranch: base } : t)),
    }))
    const cwd = await s.checkouts.directory(task.id)
    cleanups.push(() => rm(cwd, { recursive: true, force: true }))
    return (await s.git.command(cwd, ['rev-parse', 'HEAD'])).trim()
  }
  expect(await make()).toBe(initial)
  await s.git.command(f.directory, ['update-ref', '-d', 'refs/remotes/origin/main'])
  expect(await make()).toBe(initial)
  expect(await make('refs/heads/chosen-base')).toBe(local)
  await expect(make('refs/heads/missing')).rejects.toThrow('Choose an existing base branch')
  expect((await s.git.command(f.directory, ['rev-parse', 'HEAD'])).trim()).toBe(local)
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
