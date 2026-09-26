import { afterEach, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { startRuntime } from '../index'
import { fixture } from '../testing/fixture'
import { listWorktreesEffect, removeWorktreeEffect } from './worktrees'
import { Housekeeping } from '../agents/housekeeping'
import { runClientEffect } from '@dovo/client-runtime'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
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
