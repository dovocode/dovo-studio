import { afterEach, expect, it } from 'vite-plus/test'
import { existsSync } from 'node:fs'
import { rm, writeFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { startRuntime } from '../../index'
import { fixture } from '../../testing/fixture'
import { listWorktreesEffect, removeWorktreeEffect, worktreeChoicesEffect } from './worktrees'
import { Housekeeping } from '../../agents/tasks/housekeeping'
import { runClientEffect } from '@dovo/client-runtime'
import { handoffTask } from '../tasks/task-handoff'
import { TaskCheckout } from '../tasks/task-checkout'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

it('uses configured locations for new tasks while retaining and protecting old checkouts across restarts', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const roots = await mkdtemp(join(tmpdir(), 'dovo-root-test-'))
  cleanups.push(() => rm(roots, { recursive: true, force: true }))
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'root-test-owner-token-at-least-32-characters',
    port: 0,
  })
  cleanups.push(() => runtime.close())
  const s = runtime.services
  s.store.update(() => f.workspace)
  s.preferences.save({ worktreesRoot: join(roots, 'first') })
  const first = s.tasks.create({
    title: 'First',
    agentId: 'agent',
    repositoryId: 'repo',
    execution: 'worktree',
    objective: 'Work',
  })
  const directory = await s.checkouts.directory(first.id)
  expect(directory.startsWith(join(roots, 'first'))).toBe(true)
  s.preferences.save({ worktreesRoot: join(roots, 'second') })
  const restarted = new TaskCheckout(
    s.store,
    s.git,
    () => 'dovo/',
    undefined,
    () => s.preferences.worktreesRoot(),
  )
  expect(await restarted.directory(first.id)).toBe(directory)
  expect((await runClientEffect(listWorktreesEffect(s))).worktrees).toContainEqual(
    expect.objectContaining({ path: directory, state: 'active' }),
  )
  await expect(runClientEffect(removeWorktreeEffect(s, directory))).rejects.toThrow('active task')
  const second = s.tasks.create({
    title: 'Second',
    agentId: 'agent',
    repositoryId: 'repo',
    execution: 'worktree',
    objective: 'Work',
  })
  expect((await restarted.directory(second.id)).startsWith(join(roots, 'second'))).toBe(true)
  const sibling = join(roots, 'second-external', 'checkout')
  await s.git.command(f.directory, ['worktree', 'add', '-b', 'unrelated', sibling])
  expect(
    (await runClientEffect(listWorktreesEffect(s))).worktrees.some(
      (entry) => entry.path === sibling,
    ),
  ).toBe(false)
  await expect(runClientEffect(removeWorktreeEffect(s, sibling))).rejects.toThrow(
    'no longer listed',
  )
})

it('lists task worktrees and removes only clean ones whose task is archived, keeping the branch', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'worktree-test-owner-token-at-least-32-characters',
    port: 0,
  })
  cleanups.push(() => runtime.close())
  const s = runtime.services
  s.store.update(() => f.workspace)
  const task = s.tasks.create({
    title: 'Cleanup candidate',
    agentId: 'agent',
    repositoryId: 'repo',
    execution: 'worktree',
    objective: 'Try cleanup',
  })
  const cwd = await s.checkouts.directory(task.id)
  cleanups.push(() => rm(cwd, { recursive: true, force: true }))
  const list = () => runClientEffect(listWorktreesEffect(s))
  const remove = () => runClientEffect(removeWorktreeEffect(s, cwd))
  const entry = async () => (await list()).worktrees.find((item) => item.taskId === task.id)

  expect(await entry()).toMatchObject({
    state: 'active',
    dirty: false,
    taskTitle: 'Cleanup candidate',
  })
  await expect(remove()).rejects.toThrow('active task')

  s.store.updateTask(task.id, (current) => ({ ...current, archivedAt: new Date().toISOString() }))
  await writeFile(join(cwd, 'unsaved.txt'), 'work in progress\n')
  expect(await entry()).toMatchObject({ state: 'archived', dirty: true })
  await expect(remove()).rejects.toThrow('uncommitted changes')

  await rm(join(cwd, 'unsaved.txt'))
  const branch = (await entry())?.branch
  await remove()
  expect(existsSync(cwd)).toBe(false)
  expect(await entry()).toBeUndefined()
  // The branch survives, so no commits are lost.
  expect((await s.git.command(f.directory, ['branch', '--list', branch ?? ''])).trim()).not.toBe('')

  // Restoring the task reattaches its kept branch, even after a rename.
  s.store.updateTask(task.id, (current) => ({
    ...current,
    archivedAt: undefined,
    title: 'Renamed later',
  }))
  const restored = await s.checkouts.directory(task.id)
  cleanups.push(() => rm(restored, { recursive: true, force: true }))
  expect((await s.git.command(restored, ['branch', '--show-current'])).trim()).toBe(branch)
})

it('reuses a selected worktree and protects it while another task uses it', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'shared-worktree-test-token-at-least-32-characters',
    port: 0,
  })
  cleanups.push(() => runtime.close())
  const s = runtime.services
  s.store.update(() => f.workspace)
  const owner = s.tasks.create({
    title: 'Owner',
    agentId: 'agent',
    repositoryId: 'repo',
    execution: 'worktree',
    objective: 'Own',
  })
  const cwd = await s.checkouts.directory(owner.id)
  cleanups.push(() => rm(cwd, { recursive: true, force: true }))
  await writeFile(join(cwd, 'unsaved.txt'), 'keep me\n')
  const guest = s.tasks.create({
    title: 'Guest',
    agentId: 'agent',
    repositoryId: 'repo',
    execution: 'worktree',
    objective: 'Use existing',
  })
  s.store.updateTask(guest.id, (task) => ({
    ...task,
    existingWorktreePath: cwd,
    worktreeSetupComplete: true,
  }))
  expect(await s.checkouts.directory(guest.id)).toBe(cwd)
  expect(
    (await listWorktreesEffect(s).pipe((effect) => runClientEffect(effect))).worktrees.find(
      (item) => item.path === cwd,
    )?.state,
  ).toBe('active')
  s.store.updateTask(owner.id, (task) => ({ ...task, archivedAt: new Date().toISOString() }))
  await expect(runClientEffect(removeWorktreeEffect(s, cwd))).rejects.toThrow('active task')
  await expect(handoffTask(s, owner.id, 'main')).rejects.toThrow('Another task uses this worktree')
  const external = join(dirname(f.directory), `external-${owner.id}`)
  await s.git.command(f.directory, ['worktree', 'add', '-b', `external-${owner.id}`, external])
  cleanups.push(async () => {
    await s.git.command(f.directory, ['worktree', 'remove', '--force', external])
  })
  const choices = await runClientEffect(worktreeChoicesEffect(s, 'repo'))
  expect(choices.worktrees.map((item) => item.path)).toContain((await s.git.inspect(external)).path)
  expect(choices.worktrees.map((item) => item.path)).toContain(cwd)
  expect(choices.worktrees.map((item) => item.path)).not.toContain(f.directory)
})

it('housekeeping removes clean archived worktrees only when the setting is on', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'worktree-test-owner-token-at-least-32-characters',
    port: 0,
  })
  cleanups.push(() => runtime.close())
  const s = runtime.services
  s.store.update(() => f.workspace)
  const create = async (title: string) => {
    const task = s.tasks.create({
      title,
      agentId: 'agent',
      repositoryId: 'repo',
      execution: 'worktree',
      objective: title,
    })
    const cwd = await s.checkouts.directory(task.id)
    cleanups.push(() => rm(cwd, { recursive: true, force: true }))
    s.store.updateTask(task.id, (current) => ({ ...current, archivedAt: new Date().toISOString() }))
    return cwd
  }
  const clean = await create('Clean archived')
  const dirty = await create('Dirty archived')
  await writeFile(join(dirty, 'unsaved.txt'), 'keep me\n')
  const housekeeping = new Housekeeping(s)

  expect(await housekeeping.removeArchivedWorktrees()).toEqual([])
  expect(existsSync(clean)).toBe(true)

  s.preferences.save({ removeArchivedWorktrees: true })
  expect(await housekeeping.removeArchivedWorktrees()).toEqual([clean])
  expect(existsSync(clean)).toBe(false)
  expect(existsSync(join(dirty, 'unsaved.txt'))).toBe(true)
})
