import { afterEach, expect, it, vi } from 'vite-plus/test'
import { lstat, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runClientEffect } from '@dovo/client-runtime'
import { startRuntime } from '../index'
import { fixture } from '../testing/fixture'
import { listWorktreesEffect, removeWorktreeEffect } from '../scm/git/worktrees'
import { WorkspaceStore } from '../storage/workspace'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
const token = 'worktree-deletion-owner-token-at-least-32-characters'
async function setup() {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const root = await mkdtemp(join(tmpdir(), 'dovo-deletion-worktrees-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanups.push(() => runtime.close())
  const s = runtime.services
  s.store.update(() => f.workspace)
  s.preferences.save({ worktreesRoot: join(root, 'first') })
  const create = (title: string) =>
    s.tasks.create({
      title,
      agentId: 'agent',
      repositoryId: 'repo',
      execution: 'worktree',
      objective: 'Work',
    })
  const remove = async (id: string, removeWorktrees?: boolean) => {
    const response = await fetch(`http://127.0.0.1:${runtime.port}/api/tasks/lifecycle`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        action: 'delete',
        ...(removeWorktrees === undefined ? {} : { removeWorktrees }),
      }),
    })
    expect(await response.json()).toMatchObject({ ok: true })
    expect(response.status).toBe(200)
  }
  const list = () => runClientEffect(listWorktreesEffect(s))
  return { s, f, root, create, remove, list }
}

it('keeps worktrees by default and lists only Dovo orphans after their root changes', async () => {
  const { s, f, root, create, remove, list } = await setup()
  const task = create('Keep')
  const path = await s.checkouts.directory(task.id)
  const common = (
    await s.git.command(f.directory, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  ).trim()
  // Simulate a checkout created before the durable inventory existed.
  s.db.prepare('DELETE FROM documents WHERE id = ?').run(`worktrees:${common}`)
  s.preferences.save({ worktreesRoot: join(root, 'second') })
  await remove(task.id)
  expect((await lstat(path)).isDirectory()).toBe(true)
  expect((await list()).worktrees).toContainEqual(
    expect.objectContaining({ path, state: 'missing', threadIds: [], retainedLocation: true }),
  )
  expect(new WorkspaceStore(s.db).managedWorktrees(common)).toContain(path)
  const external = join(root, 'second', 'external')
  await s.git.command(f.directory, ['worktree', 'add', '-b', 'external', external])
  expect((await list()).worktrees.some((entry) => entry.path === external)).toBe(false)
})

it('uses the persistent setting, keeps archived shared references, and removes only after the last deletion', async () => {
  const { s, f, create, remove, list } = await setup()
  s.preferences.save({ removeWorktreesOnThreadDelete: true })
  const owner = create('Owner')
  const path = await s.checkouts.directory(owner.id)
  const branch = (await s.git.command(path, ['branch', '--show-current'])).trim()
  const guest = create('Guest')
  s.store.updateTask(guest.id, (task) => ({
    ...task,
    existingWorktreePath: path,
    archivedAt: new Date().toISOString(),
  }))
  await remove(owner.id)
  expect((await lstat(path)).isDirectory()).toBe(true)
  expect((await list()).worktrees).toContainEqual(
    expect.objectContaining({ path, state: 'archived', threadIds: [guest.id] }),
  )
  await expect(runClientEffect(removeWorktreeEffect(s, path, true))).rejects.toThrow('still linked')
  await remove(guest.id)
  await expect(lstat(path)).rejects.toMatchObject({ code: 'ENOENT' })
  expect((await s.git.command(f.directory, ['branch', '--list', branch])).trim()).not.toBe('')
  await remove(guest.id)
})

it('honors per-deletion overrides and preserves dirty worktrees', async () => {
  const { s, create, remove, list } = await setup()
  const optedIn = create('Opt in')
  const includedPath = await s.checkouts.directory(optedIn.id)
  await remove(optedIn.id, true)
  await expect(lstat(includedPath)).rejects.toMatchObject({ code: 'ENOENT' })
  s.preferences.save({ removeWorktreesOnThreadDelete: true })
  const optedOut = create('Opt out')
  const keptPath = await s.checkouts.directory(optedOut.id)
  await remove(optedOut.id, false)
  expect((await lstat(keptPath)).isDirectory()).toBe(true)
  const dirty = create('Dirty')
  const dirtyPath = await s.checkouts.directory(dirty.id)
  await writeFile(join(dirtyPath, 'unsaved.txt'), 'keep this')
  await remove(dirty.id)
  expect((await lstat(keptPath)).isDirectory()).toBe(true)
  expect((await list()).worktrees).toContainEqual(
    expect.objectContaining({ path: dirtyPath, state: 'missing', dirty: true }),
  )
})

it('protects linked references and removes both checkouts when their last thread is deleted', async () => {
  const { s, create, remove, list } = await setup()
  const owner = create('Owner')
  const path = await s.checkouts.directory(owner.id)
  const linked = create('Linked')
  s.store.updateTask(linked.id, (task) => ({
    ...task,
    linkedCheckouts: [
      {
        id: 'shared',
        repositoryId: 'repo',
        execution: 'worktree',
        access: 'edit',
        existingWorktreePath: path,
      },
    ],
  }))
  const linkedPath = await s.checkouts.directory(linked.id)
  s.preferences.save({ removeWorktreesOnThreadDelete: true })
  await remove(owner.id)
  expect((await list()).worktrees).toContainEqual(
    expect.objectContaining({ path, threadIds: [linked.id] }),
  )
  await remove(linked.id)
  await expect(lstat(path)).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(lstat(linkedPath)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('keeps worktrees referenced only by saved linked checkpoints until that thread is deleted', async () => {
  const { s, create, remove, list } = await setup()
  const owner = create('Owner')
  const path = await s.checkouts.directory(owner.id)
  const history = create('History')
  s.store.updateTask(history.id, (task) => ({
    ...task,
    archivedAt: new Date().toISOString(),
    turns: [
      {
        id: 'turn',
        assistantId: 'reply',
        agentId: 'agent',
        provider: 'codex',
        model: 'fixture',
        status: 'completed',
        startedAt: new Date().toISOString(),
        checkpoint: {
          before: '',
          files: [],
          omitted: [],
          linked: [
            {
              checkoutId: 'removed-link',
              repositoryId: 'repo',
              directory: path,
              before: '',
              files: [],
              omitted: [],
            },
          ],
        },
      },
    ],
  }))
  s.preferences.save({ removeWorktreesOnThreadDelete: true })
  await remove(owner.id)
  expect((await list()).worktrees).toContainEqual(
    expect.objectContaining({ path, state: 'archived', threadIds: [history.id] }),
  )
  await remove(history.id)
  await expect(lstat(path)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('removes only the selected registration for a missing Dovo worktree and leaves external worktrees alone', async () => {
  const { s, f, root, create, remove } = await setup()
  const owner = create('Missing')
  const path = await s.checkouts.directory(owner.id)
  const external = join(root, 'external')
  await s.git.command(f.directory, ['worktree', 'add', '-b', 'external', external])
  await rm(path, { recursive: true })
  await rm(external, { recursive: true })
  s.preferences.save({ removeWorktreesOnThreadDelete: true })
  await remove(owner.id)
  const listed = await s.git.command(f.directory, ['worktree', 'list', '--porcelain'])
  expect(listed).not.toContain(`worktree ${path}\n`)
  expect(listed).toContain(`worktree ${external}\n`)
})

it('never adopts hash-shaped external worktrees and forgets ownership after removal', async () => {
  const { s, f, root, create, remove, list } = await setup()
  const external = join(root, 'first', 'manual-deadbeef')
  await s.git.command(f.directory, ['worktree', 'add', '-b', 'manual', external])
  const guest = create('External guest')
  s.store.updateTask(guest.id, (task) => ({ ...task, existingWorktreePath: external }))
  expect((await list()).worktrees.some((entry) => entry.path === external)).toBe(false)
  await remove(guest.id, true)
  expect((await lstat(external)).isDirectory()).toBe(true)
  const owner = create('Managed')
  const path = await s.checkouts.directory(owner.id)
  await remove(owner.id, true)
  await s.git.command(f.directory, ['worktree', 'add', '-b', 'reused-external', path])
  expect((await list()).worktrees.some((entry) => entry.path === path)).toBe(false)
})

it('rechecks references added while Git inspection is pending before orphan removal', async () => {
  const { s, create, remove } = await setup()
  const owner = create('Owner')
  const path = await s.checkouts.directory(owner.id)
  await remove(owner.id)
  const guest = create('Late guest')
  const command = s.git.command.bind(s.git)
  let linked = false
  vi.spyOn(s.git, 'command').mockImplementation(async (directory, args, ...rest) => {
    const result = await command(directory, args, ...rest)
    if (!linked && directory === path && args[0] === 'status') {
      linked = true
      s.store.updateTask(guest.id, (task) => ({ ...task, existingWorktreePath: path }))
    }
    return result
  })
  await expect(runClientEffect(removeWorktreeEffect(s, path, true))).rejects.toThrow('still linked')
  expect((await lstat(path)).isDirectory()).toBe(true)
})

it('does not adopt a user-created worktree placed on a retained Dovo branch', async () => {
  const { s, f, root, create, list } = await setup()
  const task = create('Retained branch')
  const path = await s.checkouts.directory(task.id)
  const branch = (await s.git.command(path, ['branch', '--show-current'])).trim()
  s.store.updateTask(task.id, (current) => ({ ...current, archivedAt: new Date().toISOString() }))
  await runClientEffect(removeWorktreeEffect(s, path))
  const manual = join(root, 'user-checkout')
  await s.git.command(f.directory, ['worktree', 'add', manual, branch])
  expect((await list()).worktrees.some((entry) => entry.path === manual)).toBe(false)
})

it('does not restore ownership from a listing that finishes after deletion', async () => {
  const { s, f, create, remove, list } = await setup()
  const task = create('Listing race')
  const path = await s.checkouts.directory(task.id)
  const common = (
    await s.git.command(f.directory, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  ).trim()
  const command = s.git.command.bind(s.git)
  let release!: () => void
  let captured!: () => void
  const paused = new Promise<void>((resolve) => {
    release = resolve
  })
  const ready = new Promise<void>((resolve) => {
    captured = resolve
  })
  let first = true
  vi.spyOn(s.git, 'command').mockImplementation(async (directory, args) => {
    const result = await command(directory, args)
    if (first && args[0] === 'worktree' && args[1] === 'list') {
      first = false
      captured()
      await paused
    }
    return result
  })
  const listing = list()
  await ready
  await remove(task.id, true)
  release()
  await listing
  expect(s.store.managedWorktrees(common)).not.toContain(path)
  await command(f.directory, ['worktree', 'add', '-b', 'external-reuse', path])
  expect((await list()).worktrees.some((entry) => entry.path === path)).toBe(false)
})

it('cleans a shared worktree when its last two threads are deleted concurrently', async () => {
  const { s, create, remove } = await setup()
  const owner = create('Concurrent owner')
  const path = await s.checkouts.directory(owner.id)
  const guest = create('Concurrent guest')
  s.store.updateTask(guest.id, (task) => ({ ...task, existingWorktreePath: path }))
  const command = s.git.command.bind(s.git)
  let count = 0
  let release!: () => void
  const both = new Promise<void>((resolve) => {
    release = resolve
  })
  vi.spyOn(s.git, 'command').mockImplementation(async (directory, args) => {
    const result = await command(directory, args)
    if (args[0] === 'worktree' && args[1] === 'list' && count < 2) {
      if (++count === 2) release()
      await both
    }
    return result
  })
  await Promise.all([remove(owner.id, true), remove(guest.id, true)])
  await expect(lstat(path)).rejects.toMatchObject({ code: 'ENOENT' })
})
