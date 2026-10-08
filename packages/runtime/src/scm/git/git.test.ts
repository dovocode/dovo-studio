import { expect, it } from 'vite-plus/test'
import { readFile, writeFile, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture } from '../../testing/fixture'
import { GitService } from './git'
it('reads real diffs and applies edits without overwriting changed disk contents', async () => {
  const f = await fixture(),
    git = new GitService()
  try {
    await writeFile(join(f.directory, 'hello.txt'), 'changed\n')
    const files = await git.changes(f.directory)
    expect(files).toEqual([
      expect.objectContaining({ path: 'hello.txt', before: 'original\n', after: 'changed\n' }),
    ])
    await expect(git.save(f.directory, 'hello.txt', 'stale', 'lost')).rejects.toThrow(
      'File changed on disk',
    )
    await git.save(f.directory, 'hello.txt', 'changed\n', 'accepted\n')
    expect(await readFile(join(f.directory, 'hello.txt'), 'utf8')).toBe('accepted\n')
    await git.stage(f.directory, ['hello.txt'])
    expect(await git.commit(f.directory, 'Verified edit')).toMatch(/^[0-9a-f]{40}$/)
    expect(await git.changes(f.directory)).toEqual([])
  } finally {
    await f.cleanup()
  }
})
it('rejects path traversal and symlinks escaping a repository', async () => {
  const f = await fixture(),
    git = new GitService()
  try {
    await expect(git.save(f.directory, '../escape', '', 'bad')).rejects.toThrow(
      'outside the repository',
    )
    await symlink('/tmp', join(f.directory, 'outside'))
    await expect(git.save(f.directory, 'outside/dovo-invalid', '', 'bad')).rejects.toThrow(
      'Symlink points outside',
    )
    await expect(git.save(f.directory, '.git/config', '', 'bad')).rejects.toThrow(
      'Invalid file path',
    )
  } finally {
    await f.cleanup()
  }
})
it('reads and stages files after their entire parent directory is deleted', async () => {
  const f = await fixture(),
    git = new GitService()
  try {
    const { mkdir, rm } = await import('node:fs/promises')
    await mkdir(join(f.directory, 'nested'))
    await writeFile(join(f.directory, 'nested/file.txt'), 'before\n')
    await git.stage(f.directory, ['nested/file.txt'])
    await git.commit(f.directory, 'Nested fixture')
    await rm(join(f.directory, 'nested'), { recursive: true })
    expect(await git.changes(f.directory)).toEqual([
      expect.objectContaining({ path: 'nested/file.txt', before: 'before\n', after: '' }),
    ])
    await git.stage(f.directory, ['nested/file.txt'])
    await git.commit(f.directory, 'Remove nested file')
    expect(await git.changes(f.directory)).toEqual([])
  } finally {
    await f.cleanup()
  }
})
it('matches equivalent non-origin remotes but keeps forks and ambiguous remotes separate', async () => {
  const f = await fixture()
  const git = new GitService()
  const { exec } = await import('../../process')
  const command = (args: string[]) => exec('git', args, { cwd: f.directory })
  try {
    await command(['remote', 'add', 'fetch', 'git@github.com:owner/repo.git'])
    await command(['remote', 'add', 'backup', 'https://github.com/Owner/Repo'])
    expect(await git.repositoryIdentity(f.directory)).toBe('github.com/owner/repo')
    await command(['remote', 'set-url', 'backup', 'https://github.com/another/repo'])
    expect(await git.repositoryIdentity(f.directory, true)).toBeUndefined()
    await command(['remote', 'add', 'origin', 'https://github.com/fork/repo'])
    expect(await git.repositoryIdentity(f.directory, true)).toBe('github.com/fork/repo')
    await command(['config', 'url.https://github.com/.insteadOf', 'https://git-alias/'])
    await command(['remote', 'set-url', 'origin', 'https://git-alias/owner/repo'])
    expect(await git.repositoryIdentity(f.directory, true)).toBe('github.com/owner/repo')
  } finally {
    await f.cleanup()
  }
})
it('retains every live path and bounds previews without changing Git refs or the index', async () => {
  const f = await fixture(),
    git = new GitService()
  try {
    const index = await readFile(join(f.directory, '.git', 'index'))
    const refs = await git.command(f.directory, ['show-ref'])
    await Promise.all(
      Array.from({ length: 205 }, (_, i) =>
        writeFile(join(f.directory, `new-${String(i).padStart(3, '0')}.txt`), 'new text\n'),
      ),
    )
    await writeFile(join(f.directory, 'binary.bin'), Buffer.from([0, 1, 2]))
    await writeFile(join(f.directory, 'large.txt'), 'x'.repeat(3 * 1024 * 1024))
    await symlink('/tmp', join(f.directory, 'external-link'))
    const files = await git.changes(f.directory)
    expect(files).toHaveLength(208)
    expect(files.find((file) => file.path === 'binary.bin')?.preview?.kind).toBe('binary')
    expect(files.find((file) => file.path === 'large.txt')?.preview?.kind).toBe('large')
    expect(files.find((file) => file.path === 'external-link')?.preview?.kind).toBe('symlink')
    expect(files.find((file) => file.path === 'new-204.txt')?.preview?.kind).toBe('deferred')
    const large = await git.workingFilePreview(f.directory, 'large.txt')
    expect(large.after).toMatchObject({ kind: 'text', size: 3 * 1024 * 1024, truncated: true })
    expect(large.after?.text?.length).toBe(64 * 1024)
    expect((await git.workingFilePreview(f.directory, 'new-204.txt')).after?.text).toBe(
      'new text\n',
    )
    expect((await git.workingFilePreview(f.directory, 'external-link')).after?.text).toBe('/tmp')
    await expect(git.workingFilePreview(f.directory, '../escape')).rejects.toThrow('outside')
    expect(await readFile(join(f.directory, '.git', 'index'))).toEqual(index)
    expect(await git.command(f.directory, ['show-ref'])).toBe(refs)
  } finally {
    await f.cleanup()
  }
})
