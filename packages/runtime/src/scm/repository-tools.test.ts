import { expect, it } from 'vitest'
import { mkdir, writeFile, mkdtemp, rm, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { decode, commandsSchema, createGithubRepositorySchema } from '@dovo/protocol'
import { GitService } from './git'
import { fixture } from '../testing/fixture'

it('pushes to the configured upstream branch, even when its name differs', async () => {
  const f = await fixture()
  const git = new GitService()
  const remote = await mkdtemp(join(tmpdir(), 'dovo-bare-'))
  try {
    await git.command(remote, ['init', '--bare'])
    await git.command(f.directory, ['remote', 'add', 'origin', remote])
    await git.command(f.directory, ['push', '-u', 'origin', 'HEAD:refs/heads/review'])
    await writeFile(join(f.directory, 'hello.txt'), 'updated')
    await git.stage(f.directory, ['hello.txt'])
    const sha = await git.commit(f.directory, 'Update')
    await git.push(f.directory)
    expect((await git.command(remote, ['rev-parse', 'refs/heads/review'])).trim()).toBe(sha)
    await git.command(f.directory, ['checkout', '-b', 'new-feature'])
    await git.push(f.directory)
    expect((await git.command(remote, ['rev-parse', 'refs/heads/new-feature'])).trim()).toBe(sha)
    await git.command(f.directory, ['checkout', '--detach'])
    await expect(git.push(f.directory)).rejects.toThrow('Check out a branch')
  } finally {
    await f.cleanup()
    await rm(remote, { recursive: true, force: true })
  }
})
it('refuses to replace existing remotes and explains a missing push destination', async () => {
  const f = await fixture()
  const git = new GitService()
  try {
    await expect(git.push(f.directory)).rejects.toThrow('Choose a Git remote')
    await git.command(f.directory, [
      'remote',
      'add',
      'upstream',
      'https://example.invalid/repo.git',
    ])
    await expect(git.createGithub(f.directory, 'new', 'private')).rejects.toThrow(
      'already has a Git remote',
    )
    expect((await git.folderStatus(f.directory)).remotes).toEqual(['upstream'])
  } finally {
    await f.cleanup()
  }
})
it('initializes a plain folder and creates a private remote without staging or pushing files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-create-'))
  const calls: string[][] = []
  const gh = join(directory, 'fake-gh')
  await writeFile(gh, '#!/bin/sh\nexit 0\n', { mode: 0o700 })
  const folder = join(directory, 'project')
  await mkdir(folder)
  await writeFile(join(folder, 'local.txt'), 'stay local')
  const git = new GitService(
    () => ({ ...decode(commandsSchema, {}), gh }),
    (_cwd, args, result) => {
      if (!result) calls.push(args)
    },
  )
  try {
    expect(await git.folderStatus(folder)).toEqual({ initialized: false, remotes: [] })
    await git.createGithub(folder, 'owner/project', 'private')
    expect(calls).toContainEqual([
      gh,
      'repo',
      'create',
      'owner/project',
      '--private',
      '--source',
      await realpath(folder),
      '--remote',
      'origin',
    ])
    expect(await git.command(folder, ['diff', '--cached', '--name-only'])).toBe('')
    expect(calls.some((args) => args.includes('push'))).toBe(false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
it('rejects repository names that could be flags or paths', () => {
  for (const name of ['--public', '../other', 'owner/repo/extra', ''])
    expect(() =>
      decode(createGithubRepositorySchema, { path: '/tmp', name, visibility: 'private' }),
    ).toThrow(Error)
})
