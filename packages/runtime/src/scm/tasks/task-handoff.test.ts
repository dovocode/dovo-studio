import { afterEach, expect, it } from 'vite-plus/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startRuntime } from '../../index'
import { fixture } from '../../testing/fixture'
import { handoffTask } from './task-handoff'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function setup() {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const roots = await mkdtemp(join(tmpdir(), 'dovo-handoff-test-'))
  cleanups.push(() => rm(roots, { recursive: true, force: true }))
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'handoff-test-owner-token-at-least-32-characters',
    port: 0,
  })
  cleanups.push(() => runtime.close())
  const s = runtime.services
  s.store.update(() => f.workspace)
  s.preferences.save({ worktreesRoot: join(roots, 'worktrees') })
  const task = s.tasks.create({
    title: 'Move me',
    agentId: 'agent',
    repositoryId: 'repo',
    objective: 'Work',
  })
  // A session makes the task started, so its checkout can only change through a handoff.
  s.store.updateTask(task.id, (value) => ({ ...value, sessionId: 'session' }))
  const git = (cwd: string, ...args: string[]) => s.git.command(cwd, args)
  const sibling = join(roots, 'sibling')
  await git(f.directory, 'worktree', 'add', '-q', '-b', 'sibling', sibling)
  return { s, root: f.directory, id: task.id, git, sibling }
}

/** Leaves a staged edit, a further unstaged edit and an untracked file. */
async function dirty(root: string, git: (cwd: string, ...args: string[]) => Promise<string>) {
  await writeFile(join(root, 'hello.txt'), 'staged\n')
  await git(root, 'add', 'hello.txt')
  await writeFile(join(root, 'hello.txt'), 'unstaged\n')
  await writeFile(join(root, 'new.txt'), 'untracked\n')
}

async function expectDirty(cwd: string, git: (cwd: string, ...args: string[]) => Promise<string>) {
  expect(await readFile(join(cwd, 'hello.txt'), 'utf8')).toBe('unstaged\n')
  expect(await readFile(join(cwd, 'new.txt'), 'utf8')).toBe('untracked\n')
  expect(await git(cwd, 'show', ':hello.txt')).toBe('staged\n')
  expect(await git(cwd, 'status', '--porcelain')).toBe('MM hello.txt\n?? new.txt\n')
}

const pins = async (git: (cwd: string, ...args: string[]) => Promise<string>, root: string) =>
  (await git(root, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/dovo/handoff'))
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split(' ') as [string, string])

it('moves back out of the project folder repeatedly without adopting it as the task worktree', async () => {
  const { s, root, id, git } = await setup()
  await dirty(root, git)
  const branches = new Set<string>()
  for (let index = 0; index < 3; index++) {
    const projectBranch = (await git(root, 'branch', '--show-current')).trim()
    await handoffTask(s, id, 'worktree')
    const cwd = await s.checkouts.directory(id)
    expect(cwd).not.toBe(root)
    await expectDirty(cwd, git)
    expect((await git(root, 'branch', '--show-current')).trim()).toBe(projectBranch)
    const branch = (await git(cwd, 'branch', '--show-current')).trim()
    expect(s.store.taskSummary(id).checkoutBranch).toBe(branch)
    expect(branches.has(branch)).toBe(false)
    branches.add(branch)
    await handoffTask(s, id, 'main')
    await expectDirty(root, git)
    expect((await git(root, 'branch', '--show-current')).trim()).toBe(branch)
  }
})

it('moves uncommitted work both ways and pins each attempt in a private ref', async () => {
  const { s, root, id, git } = await setup()
  await dirty(root, git)

  await handoffTask(s, id, 'worktree')
  const cwd = await s.checkouts.directory(id)
  expect(cwd).not.toBe(root)
  await expectDirty(cwd, git)
  expect(await git(root, 'status', '--porcelain')).toBe('')
  const [first] = await pins(git, root)
  expect(first?.[0]).toMatch(new RegExp(`^refs/dovo/handoff/${id}/[0-9a-f-]{36}$`))
  expect(s.store.task(id).messages.at(-1)?.text).toContain(`Git ref ${first![0]}`)

  await handoffTask(s, id, 'main')
  await expectDirty(root, git)
  const both = await pins(git, root)
  expect(both).toHaveLength(2)
  const second = both.find(([ref]) => ref !== first![0])!
  expect(s.store.task(id).messages.at(-1)?.text).toContain(`Git ref ${second[0]}`)
  // Each pinned commit is a full stash: worktree, index and untracked parents.
  for (const [, commit] of both)
    expect(
      (await git(root, 'rev-list', '--parents', '-n1', commit)).trim().split(' '),
    ).toHaveLength(4)
})

it('restores the project folder from the pinned ref when the worktree cannot be created', async () => {
  const { s, root, id, git } = await setup()
  await dirty(root, git)
  const checkouts = Object.create(s.checkouts) as typeof s.checkouts
  checkouts.directory = async () => {
    throw new Error('worktree setup failed')
  }

  await expect(handoffTask({ ...s, checkouts }, id, 'worktree')).rejects.toThrow(
    'worktree setup failed',
  )
  await expectDirty(root, git)
  expect(s.store.taskSummary(id).execution ?? 'main').toBe('main')
  expect(await pins(git, root)).toHaveLength(1)
})

it('names the pinned ref when the changes cannot be applied and recovers from it', async () => {
  const { s, root, id, git } = await setup()
  await dirty(root, git)
  let cwd = ''
  const checkouts = Object.create(s.checkouts) as typeof s.checkouts
  checkouts.directory = async (taskId) => {
    cwd = await s.checkouts.directory(taskId)
    // An untracked file in the way makes `git stash apply` refuse to overwrite it.
    await writeFile(join(cwd, 'new.txt'), 'in the way\n')
    return cwd
  }

  const error = await handoffTask({ ...s, checkouts }, id, 'worktree').catch(
    (reason: unknown) => reason,
  )
  const [[ref]] = await pins(git, root)
  expect(s.store.taskSummary(id).execution).toBe('worktree')
  expect(await s.checkouts.directory(id)).toBe(cwd)
  expect(String(error)).toContain(`They are safe in Git ref ${ref}`)
  expect(String(error)).toContain(`inspect and resolve any partly applied changes in ${cwd}`)
  expect(String(error)).toContain(`git stash apply --index ${ref}`)
  // Git restores tracked changes before it refuses the untracked file, so discard both first.
  await git(cwd, 'reset', '--quiet', '--hard')
  await rm(join(cwd, 'new.txt'))
  await git(cwd, 'stash', 'apply', '--index', ref!)
  await expectDirty(cwd, git)
})

it('applies its own changes and never drops unrelated stash entries pushed concurrently', async () => {
  const { s, root, id, git, sibling } = await setup()
  await writeFile(join(sibling, 'hello.txt'), 'older user stash\n')
  await git(sibling, 'stash', 'push', '-m', 'older user stash')
  const older = (await git(root, 'rev-parse', 'refs/stash')).trim()
  await dirty(root, git)
  let competing = ''
  const racing = Object.create(s.git) as typeof s.git
  racing.command = async (cwd, args, env) => {
    const output = await s.git.command(cwd, args, env)
    if (args[0] === 'stash' && args[1] === 'push' && !competing) {
      // Another checkout stashes right after the handoff, so the handoff entry is no longer on top.
      await writeFile(join(sibling, 'hello.txt'), 'competing stash\n')
      await git(sibling, 'stash', 'push', '-m', 'competing stash')
      competing = (await git(root, 'rev-parse', 'refs/stash')).trim()
    }
    return output
  }

  await handoffTask({ ...s, git: racing }, id, 'worktree')
  await expectDirty(await s.checkouts.directory(id), git)
  const [[, pinned]] = await pins(git, root)
  const entries = (await git(root, 'stash', 'list', '--format=%H')).split('\n').filter(Boolean)
  expect(entries).toEqual([competing, pinned, older])
  expect(await readFile(join(sibling, 'hello.txt'), 'utf8')).toBe('original\n')
})

it('keeps recovery after a bare stash pop elsewhere and garbage collection', async () => {
  const { s, root, id, git, sibling } = await setup()
  await dirty(root, git)
  await handoffTask(s, id, 'worktree')
  const cwd = await s.checkouts.directory(id)
  const [[ref, pinned]] = await pins(git, root)

  // The remaining hazard: a bare pop in another checkout applies and consumes the handoff entry.
  await git(sibling, 'stash', 'pop')
  expect(await readFile(join(sibling, 'new.txt'), 'utf8')).toBe('untracked\n')
  expect(await git(root, 'stash', 'list')).toBe('')
  await git(root, 'reflog', 'expire', '--expire=now', '--expire-unreachable=now', '--all')
  await git(root, 'gc', '--quiet', '--prune=now')

  expect((await git(root, 'rev-parse', ref!)).trim()).toBe(pinned)
  await git(cwd, 'reset', '--quiet', '--hard')
  await git(cwd, 'clean', '--quiet', '--force')
  await git(cwd, 'stash', 'apply', '--index', ref!)
  await expectDirty(cwd, git)
})
