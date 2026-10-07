import { afterEach, expect, it, vi } from 'vite-plus/test'
import { writeFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture } from '../../../testing/fixture'
import { startRuntime } from '../../../index'
import type { AgentRun, AgentAdapter } from '../../../agents/execution/types'
import { runtimeIntegration } from '../../../testing/integration'
vi.setConfig(runtimeIntegration)
const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
})
it('isolates named and wrapper accounts across repositories, worktrees, pushes and agent turns', async () => {
  const personal = await fixture(),
    work = await fixture()
  cleanup.push(personal.cleanup, work.cleanup)
  const gh = join(personal.directory, 'fixture-gh.cjs')
  await writeFile(
    gh,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
const userIndex = args.indexOf('--user');
const login = process.env.GH_ACCOUNT || (userIndex >= 0 ? args[userIndex + 1] : process.env.GH_TOKEN?.replace('fixture-token-', ''));
if (args[0] === 'auth' && args[1] === 'token') {
  if (!login || process.env.GH_TOKEN && userIndex >= 0) process.exit(7);
  process.stdout.write('fixture-token-' + login);
} else if (args[0] === 'api' && args.at(-1) === 'user') {
  process.stdout.write(JSON.stringify({login}));
} else if (args[0] === 'api' && args.at(-1).startsWith('user/repos')) {
  process.stdout.write(JSON.stringify([{id:1,name:'app',full_name:login+'/app',html_url:'https://github.com/'+login+'/app',clone_url:'https://github.com/'+login+'/app.git',default_branch:'main'}]));
} else process.exit(8);
`,
    { mode: 0o700 },
  )
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'github-account-fixture-owner-token-with-32-characters',
    port: 0,
  })
  cleanup.push(() => runtime.close())
  const s = runtime.services
  s.commands.save({ ...s.commands.get(), gh })
  const named = s.forges.save({
    name: 'Personal',
    provider: 'github',
    baseUrl: 'https://github.com',
    credential: 'gh',
    cliProfile: 'personal',
  })
  const wrapper = s.forges.save({
    name: 'Work',
    provider: 'github',
    baseUrl: 'https://github.com',
    credential: 'gh-wrapper',
    cliEnv: { GH_ACCOUNT: 'work' },
  })
  personal.workspace.repositories = [
    {
      ...personal.workspace.repositories[0]!,
      path: await realpath(personal.directory),
      forge: { connectionId: named.id, repository: 'personal/app', revision: named.revision },
    },
    {
      ...work.workspace.repositories[0]!,
      id: 'work',
      path: await realpath(work.directory),
      forge: { connectionId: wrapper.id, repository: 'work/app', revision: wrapper.revision },
    },
  ]
  s.store.update(() => personal.workspace)
  vi.stubEnv('GH_TOKEN', 'ambient-token')
  const originalSelector = process.env.GH_ACCOUNT
  const [first, second] = await Promise.all([
    s.git.github(personal.directory, ['api', '--hostname', 'github.com', 'user']),
    s.git.github(work.directory, ['api', '--hostname', 'github.com', 'user']),
  ])
  expect(JSON.parse(first)).toEqual({ login: 'personal' })
  expect(JSON.parse(second)).toEqual({ login: 'work' })
  // Selecting a new account from another project's checkout must not inherit its wrapper selector.
  const listed = await s.pulls.adapter(named.id, 'personal/app', work.directory).repositories(1)
  expect(listed.repositories[0]?.fullName).toBe('personal/app')
  const worktree = join(work.directory, 'linked-checkout')
  await s.git.command(work.directory, ['worktree', 'add', '--detach', worktree])
  expect(await s.git.githubEnvironment(worktree)).toMatchObject({
    GH_ACCOUNT: 'work',
    GH_TOKEN: 'fixture-token-work',
  })
  const personalIdentity = await s.pulls.identity(personal.directory)
  const workIdentity = await s.pulls.identity(worktree)
  expect(personalIdentity).not.toBe(workIdentity)
  expect(personalIdentity).toContain('personal')
  expect(workIdentity).toContain('work')
  expect(personalIdentity + workIdentity).not.toContain('fixture-token')
  await s.git.command(work.directory, [
    'remote',
    'add',
    'origin',
    'https://github.com/work/app.git',
  ])
  const command = s.git.command.bind(s.git)
  const push = vi
    .spyOn(s.git, 'command')
    .mockImplementation(async (cwd, args, env) =>
      args.includes('push') ? '' : command(cwd, args, env),
    )
  await s.git.push(work.directory)
  expect(push).toHaveBeenCalledWith(
    expect.any(String),
    expect.arrayContaining(['push']),
    expect.objectContaining({ GH_ACCOUNT: 'work', GH_TOKEN: 'fixture-token-work' }),
  )
  push.mockRestore()
  const runs: AgentRun[] = []
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      runs.push(run)
      run.onText('Done')
    },
  })
  const task = s.tasks.create({
    title: 'Work',
    repositoryId: 'work',
    agentId: 'agent',
    objective: 'Check',
  })
  await (
    await s.tasks.start(task.id)
  ).done
  expect(runs[0]?.agent.env).toMatchObject({ GH_ACCOUNT: 'work', GH_TOKEN: 'fixture-token-work' })
  expect(JSON.stringify(s.store.get())).not.toContain('fixture-token-work')
  expect(JSON.stringify(s.forges.list())).not.toContain('fixture-token')
  expect(process.env.GH_TOKEN).toBe('ambient-token')
  expect(process.env.GH_ACCOUNT).toBe(originalSelector)
})
