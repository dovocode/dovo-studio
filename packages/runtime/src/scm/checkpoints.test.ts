import { afterEach, expect, it } from 'vitest'
import { chmod, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture } from '../testing/fixture'
import { GitService } from './git'
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})
it('captures each turn against dirty starting contents and preserves HEAD, staging and ignored files', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const git = new GitService(),
    cwd = f.directory
  await writeFile(join(cwd, 'hello.txt'), 'staged\n')
  await git.command(cwd, ['add', 'hello.txt'])
  await writeFile(join(cwd, 'hello.txt'), 'user edits\n')
  await writeFile(join(cwd, '.gitignore'), 'secret\n')
  await writeFile(join(cwd, 'secret'), 'private')
  await writeFile(join(cwd, 'new.txt'), 'existing untracked\n')
  const index = await readFile(join(cwd, '.git/index'))
  const head = await git.command(cwd, ['rev-parse', 'HEAD'])
  const before = await git.snapshot(cwd, 'refs/dovo/checkpoints/one/before')
  await writeFile(join(cwd, 'hello.txt'), 'agent edits\n')
  await rename(join(cwd, 'new.txt'), join(cwd, 'renamed.txt'))
  await writeFile(join(cwd, 'empty.txt'), '')
  await writeFile(join(cwd, 'binary'), Buffer.from([0, 1, 2]))
  await symlink('/etc/passwd', join(cwd, 'external'))
  const after = await git.snapshot(cwd, 'refs/dovo/checkpoints/one/after')
  const diff = await git.checkpointChanges(cwd, before, after)
  expect(diff.files).toEqual(
    expect.arrayContaining([
      { path: 'hello.txt', before: 'user edits\n', after: 'agent edits\n', viewed: false },
      { path: 'new.txt', before: 'existing untracked\n', after: '', viewed: false },
      { path: 'renamed.txt', before: '', after: 'existing untracked\n', viewed: false },
      { path: 'empty.txt', before: '', after: '', viewed: false },
    ]),
  )
  expect(diff.omitted).toEqual(['binary', 'external'])
  expect(await readFile(join(cwd, '.git/index'))).toEqual(index)
  expect(await git.command(cwd, ['rev-parse', 'HEAD'])).toBe(head)
  expect(await git.command(cwd, ['ls-tree', after, '--', 'secret'])).toBe('')
  await writeFile(join(cwd, 'hello.txt'), 'second turn\n')
  const next = await git.snapshot(cwd, 'refs/dovo/checkpoints/two/after')
  expect((await git.checkpointChanges(cwd, after, next)).files).toEqual([
    { path: 'hello.txt', before: 'agent edits\n', after: 'second turn\n', viewed: false },
  ])
  expect(await git.checkpointChanges(cwd, before, after)).toEqual(diff)
})
it('supports unborn repositories and records deletions and mode-only changes', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const git = new GitService(),
    cwd = f.directory
  await git.command(cwd, ['checkout', '--orphan', 'unborn'])
  await git.command(cwd, ['rm', '--cached', '-r', '.'])
  const before = await git.snapshot(cwd, 'refs/dovo/checkpoints/unborn/before')
  await chmod(join(cwd, 'hello.txt'), 0o755)
  const mode = await git.snapshot(cwd, 'refs/dovo/checkpoints/unborn/mode')
  expect((await git.checkpointChanges(cwd, before, mode)).files[0]?.path).toBe('hello.txt')
  await rm(join(cwd, 'hello.txt'))
  const after = await git.snapshot(cwd, 'refs/dovo/checkpoints/unborn/after')
  expect((await git.checkpointChanges(cwd, before, after)).files).toEqual([
    { path: 'hello.txt', before: 'original\n', after: '', viewed: false },
  ])
})
