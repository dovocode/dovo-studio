import { afterEach, expect, it, vi } from 'vite-plus/test'
import { mkdir, readFile, writeFile, symlink, lstat, rm, realpath, mkdtemp } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fixture } from '../../testing/fixture'
import { startRuntime } from '../../index'
import { includedWorktreeFiles, copyWorktreeFiles } from './worktree-include'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

it('copies ignored files, dotfile globs and directories before task setup, preserving checkout content on reuse', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  await writeFile(join(f.directory, '.gitignore'), '.env*\nlocal/\n')
  await writeFile(join(f.directory, '.env.local'), 'secret')
  await mkdir(join(f.directory, 'local', 'nested'), { recursive: true })
  await writeFile(join(f.directory, 'local', 'nested', 'config.json'), '{}')
  await writeFile(join(f.directory, 'unselected.txt'), 'leave behind')
  await writeFile(join(f.directory, 'hello.txt'), 'uncommitted source edit')
  await writeFile(
    join(f.directory, '.worktreeinclude'),
    '# Local configuration\r\n\r\n.env*\r\nlocal/\r\nhello.txt\r\nmissing.txt\r\n',
  )
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'include-test-token-at-least-32-characters',
    port: 0,
  })
  cleanups.push(() => runtime.close())
  const s = runtime.services
  s.store.update(() => f.workspace)
  s.commands.save({ ...s.commands.get(), shell: '/bin/sh', shellArgs: [] })
  const task = s.tasks.create({
    title: 'Includes',
    agentId: 'agent',
    repositoryId: 'repo',
    execution: 'worktree',
    objective: 'Work',
  })
  s.store.updateTask(task.id, (current) => ({
    ...current,
    setupCommand: 'test -f .env.local && test -f local/nested/config.json',
  }))
  const cwd = await s.checkouts.directory(task.id)
  cleanups.push(() => rm(cwd, { recursive: true, force: true }))
  expect(await readFile(join(cwd, '.env.local'), 'utf8')).toBe('secret')
  expect(await readFile(join(cwd, 'local', 'nested', 'config.json'), 'utf8')).toBe('{}')
  expect(await readFile(join(cwd, 'hello.txt'), 'utf8')).toBe('original\n')
  await expect(lstat(join(cwd, 'unselected.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  await writeFile(join(cwd, '.env.local'), 'task edit')
  expect(await s.checkouts.directory(task.id)).toBe(cwd)
  expect(await readFile(join(cwd, '.env.local'), 'utf8')).toBe('task edit')
})

it('does nothing without a manifest and rejects paths outside the project and Git metadata', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  expect(await includedWorktreeFiles(f.directory)).toEqual([])
  for (const pattern of [
    '../secret',
    '/tmp/secret',
    'C:\\secret',
    '.git/config',
    'local/../secret',
  ]) {
    await writeFile(join(f.directory, '.worktreeinclude'), pattern)
    await expect(includedWorktreeFiles(f.directory)).rejects.toThrow(
      'Invalid .worktreeinclude entry',
    )
  }
  await writeFile(join(f.directory, '.worktreeinclude'), '**/*')
  expect(await includedWorktreeFiles(f.directory)).not.toContain('.git/config')
})

it('refuses to copy through destination symlinks outside the checkout', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const target = join(f.directory, 'target')
  await mkdir(target)
  await mkdir(join(f.directory, 'local'))
  await writeFile(join(f.directory, 'local', 'config'), 'private')
  await symlink(dirname(f.directory), join(target, 'local'), 'dir')
  await expect(copyWorktreeFiles(f.directory, target, ['local/config'])).rejects.toThrow(
    'Symlink points outside',
  )
})

it('skips symlinks selected directly or within included directories', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  await mkdir(join(f.directory, 'local'))
  await writeFile(join(f.directory, 'local', 'config'), 'local')
  await symlink(dirname(f.directory), join(f.directory, 'local', 'external'), 'dir')
  await symlink('hello.txt', join(f.directory, 'alias'))
  await writeFile(join(f.directory, '.worktreeinclude'), 'local/\nalias\n')
  expect(await includedWorktreeFiles(f.directory)).toEqual([join('local', 'config')])
})

it('removes a partially copied checkout after failure and keeps its branch for retry', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'include-retry-token-at-least-32-characters',
    port: 0,
  })
  cleanups.push(() => runtime.close())
  const git = runtime.services.git
  const target = join(f.directory, 'new-worktree')
  await writeFile(join(f.directory, '.worktreeinclude'), '.env.local')
  await writeFile(join(f.directory, '.env.local'), 'configuration')
  const command = git.command.bind(git)
  const spy = vi.spyOn(git, 'command').mockImplementation(async (cwd, args, env) => {
    const result = await command(cwd, args, env)
    if (args[0] === 'worktree' && args[1] === 'add') await rm(join(f.directory, '.env.local'))
    return result
  })
  try {
    await expect(
      git.addWorktree(f.directory, target, ['-b', 'include-retry', target, 'HEAD']),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    spy.mockRestore()
  }
  await expect(lstat(target)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await git.command(f.directory, ['branch', '--list', 'include-retry'])).toContain(
    'include-retry',
  )
  await writeFile(join(f.directory, '.env.local'), 'configuration')
  await git.addWorktree(f.directory, target, [target, 'include-retry'])
  expect(await readFile(join(target, '.env.local'), 'utf8')).toBe('configuration')
})

it('copies includes and records canonical ownership through a symlinked worktrees root', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  await writeFile(join(f.directory, '.worktreeinclude'), '.env.local')
  await writeFile(join(f.directory, '.env.local'), 'local config')
  const root = await mkdtemp(join(dirname(f.directory), 'dovo-symlink-root-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const actualRoot = join(root, 'actual-worktrees')
  const linkedRoot = join(root, 'linked-worktrees')
  await mkdir(actualRoot)
  await symlink(actualRoot, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir')
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'symlink-include-token-at-least-32-characters',
    port: 0,
  })
  cleanups.push(() => runtime.close())
  const s = runtime.services
  s.store.update(() => f.workspace)
  s.preferences.save({ worktreesRoot: linkedRoot })
  const task = s.tasks.create({
    title: 'Symlink root',
    repositoryId: 'repo',
    agentId: 'agent',
    execution: 'worktree',
    objective: 'Work',
  })
  const path = await s.checkouts.directory(task.id)
  expect(await readFile(join(path, '.env.local'), 'utf8')).toBe('local config')
  const common = (
    await s.git.command(f.directory, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  ).trim()
  expect(s.store.managedWorktrees(common)).toContain(await realpath(path))
})
