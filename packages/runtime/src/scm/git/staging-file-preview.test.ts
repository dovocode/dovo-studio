import { expect, it, vi } from 'vite-plus/test'
import { readFile, writeFile, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture } from '../../testing/fixture.js'
import { GitService } from './git.js'

it('compares HEAD to index separately from index to disk and never writes the index', async () => {
  const f = await fixture(),
    git = new GitService()
  try {
    await writeFile(join(f.directory, 'hello.txt'), 'indexed only\n')
    await git.stage(f.directory, ['hello.txt'])
    await writeFile(join(f.directory, 'hello.txt'), 'working only\n')
    const index = await readFile(join(f.directory, '.git/index'))
    const staged = await git.stagingFilePreview(f.directory, 'hello.txt', 'staged')
    expect(staged.before?.text).toBe('original\n')
    expect(staged.after?.text).toBe('indexed only\n')
    expect(staged.patch).toContain('+indexed only')
    expect(staged.patch).not.toContain('working only')
    const unstaged = await git.stagingFilePreview(f.directory, 'hello.txt', 'unstaged')
    expect(unstaged.before?.text).toBe('indexed only\n')
    expect(unstaged.after?.text).toBe('working only\n')
    expect(unstaged.patch).not.toContain('original')
    expect(await readFile(join(f.directory, '.git/index'))).toEqual(index)
    expect(await readFile(join(f.directory, 'hello.txt'), 'utf8')).toBe('working only\n')
  } finally {
    await f.cleanup()
  }
})

it('handles unborn HEAD, literal paths, additions, deletions, symlinks, binary and large sides truthfully', async () => {
  const f = await fixture(),
    git = new GitService()
  try {
    // Other refs still exist: unborn HEAD cannot be detected by counting all commits.
    await git.command(f.directory, ['checkout', '--orphan', 'new-branch'])
    await writeFile(join(f.directory, 'a[1].txt'), 'index special\n')
    await writeFile(join(f.directory, 'a1.txt'), 'other path\n')
    await writeFile(join(f.directory, 'binary.bin'), Buffer.from([0, 1, 2]))
    await writeFile(join(f.directory, 'large.txt'), 'x'.repeat(80 * 1024))
    await symlink('/outside/target', join(f.directory, 'link'))
    await git.stage(f.directory, ['a[1].txt', 'binary.bin', 'large.txt'])
    // stage() follows a symlink for its existing mutation guard; use literal Git in the fixture.
    await git.command(f.directory, ['add', '--', 'link'])
    const index = await readFile(join(f.directory, '.git/index'))
    const added = await git.stagingFilePreview(f.directory, 'a[1].txt', 'staged')
    expect(added.before).toBeUndefined()
    expect(added.after?.text).toBe('index special\n')
    const untracked = await git.stagingFilePreview(f.directory, 'a1.txt', 'unstaged')
    expect(untracked.before).toBeUndefined()
    expect(untracked.after?.text).toBe('other path\n')
    await rm(join(f.directory, 'a[1].txt'))
    const deleted = await git.stagingFilePreview(f.directory, 'a[1].txt', 'unstaged')
    expect(deleted.before?.text).toBe('index special\n')
    expect(deleted.after).toBeUndefined()
    expect((await git.stagingFilePreview(f.directory, 'link', 'staged')).after?.text).toBe(
      '/outside/target',
    )
    expect((await git.stagingFilePreview(f.directory, 'link', 'unstaged')).after?.text).toBe(
      '/outside/target',
    )
    expect((await git.stagingFilePreview(f.directory, 'binary.bin', 'staged')).after?.kind).toBe(
      'binary',
    )
    const large = await git.stagingFilePreview(f.directory, 'large.txt', 'staged')
    expect(large.after).toMatchObject({ truncated: true, size: 80 * 1024 })
    expect(large.after?.text?.length).toBe(64 * 1024)
    expect(large.patch).toBeUndefined()
    expect(await readFile(join(f.directory, '.git/index'))).toEqual(index)
    await expect(git.stagingFilePreview(f.directory, '../escape', 'staged')).rejects.toMatchObject({
      status: 400,
    })
    await expect(
      git.stagingFilePreview(f.directory, '.git/config', 'staged'),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      git.stagingFilePreview(f.directory, '/etc/passwd', 'staged'),
    ).rejects.toMatchObject({ status: 400 })
    await expect(git.stagingFilePreview(f.directory, 'missing', 'staged')).rejects.toMatchObject({
      status: 404,
    })
  } finally {
    await f.cleanup()
  }
})

it('previews staged deletions without a working file and rejects conflicts and stale index reads', async () => {
  const f = await fixture(),
    git = new GitService()
  try {
    await rm(join(f.directory, 'hello.txt'))
    await git.stage(f.directory, ['hello.txt'])
    const deleted = await git.stagingFilePreview(f.directory, 'hello.txt', 'staged')
    expect(deleted.before?.text).toBe('original\n')
    expect(deleted.after).toBeUndefined()
    await git.command(f.directory, ['reset', '--hard', 'HEAD'])
    const blob = (await git.command(f.directory, ['rev-parse', 'HEAD:hello.txt'])).trim()
    await git.readCommand(f.directory, ['update-index', '--index-info'], {
      input: `0 ${'0'.repeat(40)}\thello.txt\n100644 ${blob} 1\thello.txt\n100644 ${blob} 2\thello.txt\n100644 ${blob} 3\thello.txt\n`,
    })
    const index = await readFile(join(f.directory, '.git/index'))
    for (const comparison of ['staged', 'unstaged'] as const)
      await expect(git.stagingFilePreview(f.directory, 'hello.txt', comparison)).rejects.toThrow(
        'unresolved conflicts',
      )
    expect(await readFile(join(f.directory, '.git/index'))).toEqual(index)
    await git.command(f.directory, ['reset', '--hard', 'HEAD'])
    const read = git.readCommand.bind(git)
    let count = 0
    vi.spyOn(git, 'readCommand').mockImplementation(async (...args) => {
      const output = await read(...args)
      return args[1].includes('ls-files') && ++count === 2 ? '' : output
    })
    await expect(git.stagingFilePreview(f.directory, 'hello.txt', 'staged')).rejects.toMatchObject({
      status: 409,
    })
  } finally {
    vi.restoreAllMocks()
    await f.cleanup()
  }
})
