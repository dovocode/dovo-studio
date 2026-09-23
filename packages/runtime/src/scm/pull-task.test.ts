import { Effect } from 'effect'
import { runtimeFailure } from '../errors'
import { afterEach, expect, it, vi } from 'vitest'
import { writeFile, readFile, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fixture } from '../testing/fixture'
import { startRuntime } from '../index'
import { createPullTask } from './pull-task'
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
  return { f, s }
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
    status: 'draft',
    pullRequest: { number: 7, headSha: sha },
  })
  expect(s.store.task(id).messages).toEqual([])
  expect(s.store.task(id).draft).toContain('Keep cancellation idempotent')
  expect(canChangeTaskProvider(s.store.task(id))).toBe(true)
  expect(canChangeTaskCheckout(s.store.task(id))).toBe(false)
  const cwd = await s.checkouts.directory(id)
  cleanups.push(() => rm(dirname(cwd), { recursive: true, force: true }))
  expect((await s.git.command(cwd, ['rev-parse', 'HEAD'])).trim()).toBe(sha)
  expect(await readFile(join(cwd, 'hello.txt'), 'utf8')).toBe('PR commit\n')
  expect(await readFile(join(f.directory, 'hello.txt'), 'utf8')).toBe('Unrelated local edit\n')
  expect((await s.git.command(f.directory, ['rev-parse', 'HEAD'])).trim()).toBe(base)
  await writeFile(join(cwd, 'hello.txt'), 'Task draft\n')
  expect(await s.checkouts.directory(id)).toBe(cwd)
  expect(fetch).toHaveBeenCalledTimes(1)
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
  expect(s.store.task(result.id).messages[0].text).toContain('Keep cancellation idempotent')
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
  expect(task.draft).toContain('Review this change')
  expect(task.draft).toContain('Source PR: https://github.com/test/repo/pull/7')
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
