import { afterEach, expect, it } from 'vite-plus/test'
import { chmod, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture } from '../../testing/fixture'
import { GitService } from './git'
import sharp from 'sharp'
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
  expect(diff.omitted).toEqual([])
  expect(diff.files).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: 'binary',
        preview: expect.objectContaining({ kind: 'binary' }),
      }),
      expect.objectContaining({
        path: 'external',
        preview: expect.objectContaining({ kind: 'symlink' }),
      }),
    ]),
  )
  expect(await git.checkpointFilePreview(cwd, before, after, 'external')).toMatchObject({
    after: { kind: 'text', text: '/etc/passwd', truncated: false },
  })
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
it('lists every changed file while keeping inline text and on-demand previews bounded', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  let blobReads = 0
  const git = new GitService(undefined, (_cwd, args, result) => {
      if (!result && args[1] === 'cat-file' && args[2] === 'blob') blobReads++
    }),
    cwd = f.directory
  const before = await git.snapshot(cwd, 'refs/dovo/checkpoints/bounded/before')
  await Promise.all(
    Array.from({ length: 205 }, (_, n) =>
      writeFile(join(cwd, `file-${String(n).padStart(3, '0')}.txt`), 'new text\n'),
    ),
  )
  await writeFile(join(cwd, 'large.txt'), 'x'.repeat(3 * 1024 * 1024))
  await writeFile(join(cwd, 'binary.dat'), Buffer.from([0, 1, 2]))
  await writeFile(
    join(cwd, 'image.png'),
    await sharp({ create: { width: 800, height: 600, channels: 4, background: '#123456' } })
      .png()
      .toBuffer(),
  )
  await git.command(cwd, ['worktree', 'add', '--detach', 'module', 'HEAD'])
  const after = await git.snapshot(cwd, 'refs/dovo/checkpoints/bounded/after')
  const result = await git.checkpointChanges(cwd, before, after)
  // The 205 identical text files share one read; the binary needs one, and later previews defer.
  expect(blobReads).toBe(2)
  expect(result.omitted).toEqual([])
  expect(result.files).toHaveLength(209)
  expect(result.files.filter((file) => !file.preview)).toHaveLength(200)
  expect(result.files.find((file) => file.path === 'large.txt')?.preview).toMatchObject({
    kind: 'large',
    after: { size: 3 * 1024 * 1024 },
  })
  expect(result.files.find((file) => file.path === 'module')?.preview?.kind).toBe('submodule')
  expect(JSON.stringify(result).length).toBeLessThan(100000)
  const large = await git.checkpointFilePreview(cwd, before, after, 'large.txt')
  expect(large.after).toMatchObject({ kind: 'text', truncated: true, size: 3 * 1024 * 1024 })
  expect(large.after?.text).toHaveLength(64 * 1024)
  const image = await git.checkpointFilePreview(cwd, before, after, 'image.png')
  expect(image.after?.kind).toBe('image')
  const thumbnail = Buffer.from(image.after?.image?.split(',')[1] ?? '', 'base64')
  expect(await sharp(thumbnail).metadata()).toMatchObject({ width: 512, height: 384 })
  expect(thumbnail.length).toBeLessThan(192 * 1024)
  expect(await git.checkpointFilePreview(cwd, before, after, 'binary.dat')).toMatchObject({
    after: { kind: 'binary', size: 3 },
  })
  expect(await git.checkpointFilePreview(cwd, before, after, 'module')).toMatchObject({
    after: { kind: 'submodule' },
  })
  await expect(git.checkpointFilePreview(cwd, before, after, 'missing')).rejects.toThrow(
    'not in the saved snapshots',
  )
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
it('defers previews once the combined byte budget is used without dropping files', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const git = new GitService()
  const before = await git.snapshot(f.directory, 'refs/dovo/checkpoints/budget/before')
  await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      writeFile(join(f.directory, `${index}.txt`), 'a'.repeat(180 * 1024)),
    ),
  )
  const after = await git.snapshot(f.directory, 'refs/dovo/checkpoints/budget/after')
  const result = await git.checkpointChanges(f.directory, before, after)
  expect(result.files).toHaveLength(8)
  expect(result.omitted).toEqual([])
  expect(result.files.filter((file) => file.preview?.kind === 'deferred')).toHaveLength(3)
  expect(
    result.files.reduce(
      (size, file) => size + Buffer.byteLength(file.before) + Buffer.byteLength(file.after),
      0,
    ),
  ).toBeLessThanOrEqual(1024 * 1024)
})
it('compares committed branch changes against the default branch without including working edits', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const git = new GitService()
  await git.command(f.directory, ['branch', '-M', 'main'])
  await git.command(f.directory, ['checkout', '-b', 'feature'])
  await writeFile(join(f.directory, 'hello.txt'), 'committed change\n')
  await git.command(f.directory, ['add', 'hello.txt'])
  await git.command(f.directory, ['commit', '-m', 'Feature change'])
  await writeFile(join(f.directory, 'hello.txt'), 'uncommitted change\n')
  const result = await git.branchChangesFiles(f.directory)
  expect(result.base).toBe('refs/heads/main')
  expect(result.files).toEqual([
    { path: 'hello.txt', before: 'original\n', after: 'committed change\n', viewed: false },
  ])
  expect(result.omitted).toEqual([])
})
