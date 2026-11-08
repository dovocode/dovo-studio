import { afterEach, expect, it, vi } from 'vite-plus/test'
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { startRuntime } from '../../index'
import { fixture } from '../../testing/fixture'
import { TaskCheckout } from './task-checkout'

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
    ownerToken: 'checkout-recovery-test-owner-token-32-characters',
    port: 0,
  })
  cleanups.push(runtime.close)
  const s = runtime.services
  s.store.update(() => f.workspace)
  s.commands.save({ ...s.commands.get(), shell: '/bin/sh', shellArgs: [] })
  s.preferences.save({ worktreesRoot: join(f.directory, 'worktrees') })
  const task = s.tasks.create({
    title: 'Recovery',
    repositoryId: 'repo',
    agentId: 'agent',
    execution: 'worktree',
    objective: 'Work',
  })
  return { ...f, s, task }
}

it('preserves an unrelated missing checkout and its staged index while recreating a removed task checkout', async () => {
  const { s, task, directory } = await setup()
  const unrelated = join(directory, 'unrelated')
  await s.git.addWorktree(directory, unrelated, ['-b', 'unrelated', unrelated, 'HEAD'])
  await writeFile(join(unrelated, 'hello.txt'), 'only in the staged index\n')
  await s.git.command(unrelated, ['add', 'hello.txt'])
  const index = (
    await s.git.command(unrelated, ['rev-parse', '--path-format=absolute', '--git-path', 'index'])
  ).trim()
  const before = await readFile(index)
  await rm(unrelated, { recursive: true })
  const cwd = await s.checkouts.directory(task.id)
  await s.git.command(directory, ['worktree', 'remove', cwd])
  const restored = await s.checkouts.directory(task.id)
  expect(await readFile(join(restored, 'hello.txt'), 'utf8')).toBe('original\n')
  expect(await readFile(index)).toEqual(before)
  expect(await s.git.command(directory, ['worktree', 'list', '--porcelain', '-z'])).toContain(
    `worktree ${unrelated}\0`,
  )
})

it('pushes a new origin-based task branch without advancing the remote base branch', async () => {
  const { s, task, directory } = await setup()
  const remote = join(directory, 'origin.git')
  await mkdir(remote)
  await s.git.command(remote, ['init', '--bare'])
  await s.git.command(directory, ['remote', 'add', 'origin', remote])
  await s.git.command(directory, ['push', 'origin', 'HEAD:refs/heads/main'])
  await s.git.command(remote, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  const base = (await s.git.command(remote, ['rev-parse', 'refs/heads/main'])).trim()
  s.store.updateTask(task.id, (current) => ({ ...current, worktreeFromOrigin: true }))
  const cwd = await s.checkouts.directory(task.id)
  const branch = (await s.git.command(cwd, ['branch', '--show-current'])).trim()
  expect(
    await s.git.command(cwd, ['for-each-ref', '--format=%(upstream)', `refs/heads/${branch}`]),
  ).toBe('\n')
  await writeFile(join(cwd, 'hello.txt'), 'task work\n')
  await s.git.stage(cwd, ['hello.txt'])
  const committed = await s.git.commit(cwd, 'Task work')
  await s.git.push(cwd)
  expect((await s.git.command(remote, ['rev-parse', 'refs/heads/main'])).trim()).toBe(base)
  expect((await s.git.command(remote, ['rev-parse', `refs/heads/${branch}`])).trim()).toBe(
    committed,
  )
})

it('refuses a missing task folder without pruning its recoverable staged data', async () => {
  const { s, task, directory } = await setup()
  const cwd = await s.checkouts.directory(task.id)
  await writeFile(join(cwd, 'hello.txt'), 'recover this staged version\n')
  await s.git.command(cwd, ['add', 'hello.txt'])
  const index = (
    await s.git.command(cwd, ['rev-parse', '--path-format=absolute', '--git-path', 'index'])
  ).trim()
  const before = await readFile(index)
  await rm(cwd, { recursive: true })
  await expect(s.checkouts.directory(task.id)).rejects.toMatchObject({ status: 409 })
  expect(await readFile(index)).toEqual(before)
  expect(await s.git.command(directory, ['worktree', 'list', '--porcelain', '-z'])).toContain(
    `worktree ${cwd}\0`,
  )
})

it('does not adopt the main project folder just because it holds the task branch', async () => {
  const { s, task, directory } = await setup()
  const cwd = await s.checkouts.directory(task.id)
  const branch = (await s.git.command(cwd, ['branch', '--show-current'])).trim()
  await s.git.command(directory, ['worktree', 'remove', cwd])
  await s.git.command(directory, ['checkout', branch])
  const fresh = new TaskCheckout(s.store, s.git)
  expect(await fresh.reviewDirectory(task.id)).toBeUndefined()
  await expect(fresh.directory(task.id)).rejects.toMatchObject({ status: 409 })
  expect((await s.git.inspect(directory)).branch).toBe(branch)
  expect(await readFile(join(directory, 'hello.txt'), 'utf8')).toBe('original\n')
})

it.each(['dovo-creating', 'dovo-preparing'])(
  'does not adopt a checkout locked by an interrupted %s attempt, including explicit selection',
  async (phase) => {
    const { s, task, directory } = await setup()
    const cwd = await s.checkouts.directory(task.id)
    await s.git.command(directory, [
      'worktree',
      'lock',
      '--reason',
      `${phase} interrupted-attempt`,
      cwd,
    ])
    const fresh = new TaskCheckout(s.store, s.git)
    expect(await fresh.reviewDirectory(task.id)).toBeUndefined()
    await expect(fresh.directory(task.id)).rejects.toMatchObject({ status: 409 })
    s.store.updateTask(task.id, (value) => ({ ...value, existingWorktreePath: cwd }))
    expect(await fresh.reviewDirectory(task.id)).toBeUndefined()
    await expect(fresh.directory(task.id)).rejects.toMatchObject({ status: 409 })
    expect(await readFile(join(cwd, 'hello.txt'), 'utf8')).toBe('original\n')
    expect(await s.git.command(directory, ['worktree', 'list', '--porcelain', '-z'])).toContain(
      `locked ${phase} interrupted-attempt`,
    )
  },
)

it('resumes a fork snapshot after creation succeeded but its first restoration failed', async () => {
  const { s, task, directory } = await setup()
  const head = (await s.git.command(directory, ['rev-parse', 'HEAD'])).trim()
  await writeFile(join(directory, 'hello.txt'), 'fork at this state\n')
  const snapshot = await s.git.snapshot(directory, `refs/dovo/forks/${task.id}/initial`)
  s.store.updateTask(task.id, (value) => ({
    ...value,
    forkedFrom: { taskId: 'source', title: 'Source', head, snapshot },
    setupCommand: 'test "$(cat hello.txt)" = "fork at this state"',
    worktreeSetupComplete: true,
  }))
  const restore = vi
    .spyOn(s.git, 'restoreSnapshot')
    .mockRejectedValueOnce(new Error('interrupted fork restoration'))
  await expect(s.checkouts.directory(task.id)).rejects.toThrow('interrupted fork restoration')
  expect(s.store.taskSummary(task.id).forkedFrom?.snapshot).toBe(snapshot)
  expect(s.store.taskSummary(task.id).worktreeSetupComplete).toBe(false)
  restore.mockRestore()
  const cwd = await new TaskCheckout(s.store, s.git).directory(task.id)
  expect(await readFile(join(cwd, 'hello.txt'), 'utf8')).toBe('fork at this state\n')
  expect(s.store.taskSummary(task.id).forkedFrom?.snapshot).toBeUndefined()
  expect(s.store.taskSummary(task.id).worktreeSetupComplete).toBe(true)
})
