import { Effect } from 'effect'
import { runtimeFailure } from '../../errors'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture } from '../../testing/fixture'
import { startRuntime } from '../../index'
import { createPullTask } from './pull-task'
import { listWorktreesEffect } from '../git/worktrees'
import {
  canChangeTaskCheckout,
  canChangeTaskProvider,
  defaultTaskHarness,
  resolveTaskAgent,
  type PullDetail,
} from '@dovo/protocol'
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
async function setup() {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'pull-task-test-owner-token-at-least-32-characters',
    port: 0,
  })
  cleanups.push(() => runtime.close())
  const s = runtime.services
  s.store.update(() => f.workspace)
  return { f, s, runtime }
}
function detail(sha: string, base: string): PullDetail {
  return {
    pull: {
      number: 7,
      title: 'Fix runtime',
      url: 'https://github.com/test/repo/pull/7',
      repositoryUrl: 'https://github.com/test/repo',
      headSha: sha,
      baseSha: base,
      state: 'open',
      draft: false,
      author: 'reviewer',
      updatedAt: '2026-09-07T10:00:00Z',
      head: 'test:fix',
      base: 'test:main',
      labels: [],
      body: 'Fix the cancellation race',
      additions: 1,
      deletions: 1,
      changedFiles: 1,
      mergeable: true,
      reviewers: [],
      assignees: [],
    },
    files: [],
    checks: [],
    warnings: [],
    comments: [
      {
        id: 'inline-1',
        author: 'reviewer',
        body: 'Keep cancellation idempotent',
        kind: 'inline',
        date: '2026-09-07T10:00:00Z',
        url: 'https://github.com/test/repo/pull/7#discussion-1',
        path: 'hello.txt',
        line: 1,
      },
    ],
  }
}
it('creates a linked task at the PR head and leaves main edits untouched on first run and resume', async () => {
  const { f, s } = await setup()
  const base = (await s.git.command(f.directory, ['rev-parse', 'HEAD'])).trim()
  await writeFile(join(f.directory, 'hello.txt'), 'PR commit\n')
  await s.git.stage(f.directory, ['hello.txt'])
  await s.git.commit(f.directory, 'PR head')
  const sha = (await s.git.command(f.directory, ['rev-parse', 'HEAD'])).trim()
  await s.git.command(f.directory, ['checkout', '--detach', base])
  await writeFile(join(f.directory, 'hello.txt'), 'Unrelated local edit\n')
  const loadDetail = vi.spyOn(s.pulls, 'detail').mockResolvedValue(detail(sha, base))
  await s.git.command(f.directory, ['update-ref', 'refs/pull/7/head', sha])
  const command = s.git.command.bind(s.git)
  vi.spyOn(s.git, 'command').mockImplementation((cwd, args) =>
    command(
      cwd,
      args.includes('fetch')
        ? ['-c', `url.${f.directory}/.git.insteadOf=https://github.com/test/repo.git`, ...args]
        : args,
    ),
  )
  const fetch = vi.spyOn(s.git, 'fetchPull')
  const { id } = await createPullTask(s, 'repo', f.directory, {
    number: 7,
    headSha: sha,
    agentId: 'agent',
    objective: 'Address review feedback',
    run: false,
  })
  expect(s.store.task(id)).toMatchObject({
    execution: 'worktree',
    worktreeFromOrigin: false,
    status: 'draft',
    pullRequest: { number: 7, headSha: sha, headBranch: 'test:fix' },
  })
  expect(s.store.task(id).messages).toEqual([])
  expect(s.store.task(id).draft).toBe(
    'Address review feedback\n\nhttps://github.com/test/repo/pull/7',
  )
  expect(canChangeTaskProvider(s.store.task(id))).toBe(true)
  expect(canChangeTaskCheckout(s.store.task(id))).toBe(false)
  // A saved origin preference and unrelated base selection must never replace the PR head.
  s.store.updateTask(id, (task) => ({
    ...task,
    worktreeFromOrigin: true,
    worktreeBaseBranch: 'refs/remotes/origin/main',
  }))
  const cwd = await s.checkouts.directory(id)
  cleanups.push(() => rm(cwd, { recursive: true, force: true }))
  expect((await s.git.command(cwd, ['rev-parse', 'HEAD'])).trim()).toBe(sha)
  expect(await readFile(join(cwd, 'hello.txt'), 'utf8')).toBe('PR commit\n')
  expect(await readFile(join(f.directory, 'hello.txt'), 'utf8')).toBe('Unrelated local edit\n')
  expect((await s.git.command(f.directory, ['rev-parse', 'HEAD'])).trim()).toBe(base)
  await writeFile(join(cwd, 'hello.txt'), 'Task draft\n')
  expect(await s.checkouts.directory(id)).toBe(cwd)
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(fetch).toHaveBeenCalledWith(
    f.directory,
    'https://github.com/test/repo',
    7,
    expect.stringMatching(/^refs\/dovo\/pull-tasks\//),
    expect.objectContaining({ headBranch: 'test:fix', headSha: sha }),
  )
  expect(await readFile(join(cwd, 'hello.txt'), 'utf8')).toBe('Task draft\n')
  expect(canChangeTaskProvider(s.store.task(id))).toBe(true)
  expect(s.store.task(id).providerLock).toBeUndefined()
  loadDetail.mockResolvedValue(detail(base, base))
  const stale = await createPullTask(s, 'repo', f.directory, {
    number: 7,
    headSha: base,
    agentId: 'agent',
    objective: 'Review',
    run: false,
  })
  await expect(s.checkouts.directory(stale.id)).rejects.toThrow('PR head changed before checkout')
  expect((await s.git.command(f.directory, ['rev-parse', 'HEAD'])).trim()).toBe(base)
  expect(await readFile(join(f.directory, 'hello.txt'), 'utf8')).toBe('Unrelated local edit\n')
})
it('rejects changed PRs before creating a task, and keeps tasks whose startup fails', async () => {
  const { f, s } = await setup(),
    sha = 'a'.repeat(40)
  vi.spyOn(s.pulls, 'detail').mockResolvedValue(detail(sha, 'b'.repeat(40)))
  await expect(
    createPullTask(s, 'repo', f.directory, {
      number: 7,
      headSha: 'c'.repeat(40),
      agentId: 'agent',
      objective: 'Review',
      run: false,
    }),
  ).rejects.toThrow('This PR changed')
  expect(s.store.get().tasks).toHaveLength(0)
  vi.spyOn(s.tasks, 'startEffect').mockReturnValue(
    Effect.fail(runtimeFailure(new Error('Fetch denied'))),
  )
  const result = await createPullTask(s, 'repo', f.directory, {
    number: 7,
    headSha: sha,
    agentId: 'agent',
    objective: 'Review',
    run: true,
  })
  expect(result.error).toBe('Fetch denied')
  expect(s.store.task(result.id)).toMatchObject({ status: 'failed', error: 'Fetch denied' })
  expect(s.store.task(result.id).messages[0].text).toBe(
    'Review\n\nhttps://github.com/test/repo/pull/7',
  )
  expect(s.store.task(result.id).draft).toBe('')
  expect(s.store.task(result.id).providerLock).toBe('codex')
  expect(() =>
    s.store.patch({
      collection: 'tasks',
      id: 'forged',
      changes: {},
      create: { ...s.store.task(result.id), id: 'forged', status: 'draft' },
    }),
  ).toThrow('New tasks must be drafts')
})

it('opens a PR draft without configured agents and allows choosing its agent before sending', async () => {
  const { f, s } = await setup(),
    sha = 'a'.repeat(40)
  s.store.update((workspace) => ({ ...workspace, agents: [] }))
  vi.spyOn(s.pulls, 'detail').mockResolvedValue(detail(sha, 'b'.repeat(40)))
  const start = vi.spyOn(s.tasks, 'startEffect')
  const { id } = await createPullTask(s, 'repo', f.directory, {
    number: 7,
    headSha: sha,
    objective: 'Review this change',
  })
  const task = s.store.task(id)
  expect(start).not.toHaveBeenCalled()
  expect(task).toMatchObject({
    agentId: '',
    harness: defaultTaskHarness('codex'),
    status: 'draft',
    messages: [],
    pullRequest: { number: 7, headSha: sha },
  })
  expect(task.draft).toBe('Review this change\n\nhttps://github.com/test/repo/pull/7')
  expect(task.providerLock).toBeUndefined()
  expect(canChangeTaskProvider(task)).toBe(true)
  expect(canChangeTaskCheckout(task)).toBe(false)
  s.store.update((workspace) => ({
    ...workspace,
    agents: [{ ...defaultTaskHarness('claude'), id: 'custom', name: 'Custom reviewer' }],
  }))
  s.store.patch({
    collection: 'tasks',
    id,
    changes: {
      agentId: { before: '', after: 'custom' },
      harness: { before: task.harness, after: null },
    },
  })
  expect(resolveTaskAgent(s.store.task(id), s.store.get().agents)?.provider).toBe('claude')
  expect(s.store.task(id).providerLock).toBeUndefined()
  s.tasks.queue.add(id, 'first-input', task.draft)
  expect(s.store.task(id).providerLock).toBe('claude')
  expect(canChangeTaskProvider(s.store.task(id))).toBe(false)
  expect(() =>
    s.store.patch({
      collection: 'tasks',
      id,
      changes: { harness: { before: null, after: defaultTaskHarness('codex') } },
    }),
  ).toThrow('same provider')
  expect(s.store.task(id).pullRequest).toEqual(task.pullRequest)
})

it('accepts a built-in harness directly and rejects missing or ambiguous saved agents', async () => {
  const { f, s } = await setup(),
    sha = 'a'.repeat(40)
  vi.spyOn(s.pulls, 'detail').mockResolvedValue(detail(sha, 'b'.repeat(40)))
  const input = { number: 7, headSha: sha, objective: 'Review' }
  const harness = { ...defaultTaskHarness('opencode'), model: 'selected-model' }
  const { id } = await createPullTask(s, 'repo', f.directory, { ...input, harness })
  expect(s.store.task(id).harness).toEqual(harness)
  expect(s.store.task(id).messages).toEqual([])
  await expect(
    createPullTask(s, 'repo', f.directory, { ...input, agentId: 'missing' }),
  ).rejects.toThrow('Choose an existing agent')
  await expect(
    createPullTask(s, 'repo', f.directory, { ...input, agentId: 'agent', harness }),
  ).rejects.toThrow('either a saved agent or a built-in harness')
  expect(s.store.get().tasks).toHaveLength(1)
})
it('uses the actual PR branch, pushes to its fork, and restores committed work without touching the project checkout', async () => {
  const { f, s, runtime } = await setup()
  const git = (...args: string[]) => s.git.command(f.directory, args).then((out) => out.trim())
  const base = await git('rev-parse', 'HEAD')
  await writeFile(join(f.directory, 'hello.txt'), 'PR commit\n')
  await git('commit', '-am', 'PR head')
  const sha = await git('rev-parse', 'HEAD')
  const fork = join(f.directory, '.git', 'fork.git')
  await git('clone', '--quiet', '--bare', f.directory, fork)
  await git('--git-dir', fork, 'update-ref', 'refs/heads/fix', sha)
  await git('--git-dir', fork, 'update-ref', 'refs/pull/7/head', sha)
  await git('checkout', '--detach', base)
  await writeFile(join(f.directory, 'hello.txt'), 'Unrelated local edit\n')
  const source = detail(sha, base)
  source.pull.headCloneUrl = 'https://github.com/contributor/fork.git'
  vi.spyOn(s.pulls, 'detail').mockResolvedValue(source)
  await git('config', `url.${fork}.insteadOf`, source.pull.headCloneUrl)
  await git('config', '--add', `url.${fork}.insteadOf`, 'https://github.com/test/repo.git')
  vi.spyOn(s.git, 'githubEnvironment').mockResolvedValue({})
  const fetchPull = vi.spyOn(s.git, 'fetchPull')
  const input = {
    number: 7,
    headSha: sha,
    objective: 'I want to work on this PR.',
    checkoutMode: 'pr-branch',
  }
  const { id } = await createPullTask(s, 'repo', f.directory, input)
  expect(s.store.task(id).pullRequest).toMatchObject({
    checkoutMode: 'pr-branch',
    headBranch: 'test:fix',
    headCloneUrl: source.pull.headCloneUrl,
  })
  const command = s.git.command.bind(s.git)
  let failUpstream = true
  vi.spyOn(s.git, 'command').mockImplementation((cwd, args, env) => {
    if (failUpstream && args[0] === 'config' && args[1] === 'branch.fix.remote') {
      failUpstream = false
      return Promise.reject(new Error('Upstream setup interrupted'))
    }
    return command(cwd, args, env)
  })
  await expect(s.checkouts.directory(id)).rejects.toThrow('Upstream setup interrupted')
  const cwd = await s.checkouts.directory(id)
  cleanups.push(() => rm(cwd, { recursive: true, force: true }))
  expect((await s.git.command(cwd, ['branch', '--show-current'])).trim()).toBe('fix')
  expect((await s.git.command(cwd, ['rev-parse', 'HEAD'])).trim()).toBe(sha)
  expect(
    (await Effect.runPromise(listWorktreesEffect(s))).worktrees.find((item) => item.path === cwd)
      ?.taskId,
  ).toBe(id)
  await writeFile(join(cwd, 'hello.txt'), 'Direct update\n')
  await s.git.command(cwd, ['commit', '-am', 'Update the PR'])
  const updated = (await s.git.command(cwd, ['rev-parse', 'HEAD'])).trim()
  const pushed = await fetch(`http://127.0.0.1:${runtime.port}/api/scm/push`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer pull-task-test-owner-token-at-least-32-characters',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ repositoryId: 'repo', taskId: id }),
  })
  expect(pushed.status).toBe(200)
  expect(await pushed.json()).toEqual({ ok: true })
  expect(await git('--git-dir', fork, 'rev-parse', 'refs/heads/fix')).toBe(updated)
  expect((await s.git.command(cwd, ['rev-parse', '@{upstream}'])).trim()).toBe(updated)
  expect(await readFile(join(f.directory, 'hello.txt'), 'utf8')).toBe('Unrelated local edit\n')
  expect(await git('rev-parse', 'HEAD')).toBe(base)
  await expect(createPullTask(s, 'repo', f.directory, input)).rejects.toThrow(
    'already checked out elsewhere',
  )
  expect(await git('rev-parse', 'refs/heads/fix')).toBe(updated)
  await rm(cwd, { recursive: true, force: true })
  expect(await s.checkouts.directory(id)).toBe(cwd)
  expect((await s.git.command(cwd, ['rev-parse', 'HEAD'])).trim()).toBe(updated)
  expect(await readFile(join(cwd, 'hello.txt'), 'utf8')).toBe('Direct update\n')
  expect(fetchPull).toHaveBeenCalledTimes(2)
})

it('keeps divergent local PR branches and rejects direct checkout when source details are unavailable', async () => {
  const { f, s } = await setup()
  const base = (await s.git.command(f.directory, ['rev-parse', 'HEAD'])).trim()
  await s.git.command(f.directory, ['branch', 'fix', base])
  const source = detail('a'.repeat(40), base)
  source.pull.headCloneUrl = 'https://github.com/test/repo.git'
  const read = vi.spyOn(s.pulls, 'detail').mockResolvedValue(source)
  const input = {
    number: 7,
    headSha: source.pull.headSha,
    objective: 'Work on this PR',
    checkoutMode: 'pr-branch',
  }
  await expect(createPullTask(s, 'repo', f.directory, input)).rejects.toThrow('differs from the PR')
  expect(s.store.get().tasks).toHaveLength(0)
  expect((await s.git.command(f.directory, ['rev-parse', 'fix'])).trim()).toBe(base)
  await s.git.command(f.directory, [
    'remote',
    'add',
    'elsewhere',
    'https://github.com/other/repo.git',
  ])
  await s.git.command(f.directory, ['config', 'branch.fix.remote', 'elsewhere'])
  await s.git.command(f.directory, ['config', 'branch.fix.merge', 'refs/heads/fix'])
  await s.git.command(f.directory, ['update-ref', 'refs/remotes/elsewhere/fix', base])
  read.mockResolvedValue({ ...source, pull: { ...source.pull, headSha: base } })
  await expect(createPullTask(s, 'repo', f.directory, { ...input, headSha: base })).rejects.toThrow(
    'tracks a different destination',
  )
  expect((await s.git.command(f.directory, ['config', 'branch.fix.remote'])).trim()).toBe(
    'elsewhere',
  )
  read.mockResolvedValue(detail(source.pull.headSha, base))
  await expect(createPullTask(s, 'repo', f.directory, input)).rejects.toThrow(
    'source repository is unavailable',
  )
  await expect(
    createPullTask(s, 'repo', f.directory, { ...input, checkoutMode: 'unknown' }),
  ).rejects.toThrow('checkoutMode')
})

it('creates an editable stack-update draft from fresh dependencies and rejects a disappeared stack', async () => {
  const { f, s } = await setup()
  const sha = 'a'.repeat(40),
    base = 'b'.repeat(40)
  vi.spyOn(s.pulls, 'detail').mockResolvedValue(detail(sha, base))
  vi.spyOn(s.pulls, 'identity').mockResolvedValue('test-repo-account')
  const parent = {
    ...detail(sha, base).pull,
    number: 6,
    url: 'https://github.com/test/repo/pull/6',
    head: 'test:parent',
  }
  vi.spyOn(s.pulls, 'list').mockResolvedValue({
    pulls: [parent, { ...detail(sha, base).pull, base: 'test:parent' }],
    hasMore: false,
    page: 1,
  })
  const result = await createPullTask(s, 'repo', f.directory, {
    number: 7,
    headSha: sha,
    objective: 'Update stack',
    stackAction: 'update',
    run: false,
  })
  expect(s.store.task(result.id)).toMatchObject({
    status: 'draft',
    title: 'Update stack from PR #6',
    messages: [],
  })
  expect(s.store.task(result.id).draft).toContain('--force-with-lease=<ref>:<expected-tip>')
  expect(s.store.task(result.id).draft).toContain('https://github.com/test/repo/pull/6')
  vi.spyOn(s.pulls, 'list').mockResolvedValue({ pulls: [], hasMore: false, page: 1 })
  await expect(
    createPullTask(s, 'repo', f.directory, {
      number: 7,
      headSha: sha,
      objective: 'Update stack',
      stackAction: 'update',
      run: false,
    }),
  ).rejects.toThrow('no longer part')
})
