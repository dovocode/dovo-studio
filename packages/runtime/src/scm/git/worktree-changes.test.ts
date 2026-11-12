import { afterEach, expect, it, vi } from 'vite-plus/test'
import { chmod, mkdir, readFile, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture } from '../../testing/fixture'
import { GitService } from './git'
import { worktreeChanged } from './worktree-changes'
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const clean of cleanups.splice(0)) await clean()
})
async function setup() {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const git = new GitService()
  return { ...f, git, changed: () => worktreeChanged(git, f.directory) }
}
it('keeps sparse missing paths and clean flagged files without changing index bytes', async () => {
  const f = await setup()
  await mkdir(join(f.directory, 'outside'))
  await writeFile(join(f.directory, 'outside/file'), 'outside\n')
  await f.git.command(f.directory, ['add', '.'])
  await f.git.command(f.directory, ['commit', '-qm', 'sparse fixture'])
  await f.git.command(f.directory, ['sparse-checkout', 'set', '--cone', 'inside'])
  await f.git.command(f.directory, ['update-index', '--assume-unchanged', 'hello.txt'])
  const index = join(f.directory, '.git/index')
  const before = await readFile(index)
  expect(await f.changed()).toBe(false)
  expect(await readFile(index)).toEqual(before)
  // Materialized paths outside the cone must also be checked, even before status unflags them.
  await mkdir(join(f.directory, 'outside'), { recursive: true })
  await writeFile(join(f.directory, 'outside/file'), 'hidden outside edit\n')
  expect(await f.changed()).toBe(true)
})
it('compares normalized line endings, clean filters and names with control characters', async () => {
  const f = await setup()
  await writeFile(
    join(f.directory, '.gitattributes'),
    '*.txt text eol=crlf\n*.filtered filter=keep\n',
  )
  await f.git.command(f.directory, ['config', 'filter.keep.clean', 'sed s/local/canonical/g'])
  await writeFile(join(f.directory, 'a.filtered'), 'local\n')
  await writeFile(join(f.directory, 'with\nnewline.txt'), 'normal\n')
  await f.git.command(f.directory, ['add', '.'])
  await f.git.command(f.directory, ['commit', '-qm', 'filter fixture'])
  await f.git.command(f.directory, [
    'update-index',
    '--assume-unchanged',
    'hello.txt',
    'a.filtered',
    'with\nnewline.txt',
  ])
  await writeFile(join(f.directory, 'hello.txt'), 'original\r\n')
  expect(await f.changed()).toBe(false)
  await writeFile(join(f.directory, 'a.filtered'), 'changed local\n')
  expect(await f.changed()).toBe(true)
})
for (const physical of ['link', 'file'])
  it(`compares flagged symlink targets with ${physical} checkout representation`, async () => {
    const f = await setup()
    await symlink('hello.txt', join(f.directory, 'link'))
    await f.git.command(f.directory, ['add', 'link'])
    await f.git.command(f.directory, ['commit', '-qm', 'link fixture'])
    await f.git.command(f.directory, ['update-index', '--assume-unchanged', 'link'])
    if (physical === 'file') {
      await f.git.command(f.directory, ['config', 'core.symlinks', 'false'])
      await rm(join(f.directory, 'link'))
      await writeFile(join(f.directory, 'link'), 'hello.txt')
    }
    expect(await f.changed()).toBe(false)
    await rm(join(f.directory, 'link'))
    if (physical === 'file') await writeFile(join(f.directory, 'link'), 'missing')
    else await symlink('missing', join(f.directory, 'link'))
    expect(await f.changed()).toBe(true)
  })
it('refuses hidden deletions, mode changes and unexpected file types', async () => {
  const f = await setup()
  await f.git.command(f.directory, ['config', 'core.fileMode', 'true'])
  await f.git.command(f.directory, ['update-index', '--assume-unchanged', 'hello.txt'])
  await chmod(join(f.directory, 'hello.txt'), 0o755)
  expect(await f.changed()).toBe(true)
  await rm(join(f.directory, 'hello.txt'))
  expect(await f.changed()).toBe(true)
  await mkdir(join(f.directory, 'hello.txt'))
  expect(await f.changed()).toBe(true)
})
it('fails closed on oversized files, unreadable content and truncated index output', async () => {
  const f = await setup()
  await f.git.command(f.directory, ['update-index', '--assume-unchanged', 'hello.txt'])
  await truncate(join(f.directory, 'hello.txt'), 65 * 1024 * 1024)
  await expect(f.changed()).rejects.toThrow('inspection limit')
  await writeFile(join(f.directory, 'hello.txt'), 'original\n')
  const original = f.git.readCommand.bind(f.git)
  vi.spyOn(f.git, 'readCommand').mockImplementation((cwd, args, limits) => {
    if (args[0] === 'hash-object') return Promise.reject(new Error('Permission denied'))
    return original(cwd, args, limits)
  })
  await expect(f.changed()).rejects.toThrow('Permission denied')
  vi.restoreAllMocks()
  vi.spyOn(f.git, 'readCommand').mockResolvedValue('h truncated')
  await expect(f.changed()).rejects.toThrow('record')
})
it.skipIf(process.platform !== 'linux')(
  'fails closed on paths that cannot round trip through UTF-8',
  async () => {
    const f = await setup()
    const path = Buffer.concat([
      Buffer.from(`${f.directory}/bad-`),
      Buffer.from([255]),
      Buffer.from('.txt'),
    ])
    await writeFile(path, 'keep me\n')
    await f.git.command(f.directory, ['add', '.'])
    await f.git.command(f.directory, ['commit', '-qm', 'invalid name'])
    await f.git.readCommand(f.directory, ['update-index', '--assume-unchanged', '--stdin'], {
      input: '"bad-\\377.txt"\n',
    })
    await writeFile(path, 'hidden work\n')
    await expect(f.changed()).rejects.toThrow('decode')
    expect(await readFile(path, 'utf8')).toBe('hidden work\n')
  },
)
it('inspects flagged submodules and their hidden tracked edits', async () => {
  const f = await setup()
  const source = await fixture()
  cleanups.push(source.cleanup)
  await f.git.command(f.directory, [
    '-c',
    'protocol.file.allow=always',
    'submodule',
    'add',
    source.directory,
    'nested',
  ])
  await f.git.command(f.directory, ['commit', '-qm', 'submodule fixture'])
  await f.git.command(f.directory, ['update-index', '--assume-unchanged', 'nested'])
  expect(await f.changed()).toBe(false)
  await f.git.command(join(f.directory, 'nested'), [
    'update-index',
    '--assume-unchanged',
    'hello.txt',
  ])
  await writeFile(join(f.directory, 'nested/hello.txt'), 'hidden submodule work\n')
  expect(await f.changed()).toBe(true)
})
